-- =====================================================================
-- ทดสอบ migrations ของ POS กับ Postgres จริง
-- ครอบคลุม: สิทธิ์/RLS, checkout, idempotency, ส่วนลด, เงินสด vs เงินโอน,
--          เงินเข้า-ออก, คืนเงิน, สรุป/ปิดกะ, รายงาน, สต็อก, ความไม่เปลี่ยนแปลงของข้อมูลการเงิน
-- =====================================================================

create schema t;
grant usage on schema t to public;
create table t.ids (name text primary key, id uuid not null);
grant select on t.ids to public;

create function t.id(p_name text) returns uuid language sql stable as
$$ select id from t.ids where name = p_name $$;

create function t.login(p_name text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', t.id(p_name)::text, true);
  execute 'set local role authenticated';
end $$;

create function t.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function t.n(p_label text, p_actual numeric, p_expected numeric) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL [%]: expected %, got %', p_label, p_expected, p_actual;
  end if;
  raise notice 'ok - %', p_label;
end $$;

create function t.s(p_label text, p_actual text, p_expected text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL [%]: expected %, got %', p_label, p_expected, p_actual;
  end if;
  raise notice 'ok - %', p_label;
end $$;

-- คาดว่า SQL ที่รันในนามผู้ใช้นั้น "ต้องล้มเหลว" ด้วยข้อความขึ้นต้นด้วย p_code
create function t.fails(p_label text, p_user text, p_sql text, p_code text) returns void language plpgsql as $$
declare v_msg text;
begin
  begin
    if p_user <> 'postgres' then perform t.login(p_user); end if;
    execute p_sql;
    v_msg := null;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform t.logout();
  if v_msg is null then
    raise exception 'FAIL [%]: expected error "%" but statement succeeded', p_label, p_code;
  end if;
  if v_msg not like p_code || '%' then
    raise exception 'FAIL [%]: expected error "%" but got "%"', p_label, p_code, v_msg;
  end if;
  raise notice 'ok - % [%]', p_label, p_code;
end $$;

create function t.as(p_user text, p_sql text) returns void language plpgsql as $$
begin
  perform t.login(p_user);
  execute p_sql;
  perform t.logout();
end $$;

create function t.pid(p_name text, p_cat text default 'Basque Burnt Cheesecake') returns uuid language sql stable as $$
  select p.id from public.products p join public.categories c on c.id = p.category_id
   where p.name = p_name and c.name = p_cat
$$;

create function t.item(p_name text, p_qty integer, p_cat text default 'Basque Burnt Cheesecake',
                       p_addons text[] default '{}') returns jsonb language sql stable as $$
  select jsonb_build_object(
    'product_id', t.pid(p_name, p_cat),
    'quantity', p_qty,
    'addon_ids', coalesce((select jsonb_agg(a.id) from public.addons a where a.name = any(p_addons)), '[]'::jsonb))
$$;

create function t.shift() returns uuid language sql stable as
$$ select id from public.shifts where status = 'open' order by opened_at limit 1 $$;

create function t.checkout(p_user text, p_key uuid, p_items jsonb, p_discount uuid, p_method text,
                           p_received integer, p_ref text default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform t.login(p_user);
  v := public.checkout_order(p_key, t.shift(), p_items, p_discount, p_method, p_received, p_ref, null, null);
  perform t.logout();
  return v;
end $$;

-- ตัวช่วยสำหรับ t.fails: เรียก checkout แล้วทิ้งผลลัพธ์
create function t.try_checkout(p_items jsonb, p_discount uuid, p_method text, p_received integer) returns void
language plpgsql as $$
begin
  perform public.checkout_order(gen_random_uuid(), t.shift(), p_items, p_discount, p_method, p_received, null, null, null);
end $$;

-- =====================================================================
-- A. ผู้ใช้และบทบาท
-- =====================================================================
do $$
declare
  v_owner uuid := gen_random_uuid(); v_mgr uuid := gen_random_uuid();
  v_cash uuid := gen_random_uuid();  v_stranger uuid := gen_random_uuid();
  v_spoof uuid := gen_random_uuid();
begin
  insert into auth.users(id, email) values (v_owner, 'owner@cafe.test');
  insert into auth.users(id, email, raw_app_meta_data)
    values (v_mgr, 'mgr@cafe.test', '{"pos_role":"manager","pos_name":"Mgr"}');
  insert into auth.users(id, email, raw_app_meta_data)
    values (v_cash, 'cashier@cafe.test', '{"pos_role":"cashier","pos_name":"Narumon"}');
  insert into auth.users(id, email) values (v_stranger, 'stranger@cafe.test');
  -- พยายามยกระดับสิทธิ์ผ่าน user_metadata (ผู้สมัครเองแก้ได้) ต้องไม่ได้ผล
  insert into auth.users(id, email, raw_user_meta_data)
    values (v_spoof, 'spoof@cafe.test', '{"pos_role":"owner","role":"owner"}');
  insert into t.ids values ('owner', v_owner), ('mgr', v_mgr), ('cashier', v_cash),
                           ('stranger', v_stranger), ('spoof', v_spoof);

  perform t.s('คนแรกที่สมัครเป็น owner', (select role from public.employees where id = v_owner), 'owner');
  perform t.s('manager จาก app_metadata', (select role from public.employees where id = v_mgr), 'manager');
  perform t.s('ชื่อจาก pos_name', (select name from public.employees where id = v_cash), 'Narumon');
  perform t.n('สมัครเองไม่มี metadata = ยังไม่อนุมัติ', (select count(*) from public.employees where id = v_stranger and not active), 1);
  perform t.n('ปลอม user_metadata ไม่ได้สิทธิ์ owner',
              (select count(*) from public.employees where id = v_spoof and role = 'cashier' and not active), 1);
end $$;

do $$
begin
  perform t.n('seed: 9 สินค้า', (select count(*) from public.products), 9);
  perform t.n('seed: เครื่องดื่ม 6 รายการยังไม่มีราคา',
              (select count(*) from public.products where price_satang is null), 6);
  perform t.n('seed: ยังไม่เปิดขาย', (select count(*) from public.settings where not sales_enabled), 1);
  perform t.n('calc_discount 10% ของ 1005 = 101 (ปัดครึ่งขึ้น)', public.calc_discount(1005, 'percent', 1000), 101);
  perform t.n('calc_discount 10% ของ 1004 = 100', public.calc_discount(1004, 'percent', 1000), 100);
  perform t.n('calc_discount fixed ไม่เกินยอด', public.calc_discount(3000, 'fixed', 5000), 3000);

  perform t.fails('พนักงานที่ยังไม่อนุมัติเปิดกะไม่ได้', 'stranger',
    format('select public.open_shift(%L, 1000)', (select id from public.registers limit 1)), 'NOT_AUTHENTICATED');
  perform t.fails('anon เรียกฟังก์ชันไม่ได้', 'postgres',
    $q$ set local role anon; select public.sales_report(current_date, current_date) $q$, 'permission denied');
end $$;

-- =====================================================================
-- B. เปิดกะ + ตั้งค่าเมนู
-- =====================================================================
do $$
declare v_reg uuid := (select id from public.registers where name = 'POS 1');
begin
  perform t.fails('เปิดกะด้วยจำนวนติดลบไม่ได้', 'cashier', format('select public.open_shift(%L, -1)', v_reg), 'INVALID_AMOUNT');
  perform t.login('cashier');
  perform public.open_shift(v_reg, 100000);   -- เงินทอนตั้งต้น ฿1,000
  perform t.logout();
  perform t.n('มีกะเปิดอยู่ 1 กะ', (select count(*) from public.shifts where status = 'open'), 1);
  perform t.fails('เปิดกะซ้อนในเครื่องเดียวกันไม่ได้', 'mgr', format('select public.open_shift(%L, 500)', v_reg), 'SHIFT_ALREADY_OPEN');
end $$;

do $$
begin
  -- ยังไม่เปิดขาย → รับชำระไม่ได้
  perform t.fails('ปิดการขายอยู่ → ชำระไม่ได้', 'cashier',
    format('select t.try_checkout(jsonb_build_array(t.item(%L, 1)), null, %L, 10000)', 'Original', 'cash'), 'SALES_DISABLED');

  -- แคชเชียร์เปิดขาย/แก้ราคาเองไม่ได้ (RLS: ไม่มีแถวที่แก้ได้)
  perform t.as('cashier', 'update public.settings set sales_enabled = true');
  perform t.n('แคชเชียร์แก้ settings ไม่ได้', (select count(*) from public.settings where sales_enabled), 0);
  perform t.as('cashier', format('update public.products set price_satang = 1 where id = %L', t.pid('Original')));
  perform t.n('แคชเชียร์แก้ราคาไม่ได้', (select price_satang from public.products where id = t.pid('Original')), 5900);

  -- ผู้จัดการตั้งราคาเครื่องดื่ม (ข้อมูลทดสอบ), เจ้าของเปิดขาย
  perform t.as('mgr', format('update public.products set price_satang = 4900 where id = %L', t.pid('Apple Tea', 'Matcha & Tea')));
  perform t.as('owner', 'update public.settings set sales_enabled = true');
  perform t.n('เจ้าของเปิดขายได้', (select count(*) from public.settings where sales_enabled), 1);

  -- ส่วนลด & ตัวเลือกเสริม
  perform t.as('mgr', $q$
    insert into public.discounts(name, kind, value) values
      ('ลด 10%', 'percent', 1000), ('ลด 100%', 'percent', 10000), ('ลด 50 บาท', 'fixed', 5000), ('ลดเก่า', 'fixed', 1000);
    update public.discounts set active = false where name = 'ลดเก่า';
    insert into public.addons(name, price_satang) values ('เพิ่มช็อต', 1000), ('ราดซอส', 1500);
    insert into public.product_addons
      select p.id, a.id from public.products p, public.addons a
       where p.name = 'Apple Tea' and a.name = 'เพิ่มช็อต'; $q$);
end $$;

-- =====================================================================
-- C. Checkout
-- =====================================================================
do $$
declare
  v_key uuid := gen_random_uuid();
  v_o1 uuid; v_o1b uuid; v_o2 uuid; v_o3 uuid;
  v_disc10 uuid := (select id from public.discounts where name = 'ลด 10%');
begin
  -- 1) เงินสด: Original×2 + Matcha cheesecake×1 = 11800 + 7900 = 19700, รับ 20000 ทอน 300
  v_o1 := t.checkout('cashier', v_key,
    jsonb_build_array(t.item('Original', 2), t.item('Matcha', 1)), null, 'cash', 20000);
  perform t.n('order #1 เลขที่ 1', (select order_no from public.orders where id = v_o1), 1);
  perform t.n('ยอดรวมคำนวณจากฐานข้อมูล', (select total_satang from public.orders where id = v_o1), 19700);
  perform t.s('สถานะเริ่มต้น = รอทำ', (select prep_status from public.orders where id = v_o1), 'preparing');
  perform t.s('สถานะการชำระ = paid', (select payment_status from public.orders where id = v_o1), 'paid');
  perform t.n('ทอนเงิน', (select change_satang from public.payments where order_id = v_o1), 300);
  perform t.n('ยอดตัดชำระ = ยอดออเดอร์ (ไม่รวมเงินทอน)', (select amount_satang from public.payments where order_id = v_o1), 19700);
  perform t.n('บันทึกพนักงานที่รับเงิน', (select count(*) from public.payments where order_id = v_o1 and confirmed_by = t.id('cashier')), 1);

  -- 2) กดชำระซ้ำด้วย key เดิม = ได้ออเดอร์เดิม ไม่สร้างใหม่
  v_o1b := t.checkout('cashier', v_key,
    jsonb_build_array(t.item('Original', 2), t.item('Matcha', 1)), null, 'cash', 20000);
  perform t.s('idempotent: ได้ออเดอร์เดิม', v_o1b::text, v_o1::text);
  perform t.n('idempotent: มี 1 ออเดอร์ 1 การชำระ',
              (select count(*) from public.orders) * 10 + (select count(*) from public.payments), 11);

  -- 3) โอนเงิน พร้อมตัวเลือกเสริม: Apple Tea 4900 + เพิ่มช็อต 1000 = 5900
  v_o2 := t.checkout('cashier', gen_random_uuid(),
    jsonb_build_array(t.item('Apple Tea', 1, 'Matcha & Tea', array['เพิ่มช็อต'])), null, 'transfer', 5900, 'REF-001');
  perform t.n('ยอดรวมรวมตัวเลือกเสริม', (select total_satang from public.orders where id = v_o2), 5900);
  perform t.s('เก็บเลขอ้างอิงการโอน', (select reference from public.payments where order_id = v_o2), 'REF-001');
  perform t.n('ชื่อ/ตัวเลือกเสริมถูก snapshot',
              (select count(*) from public.order_items where order_id = v_o2 and addons->0->>'name' = 'เพิ่มช็อต' and addon_unit_satang = 1000), 1);

  -- 4) ส่วนลด 10%: 5900 → ลด 590 → 5310; รับ 6000 ทอน 690
  v_o3 := t.checkout('cashier', gen_random_uuid(),
    jsonb_build_array(t.item('Original', 1)), v_disc10, 'cash', 6000);
  perform t.n('ส่วนลด 10%', (select discount_satang from public.orders where id = v_o3), 590);
  perform t.n('ยอดสุทธิหลังส่วนลด', (select total_satang from public.orders where id = v_o3), 5310);
  perform t.s('เก็บชื่อส่วนลดไว้', (select discount_name from public.orders where id = v_o3), 'ลด 10%');
  perform t.n('เลขออเดอร์ต่อเนื่อง', (select order_no from public.orders where id = v_o3), 3);
end $$;

do $$
declare
  v_o int;
begin
  -- 5) ข้อมูลไม่ถูกต้อง ต้องถูกปฏิเสธ และเลขออเดอร์ต้องไม่ข้าม
  perform t.fails('สินค้ายังไม่ตั้งราคา', 'cashier',
    format('select t.try_checkout(jsonb_build_array(t.item(%L, 1, %L)), null, %L, 10000)', 'Clear Matcha', 'Matcha & Tea', 'cash'),
    'PRICE_NOT_SET');
  perform t.fails('จำนวน 0', 'cashier',
    format('select t.try_checkout(jsonb_build_array(t.item(%L, 0)), null, %L, 10000)', 'Original', 'cash'), 'INVALID_QUANTITY');
  perform t.fails('จำนวน 100', 'cashier',
    format('select t.try_checkout(jsonb_build_array(t.item(%L, 100)), null, %L, 99999999)', 'Original', 'cash'), 'INVALID_QUANTITY');
  perform t.fails('ออเดอร์ว่าง', 'cashier', format('select t.try_checkout(%L::jsonb, null, %L, 10000)', '[]', 'cash'), 'EMPTY_ORDER');
  perform t.fails('เงินสดไม่พอ', 'cashier',
    format('select t.try_checkout(jsonb_build_array(t.item(%L, 1)), null, %L, 5000)', 'Original', 'cash'), 'INSUFFICIENT_PAYMENT');
  perform t.fails('ยอดโอนไม่ตรง', 'cashier',
    format('select t.try_checkout(jsonb_build_array(t.item(%L, 1)), null, %L, 6000)', 'Original', 'transfer'), 'TRANSFER_AMOUNT_MISMATCH');
  perform t.fails('วิธีชำระไม่รองรับ', 'cashier',
    format('select t.try_checkout(jsonb_build_array(t.item(%L, 1)), null, %L, 6000)', 'Original', 'card'), 'INVALID_METHOD');
  perform t.fails('ตัวเลือกเสริมที่ไม่ผูกกับสินค้า', 'cashier',
    format('select t.try_checkout(jsonb_build_array(t.item(%L, 1, %L, array[%L])), null, %L, 10000)',
           'Original', 'Basque Burnt Cheesecake', 'ราดซอส', 'cash'), 'ADDON_INVALID');
  perform t.fails('ส่วนลดที่ปิดใช้งาน', 'cashier',
    format('select t.try_checkout(jsonb_build_array(t.item(%L, 1)), %L, %L, 10000)',
           'Original', (select id from public.discounts where name = 'ลดเก่า'), 'cash'), 'DISCOUNT_INVALID');
  perform t.fails('ลด 100% ทำให้ยอดเป็นศูนย์', 'cashier',
    format('select t.try_checkout(jsonb_build_array(t.item(%L, 1)), %L, %L, 10000)',
           'Original', (select id from public.discounts where name = 'ลด 100%'), 'cash'), 'TOTAL_NOT_POSITIVE');
  perform t.fails('ไม่มีกะที่เปิด (ระบุกะผิด)', 'cashier',
    format('select public.checkout_order(gen_random_uuid(), %L, jsonb_build_array(t.item(%L, 1)), null, %L, 10000, null, null, null)',
           gen_random_uuid(), 'Original', 'cash'), 'SHIFT_NOT_OPEN');

  -- สินค้าหมด/ปิดใช้งาน
  perform t.as('mgr', format('update public.products set is_available = false where id = %L', t.pid('Apple Tea', 'Matcha & Tea')));
  perform t.fails('สินค้าหมด', 'cashier',
    format('select t.try_checkout(jsonb_build_array(t.item(%L, 1, %L)), null, %L, 10000)', 'Apple Tea', 'Matcha & Tea', 'cash'),
    'PRODUCT_SOLD_OUT');
  perform t.as('mgr', format('update public.products set is_available = true, is_active = false where id = %L', t.pid('Apple Tea', 'Matcha & Tea')));
  perform t.fails('สินค้าถูกปิดใช้งาน', 'cashier',
    format('select t.try_checkout(jsonb_build_array(t.item(%L, 1, %L)), null, %L, 10000)', 'Apple Tea', 'Matcha & Tea', 'cash'),
    'PRODUCT_UNAVAILABLE');
  perform t.as('mgr', format('update public.products set is_active = true where id = %L', t.pid('Apple Tea', 'Matcha & Tea')));

  -- ราคาจาก client ถูกเมินเสมอ
  perform t.checkout('cashier', gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('product_id', t.pid('Red Velvet'), 'quantity', 1, 'unit_price_satang', 1, 'price', 1)),
    null, 'cash', 6900);
  perform t.n('ไม่เชื่อราคาจาก client', (select total_satang from public.orders where order_no = 4), 6900);
  -- ออเดอร์ #4 นี้ (Red Velvet) ต้องถูกคืนเงินเพื่อให้ตัวเลขด้านล่างตรงกัน → ทดสอบแยกด้านล่าง
  perform t.n('เลขออเดอร์ไม่ข้ามแม้มีคำสั่งที่ล้มเหลว', (select max(order_no) from public.orders), 4);
  v_o := (select count(*) from public.orders);
  perform t.n('มี 4 ออเดอร์', v_o, 4);
end $$;

-- ราคาที่แก้ภายหลังต้องไม่เปลี่ยนประวัติ
do $$
begin
  perform t.as('mgr', format('update public.products set price_satang = 6100, name = %L where id = %L', 'Original (new)', t.pid('Original')));
  perform t.n('ประวัติรายการสินค้าไม่เปลี่ยนตามราคาใหม่',
              (select count(*) from public.order_items where product_name = 'Original' and unit_price_satang = 5900), 2);
  perform t.n('audit เก็บประวัติแก้ราคา',
              (select count(*) from public.audit_logs where entity = 'products' and action = 'update'
                  and details->'old'->>'price_satang' = '5900' and details->'new'->>'price_satang' = '6100'), 1);
  perform t.as('mgr', format('update public.products set price_satang = 5900, name = %L where id = %L', 'Original', t.pid('Original (new)')));
end $$;

-- =====================================================================
-- D. สถานะการทำออเดอร์ (DONE ≠ ชำระเงิน)
-- =====================================================================
do $$
declare v_o uuid := (select id from public.orders where order_no = 1);
begin
  perform t.as('cashier', format('select public.set_order_prep_status(%L, %L)', v_o, 'done'));
  perform t.s('กด DONE', (select prep_status from public.orders where id = v_o), 'done');
  perform t.n('บันทึกผู้กดและเวลา', (select count(*) from public.orders where id = v_o and prepared_by = t.id('cashier') and prepared_at is not null), 1);
  perform t.s('DONE ไม่ได้ทำให้สถานะชำระเงินเปลี่ยน', (select payment_status from public.orders where id = v_o), 'paid');
  perform t.as('cashier', format('select public.set_order_prep_status(%L, %L)', v_o, 'preparing'));
  perform t.s('ย้อนกลับไปรอทำ', (select prep_status from public.orders where id = v_o), 'preparing');
  perform t.n('ย้อนกลับแล้วล้างเวลาเสร็จ', (select count(*) from public.orders where id = v_o and prepared_at is null and prepared_by is null), 1);
  perform t.n('audit บันทึกการเปลี่ยนสถานะ', (select count(*) from public.audit_logs where entity = 'orders' and action = 'prep_status' and entity_id = v_o::text), 2);
  perform t.fails('สถานะไม่ถูกต้อง', 'cashier', format('select public.set_order_prep_status(%L, %L)', v_o, 'paid'), 'INVALID_STATUS');
  perform t.as('cashier', format('select public.set_order_prep_status(%L, %L)', v_o, 'done'));
end $$;

-- =====================================================================
-- E. เงินเข้า-ออก
-- =====================================================================
do $$
declare
  v_in uuid; v_in2 uuid; v_key uuid := gen_random_uuid(); v_rev uuid;
  v_exp bigint;
begin
  perform t.login('cashier');
  v_in := public.record_cash_movement(v_key, 'in', 'cash', 20000, 'เพิ่มเงินทอน', null, t.shift());
  v_in2 := public.record_cash_movement(v_key, 'in', 'cash', 20000, 'เพิ่มเงินทอน', null, t.shift());
  perform public.record_cash_movement(gen_random_uuid(), 'out', 'cash', 30000, 'ซื้อวัตถุดิบ', 'นมสด', t.shift());
  perform public.record_cash_movement(gen_random_uuid(), 'out', 'transfer', 50000, 'ค่าไฟ', null, t.shift());
  perform t.logout();

  perform t.s('เงินเข้า-ออก: key ซ้ำ = รายการเดิม', v_in::text, v_in2::text);
  perform t.n('เงินเข้า-ออก: key ซ้ำไม่สร้างแถวใหม่', (select count(*) from public.cash_movements where idempotency_key = v_key), 1);

  -- ลิ้นชัก = 100000 + (19700 + 5310 + 6900) + 20000 − 30000 ; รายจ่ายโอนไม่กระทบ
  v_exp := (public.compute_shift_summary(t.shift())->>'expected_cash_satang')::bigint;
  perform t.n('รายจ่ายเงินสดลดลิ้นชัก / รายจ่ายโอนไม่ลด', v_exp, 121910);

  perform t.fails('เบิกเงินสดเกินที่มีในลิ้นชัก', 'cashier',
    format('select public.record_cash_movement(gen_random_uuid(), %L, %L, 99999999, %L, null, %L)', 'out', 'cash', 'ทดสอบ', t.shift()),
    'INSUFFICIENT_DRAWER_CASH');
  perform t.fails('จำนวนเงิน 0', 'cashier',
    format('select public.record_cash_movement(gen_random_uuid(), %L, %L, 0, %L, null, %L)', 'in', 'cash', 'x', t.shift()), 'INVALID_AMOUNT');
  perform t.fails('ต้องระบุเหตุผล', 'cashier',
    format('select public.record_cash_movement(gen_random_uuid(), %L, %L, 100, %L, null, %L)', 'in', 'cash', '  ', t.shift()), 'REASON_REQUIRED');

  -- กลับรายการ (ผู้จัดการเท่านั้น) — ไม่แก้/ไม่ลบรายการเดิม
  perform t.fails('แคชเชียร์กลับรายการไม่ได้', 'cashier',
    format('select public.reverse_cash_movement(gen_random_uuid(), %L, %L)', v_in, 'ผิดพลาด'), 'FORBIDDEN');
  perform t.login('mgr');
  v_rev := public.reverse_cash_movement(gen_random_uuid(), v_in, 'ใส่ยอดผิด');
  perform t.logout();
  perform t.n('รายการเดิมยังอยู่', (select count(*) from public.cash_movements where id = v_in), 1);
  perform t.n('รายการกลับรายการอ้างอิงรายการเดิม',
              (select count(*) from public.cash_movements where id = v_rev and reverses_id = v_in and direction = 'out' and amount_satang = 20000), 1);
  perform t.fails('กลับรายการซ้ำไม่ได้', 'mgr',
    format('select public.reverse_cash_movement(gen_random_uuid(), %L, %L)', v_in, 'อีกครั้ง'), 'ALREADY_REVERSED');
  perform t.fails('กลับรายการของรายการกลับไม่ได้', 'mgr',
    format('select public.reverse_cash_movement(gen_random_uuid(), %L, %L)', v_rev, 'อีกครั้ง'), 'ALREADY_REVERSED');
  perform t.n('ลิ้นชักหลังกลับรายการ', (public.compute_shift_summary(t.shift())->>'expected_cash_satang')::bigint, 101910);
end $$;

-- =====================================================================
-- F. คืนเงิน
-- =====================================================================
do $$
declare
  v_o1 uuid := (select id from public.orders where order_no = 1);
  v_o2 uuid := (select id from public.orders where order_no = 2);
  v_o4 uuid := (select id from public.orders where order_no = 4);
  v_k uuid := gen_random_uuid(); v_r uuid; v_r2 uuid;
begin
  perform t.fails('แคชเชียร์คืนเงินไม่ได้', 'cashier',
    format('select public.refund_order(gen_random_uuid(), %L, 100, %L, %L, %L)', v_o1, 'cash', 'x', t.shift()), 'FORBIDDEN');
  perform t.fails('คืนเงินต้องมีเหตุผล', 'mgr',
    format('select public.refund_order(gen_random_uuid(), %L, 100, %L, %L, %L)', v_o1, 'cash', ' ', t.shift()), 'REASON_REQUIRED');

  perform t.login('mgr');
  v_r  := public.refund_order(v_k, v_o1, 1000, 'cash', 'ลูกค้าไม่พอใจ', t.shift());
  v_r2 := public.refund_order(v_k, v_o1, 1000, 'cash', 'ลูกค้าไม่พอใจ', t.shift());
  perform t.logout();
  perform t.s('คืนเงิน: key ซ้ำ = รายการเดิม', v_r::text, v_r2::text);
  perform t.n('คืนเงิน: ไม่หักซ้ำ', (select count(*) from public.refunds where order_id = v_o1), 1);
  perform t.s('คืนบางส่วน', (select payment_status from public.orders where id = v_o1), 'partially_refunded');
  perform t.fails('คืนเกินยอดที่ชำระ', 'mgr',
    format('select public.refund_order(gen_random_uuid(), %L, 18701, %L, %L, %L)', v_o1, 'cash', 'เกิน', t.shift()), 'REFUND_EXCEEDS_PAID');

  perform t.as('mgr', format('select public.refund_order(gen_random_uuid(), %L, 18700, %L, %L, %L)', v_o1, 'cash', 'คืนส่วนที่เหลือ', t.shift()));
  perform t.s('คืนเต็มจำนวน', (select payment_status from public.orders where id = v_o1), 'refunded');
  perform t.s('คืนเงินแล้วการทำออเดอร์ไม่เปลี่ยน', (select prep_status from public.orders where id = v_o1), 'done');

  -- คืนเงินโอน: ไม่กระทบลิ้นชักเงินสด
  perform t.as('mgr', format('select public.refund_order(gen_random_uuid(), %L, 5900, %L, %L, %L)', v_o2, 'transfer', 'โอนผิด', t.shift()));
  perform t.s('คืนเงินโอนเต็ม', (select payment_status from public.orders where id = v_o2), 'refunded');
  -- ออเดอร์ #4 (Red Velvet) คืนเต็มเป็นเงินโอน เพื่อให้ยอดรวมในสรุปตรงกับที่คำนวณไว้
  perform t.as('mgr', format('select public.refund_order(gen_random_uuid(), %L, 6900, %L, %L, %L)', v_o4, 'transfer', 'ทดสอบ', t.shift()));
end $$;

-- =====================================================================
-- G. สรุปกะ (นิยามเดียวกับรายงาน)
--   ออเดอร์: #1 19700 (cash), #2 5900 (transfer), #3 5310 (ลด 590, cash), #4 6900 (cash)
--   gross  = 19700 + 5900 + 5900 + 6900 = 38400   discounts = 590
--   refunds= 1000 + 18700 + 5900 + 6900 = 32500  (cash 19700, transfer 12800)
--   net    = 38400 − 590 − 32500 = 5310
--   cash sales = 19700 + 5310 + 6900 = 31910
--   expected   = 100000 + 31910 + 20000 − (30000 + 20000) − 19700 = 82210
-- =====================================================================
do $$
declare s jsonb;
begin
  s := public.compute_shift_summary(t.shift());
  perform t.n('summary: opening', (s->>'opening_cash_satang')::bigint, 100000);
  perform t.n('summary: total sales (gross)', (s->>'total_sales_satang')::bigint, 38400);
  perform t.n('summary: discounts', (s->>'discounts_satang')::bigint, 590);
  perform t.n('summary: refunds', (s->>'refunds_satang')::bigint, 32500);
  perform t.n('summary: net = gross − discounts − refunds', (s->>'net_sales_satang')::bigint, 5310);
  perform t.n('summary: cash sales', (s->>'cash_sales_satang')::bigint, 31910);
  perform t.n('summary: transfer payments (ไม่รวมในลิ้นชัก)', (s->>'transfer_payments_satang')::bigint, 5900);
  perform t.n('summary: cash refunds', (s->>'cash_refunds_satang')::bigint, 19700);
  perform t.n('summary: transfer refunds', (s->>'transfer_refunds_satang')::bigint, 12800);
  perform t.n('summary: cash in', (s->>'cash_in_satang')::bigint, 20000);
  perform t.n('summary: cash out (รวมกลับรายการ)', (s->>'cash_out_satang')::bigint, 50000);
  perform t.n('summary: transfer out (ไม่เกี่ยวลิ้นชัก)', (s->>'transfer_out_satang')::bigint, 50000);
  perform t.n('summary: expected cash', (s->>'expected_cash_satang')::bigint, 82210);
  perform t.n('summary: order count', (s->>'order_count')::bigint, 4);
  perform t.n('summary: cash/transfer order count', (s->>'cash_order_count')::bigint * 10 + (s->>'transfer_order_count')::bigint, 31);
  -- สูตรอิสระจากตารางดิบ
  perform t.n('expected cash = สูตรจากข้อมูลดิบ',
    (select s2.opening_cash_satang
          + coalesce((select sum(amount_satang) from public.payments where shift_id = s2.id and method = 'cash'), 0)
          + coalesce((select sum(amount_satang) from public.cash_movements where shift_id = s2.id and channel = 'cash' and direction = 'in'), 0)
          - coalesce((select sum(amount_satang) from public.cash_movements where shift_id = s2.id and channel = 'cash' and direction = 'out'), 0)
          - coalesce((select sum(amount_satang) from public.refunds where shift_id = s2.id and method = 'cash'), 0)
       from public.shifts s2 where s2.id = t.shift()),
    (s->>'expected_cash_satang')::bigint);
end $$;

-- =====================================================================
-- H. รายงานขาย
-- =====================================================================
do $$
declare r jsonb; v_today date := public.bkk_today();
begin
  perform t.fails('แคชเชียร์ดูรายงานไม่ได้', 'cashier', format('select public.sales_report(%L, %L)', v_today, v_today), 'FORBIDDEN');
  perform t.fails('ช่วงวันที่ไม่ถูกต้อง', 'mgr', format('select public.sales_report(%L, %L)', v_today, v_today - 1), 'INVALID_RANGE');

  perform t.login('mgr');
  r := public.sales_report(v_today, v_today);
  perform t.logout();

  perform t.n('report: gross ตรงกับสรุปกะ', (r->'summary'->>'gross_satang')::bigint, 38400);
  perform t.n('report: discounts', (r->'summary'->>'discounts_satang')::bigint, 590);
  perform t.n('report: refunds (ไม่นับซ้ำเป็นยอดขาย)', (r->'summary'->>'refunds_satang')::bigint, 32500);
  perform t.n('report: net', (r->'summary'->>'net_satang')::bigint, 5310);
  perform t.n('report: order count', (r->'summary'->>'order_count')::bigint, 4);
  perform t.n('report: ออเดอร์ที่มีส่วนลด', (r->'summary'->>'discounted_order_count')::bigint, 1);
  perform t.n('report: ค่าเฉลี่ยต่อออเดอร์ = (gross−discount)/orders', (r->'summary'->>'avg_order_satang')::bigint, 9453);
  perform t.n('report: by_payment cash', (select (x->>'amount_satang')::bigint from jsonb_array_elements(r->'by_payment') x where x->>'method' = 'cash'), 31910);
  perform t.n('report: by_payment transfer', (select (x->>'amount_satang')::bigint from jsonb_array_elements(r->'by_payment') x where x->>'method' = 'transfer'), 5900);
  perform t.n('report: by_product Original qty', (select (x->>'quantity')::bigint from jsonb_array_elements(r->'by_product') x where x->>'product_name' = 'Original'), 3);
  perform t.n('report: by_category รวม = gross', (select sum((x->>'gross_satang')::bigint) from jsonb_array_elements(r->'by_category') x), 38400);
  perform t.n('report: by_employee', jsonb_array_length(r->'by_employee'), 1);
  perform t.n('report: by_shift', jsonb_array_length(r->'by_shift'), 1);
  perform t.n('report: refund history', jsonb_array_length(r->'refund_history'), 4);
  perform t.n('report: discount orders', jsonb_array_length(r->'discount_orders'), 1);
  perform t.n('report: cash out (เงินออกไม่ถูกนับเป็นยอดขาย)', (r->'movements'->>'cash_out_satang')::bigint, 50000);
  perform t.n('report: transfer out', (r->'movements'->>'transfer_out_satang')::bigint, 50000);
end $$;

-- =====================================================================
-- I. ปิดกะ
-- =====================================================================
do $$
declare s jsonb; v_shift uuid := (select id from public.shifts where status = 'open');
begin
  perform t.fails('ปิดกะต้องระบุเงินที่นับได้', 'cashier', format('select public.close_shift(%L, null)', v_shift), 'INVALID_AMOUNT');
  perform t.fails('เงินที่นับได้ติดลบไม่ได้', 'cashier', format('select public.close_shift(%L, -5)', v_shift), 'INVALID_AMOUNT');

  perform t.login('cashier');
  s := public.close_shift(v_shift, 82000, 'ทอนผิด 2 ครั้ง');
  perform t.logout();

  perform t.n('ปิดกะ: expected', (s->>'expected_cash_satang')::bigint, 82210);
  perform t.n('ปิดกะ: counted', (s->>'counted_cash_satang')::bigint, 82000);
  perform t.n('ปิดกะ: variance = counted − expected', (s->>'variance_satang')::bigint, -210);
  perform t.s('กะถูกปิด', (select status from public.shifts where id = v_shift), 'closed');
  perform t.n('เก็บ snapshot ลงตารางกะ',
              (select count(*) from public.shifts where id = v_shift and variance_satang = -210 and summary = s and closed_by = t.id('cashier')), 1);

  perform t.fails('ปิดกะซ้ำไม่ได้', 'cashier', format('select public.close_shift(%L, 82000)', v_shift), 'SHIFT_NOT_OPEN');
  perform t.fails('ปิดกะแล้วรับชำระไม่ได้', 'cashier',
    format('select public.checkout_order(gen_random_uuid(), %L, jsonb_build_array(t.item(%L, 1)), null, %L, 10000, null, null, null)',
           v_shift, 'Original', 'cash'), 'SHIFT_NOT_OPEN');
  perform t.fails('ไม่มีกะ: เงินสดเข้า-ออกไม่ได้', 'cashier',
    format('select public.record_cash_movement(gen_random_uuid(), %L, %L, 100, %L)', 'in', 'cash', 'x'), 'NO_OPEN_SHIFT');
  perform t.fails('ไม่มีกะ: คืนเงินสดไม่ได้', 'mgr',
    format('select public.refund_order(gen_random_uuid(), %L, 100, %L, %L)', (select id from public.orders where order_no = 3), 'cash', 'x'), 'NO_OPEN_SHIFT');
  -- โอนโดยไม่มีกะได้ (ไม่แตะลิ้นชัก)
  perform t.as('mgr', format('select public.record_cash_movement(gen_random_uuid(), %L, %L, 700, %L)', 'in', 'transfer', 'ดอกเบี้ย'));
  perform t.n('รายการโอนนอกกะ shift_id เป็นว่าง', (select count(*) from public.cash_movements where category = 'ดอกเบี้ย' and shift_id is null), 1);

  perform t.login('mgr');
  perform t.s('get_shift_summary ของกะที่ปิดแล้วคืน snapshot', (public.get_shift_summary(v_shift) ->> 'variance_satang'), '-210');
  perform t.logout();
end $$;

-- กะใหม่: คืนเงินสดของออเดอร์กะก่อนหน้า ต้องตัดจากลิ้นชักของกะใหม่ และไม่แก้สรุปกะเก่า
do $$
declare
  v_old uuid := (select id from public.shifts where status = 'closed' order by opened_at limit 1);
  v_new uuid; s_old_before jsonb; s_new jsonb;
begin
  s_old_before := (select summary from public.shifts where id = v_old);
  perform t.login('mgr');
  v_new := public.open_shift((select id from public.registers where name = 'POS 1'), 50000);
  perform public.refund_order(gen_random_uuid(), (select id from public.orders where order_no = 3), 1000, 'cash', 'คืนข้ามกะ', v_new);
  perform t.logout();
  s_new := public.compute_shift_summary(v_new);
  perform t.n('คืนเงินข้ามกะหักจากกะใหม่', (s_new->>'cash_refunds_satang')::bigint, 1000);
  perform t.n('expected กะใหม่', (s_new->>'expected_cash_satang')::bigint, 49000);
  perform t.n('สรุปกะเก่าไม่ถูกแก้ย้อนหลัง', (select count(*) from public.shifts where id = v_old and summary = s_old_before), 1);
  perform t.n('compute กะเก่าไม่เปลี่ยน (คืนเงินผูกกับกะใหม่)',
              (public.compute_shift_summary(v_old)->>'refunds_satang')::bigint, 32500);
end $$;

-- =====================================================================
-- J. ข้อมูลการเงินห้ามแก้/ลบ + สิทธิ์เขียนตรง
-- =====================================================================
do $$
begin
  perform t.fails('ลบการชำระเงินไม่ได้', 'postgres', 'delete from public.payments', 'IMMUTABLE_RECORD');
  perform t.fails('แก้การชำระเงินไม่ได้', 'postgres', 'update public.payments set amount_satang = amount_satang', 'IMMUTABLE_RECORD');
  perform t.fails('แก้รายการสินค้าในบิลไม่ได้', 'postgres', 'update public.order_items set quantity = 1', 'IMMUTABLE_RECORD');
  perform t.fails('แก้ยอดออเดอร์ไม่ได้', 'postgres', 'update public.orders set total_satang = 1', 'IMMUTABLE_RECORD');
  perform t.fails('ลบออเดอร์ไม่ได้', 'postgres', 'delete from public.orders', 'IMMUTABLE_RECORD');
  perform t.fails('ลบการคืนเงินไม่ได้', 'postgres', 'delete from public.refunds', 'IMMUTABLE_RECORD');
  perform t.fails('แก้เงินเข้า-ออกไม่ได้', 'postgres', 'update public.cash_movements set amount_satang = 1', 'IMMUTABLE_RECORD');
  perform t.fails('ลบเงินเข้า-ออกไม่ได้', 'postgres', 'delete from public.cash_movements', 'IMMUTABLE_RECORD');
  perform t.fails('แก้กะที่ปิดแล้วไม่ได้', 'postgres',
    $q$ update public.shifts set close_note = 'แก้ย้อนหลัง' where status = 'closed' $q$, 'IMMUTABLE_RECORD');
  perform t.fails('ลบกะไม่ได้', 'postgres', 'delete from public.shifts', 'IMMUTABLE_RECORD');
  perform t.fails('แก้ audit log ไม่ได้', 'postgres', 'update public.audit_logs set action = action', 'IMMUTABLE_RECORD');
  perform t.fails('แก้เงินทอนตั้งต้นของกะที่เปิดอยู่ไม่ได้', 'postgres',
    $q$ update public.shifts set opening_cash_satang = 1 where status = 'open' $q$, 'IMMUTABLE_RECORD');

  -- เขียนตรงจากผู้ใช้ (ผ่าน API) ต้องไม่ได้แม้เป็นเจ้าของ
  perform t.fails('เขียนตาราง orders ตรงไม่ได้', 'owner',
    $q$ insert into public.orders(order_no, shift_id, employee_id, subtotal_satang, total_satang)
        select 99, id, opened_by, 100, 100 from public.shifts limit 1 $q$, 'permission denied');
  perform t.fails('แก้ payments ตรงไม่ได้', 'owner', 'update public.payments set reference = ''x''', 'permission denied');
  perform t.fails('ลบ cash_movements ตรงไม่ได้', 'owner', 'delete from public.cash_movements', 'permission denied');
  perform t.fails('แก้ shifts ตรงไม่ได้', 'owner', 'update public.shifts set status = ''open''', 'permission denied');
  perform t.fails('แก้ order_counters ตรงไม่ได้', 'owner', 'update public.order_counters set last_no = 0', 'permission denied');

  -- ไม่ยกระดับสิทธิ์ตัวเอง
  perform t.as('cashier', format('update public.employees set role = %L where id = %L', 'owner', t.id('cashier')));
  perform t.s('แคชเชียร์เลื่อนตำแหน่งตัวเองไม่ได้', (select role from public.employees where id = t.id('cashier')), 'cashier');
  perform t.fails('แก้ email พนักงานตรงไม่ได้', 'owner', format('update public.employees set email = %L', 'x@x'), 'permission denied');
  perform t.fails('เจ้าของคนสุดท้ายปิดการใช้งานไม่ได้', 'owner',
    format('update public.employees set active = false where id = %L', t.id('owner')), 'LAST_OWNER');
  perform t.fails('เจ้าของคนสุดท้ายลดตำแหน่งไม่ได้', 'owner',
    format('update public.employees set role = %L where id = %L', 'manager', t.id('owner')), 'LAST_OWNER');
  perform t.fails('ลบพนักงานไม่ได้', 'postgres', 'delete from public.employees', 'IMMUTABLE_RECORD');
end $$;

-- =====================================================================
-- K. การมองเห็นข้อมูล (RLS)
-- =====================================================================
do $$
declare v_closed uuid := (select id from public.shifts where status = 'closed' limit 1);
begin
  -- ออเดอร์ย้อนหลังเมื่อวาน (แทรกโดย superuser เพื่อทดสอบ RLS)
  insert into public.orders(order_no, business_date, shift_id, employee_id, subtotal_satang, total_satang)
  select 1, public.bkk_today() - 1, v_closed, opened_by, 100, 100 from public.shifts where id = v_closed;

  perform t.login('cashier');
  perform t.n('แคชเชียร์ไม่เห็นออเดอร์ของวันก่อน', (select count(*) from public.orders where business_date < public.bkk_today()), 0);
  perform t.n('แคชเชียร์เห็นออเดอร์ของวันนี้', (select count(*) from public.orders where business_date = public.bkk_today()), 4);
  perform t.n('แคชเชียร์อ่าน audit log ไม่ได้', (select count(*) from public.audit_logs), 0);
  perform t.n('แคชเชียร์อ่านสต็อกไม่ได้', (select count(*) from public.inventory_items), 0);
  perform t.logout();

  perform t.login('mgr');
  perform t.n('ผู้จัดการเห็นออเดอร์ย้อนหลัง', (select count(*) from public.orders where business_date < public.bkk_today()), 1);
  perform t.n('ผู้จัดการอ่าน audit log ไม่ได้', (select count(*) from public.audit_logs), 0);
  perform t.logout();

  perform t.login('owner');
  perform t.n('เจ้าของอ่าน audit log ได้', (select count(*) > 0 from public.audit_logs)::int, 1);
  perform t.logout();
end $$;

-- =====================================================================
-- L. สต็อก (ตัดครั้งเดียวต่อรายการขาย ตามสูตรเท่านั้น)
-- =====================================================================
do $$
declare
  v_item uuid; v_key uuid := gen_random_uuid(); v_o uuid; v_o2 uuid;
begin
  perform t.as('owner', 'update public.settings set inventory_enabled = true');
  perform t.as('mgr', $q$ insert into public.inventory_items(name, unit) values ('นมสด', 'ml') $q$);
  v_item := (select id from public.inventory_items where name = 'นมสด');
  perform t.as('mgr', format('select public.adjust_stock(%L, %L, 10000, %L)', v_item, 'receive', 'รับของ'));
  perform t.as('mgr', format('insert into public.recipes(product_id, inventory_item_id, qty_per_unit) values (%L, %L, 200)',
                             t.pid('Apple Tea', 'Matcha & Tea'), v_item));
  perform t.n('รับของเข้าสต็อก', (select qty_on_hand from public.inventory_items where id = v_item), 10000);

  v_o := t.checkout('cashier', v_key, jsonb_build_array(t.item('Apple Tea', 2, 'Matcha & Tea')), null, 'cash', 10000);
  perform t.n('ขาย 2 แก้ว ตัดนม 400', (select qty_on_hand from public.inventory_items where id = v_item), 9600);
  v_o2 := t.checkout('cashier', v_key, jsonb_build_array(t.item('Apple Tea', 2, 'Matcha & Tea')), null, 'cash', 10000);
  perform t.s('ชำระซ้ำด้วย key เดิมไม่ตัดสต็อกซ้ำ', v_o2::text, v_o::text);
  perform t.n('สต็อกไม่ถูกตัดซ้ำ', (select qty_on_hand from public.inventory_items where id = v_item), 9600);
  perform t.n('มี stock movement ชนิด sale 1 รายการ', (select count(*) from public.stock_movements where kind = 'sale'), 1);
  perform t.fails('ตัดสต็อกซ้ำต่อรายการขายเดียวกันไม่ได้', 'postgres',
    format($q$ insert into public.stock_movements(inventory_item_id, kind, qty_delta, order_item_id)
               select %L, 'sale', -1, id from public.order_items where order_id = %L limit 1 $q$, v_item, v_o), 'duplicate key');

  perform t.fails('แคชเชียร์ปรับสต็อกไม่ได้', 'cashier', format('select public.adjust_stock(%L, %L, 1)', v_item, 'receive'), 'FORBIDDEN');
  perform t.as('mgr', format('select public.adjust_stock(%L, %L, 100, %L)', v_item, 'waste', 'ทิ้ง'));
  perform t.n('ของเสียหักสต็อก', (select qty_on_hand from public.inventory_items where id = v_item), 9500);
  perform t.fails('ชนิดไม่ถูกต้อง', 'mgr', format('select public.adjust_stock(%L, %L, 1)', v_item, 'sale'), 'INVALID_KIND');

  -- ปิดใช้สต็อก → ไม่ตัด
  perform t.as('owner', 'update public.settings set inventory_enabled = false');
  perform t.checkout('cashier', gen_random_uuid(), jsonb_build_array(t.item('Apple Tea', 1, 'Matcha & Tea')), null, 'cash', 5000);
  perform t.n('ปิดสต็อก → ไม่ตัด', (select qty_on_hand from public.inventory_items where id = v_item), 9500);

  -- ปิดการขาย → รับชำระไม่ได้
  perform t.as('owner', 'update public.settings set sales_enabled = false');
  perform t.fails('ปิดการขายแล้วชำระไม่ได้', 'cashier',
    format('select t.try_checkout(jsonb_build_array(t.item(%L, 1)), null, %L, 10000)', 'Original', 'cash'), 'SALES_DISABLED');
end $$;

select 'ALL SQL ASSERTIONS PASSED' as result;
