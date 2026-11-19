-- =====================================================================
-- ทดสอบ 0005: BURN BARU CLUB (สมาชิก / แต้ม / แสตมป์ / Tier / คูปอง / Claim QR / Outbox / สิทธิ์)
-- รันต่อจาก financial.test.sql และ queue.test.sql (ใช้ผู้ใช้ owner/mgr/cashier, กะที่เปิดอยู่, สินค้า seed)
-- ตัวเลขกติกาในไฟล์นี้ (อัตราแต้ม, เกณฑ์ Tier ฯลฯ) เป็น "ค่าทดสอบ" เท่านั้น ไม่ใช่ค่าที่แนะนำให้ใช้จริง
-- =====================================================================

create function t.svc(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  execute 'set local role service_role';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $$;

create function t.svc0(p_sql text) returns void language plpgsql as $$
begin
  execute 'set local role service_role';
  execute p_sql;
  execute 'reset role';
end $$;

create function t.fails_svc(p_label text, p_sql text, p_code text) returns void language plpgsql as $$
declare v_msg text;
begin
  begin
    execute 'set local role service_role';
    execute p_sql;
    v_msg := null;
  exception when others then
    v_msg := sqlerrm;
  end;
  execute 'reset role';
  if v_msg is null then raise exception 'FAIL [%]: expected error "%" but succeeded', p_label, p_code; end if;
  if v_msg not like p_code || '%' then raise exception 'FAIL [%]: expected "%" got "%"', p_label, p_code, v_msg; end if;
  raise notice 'ok - % [%]', p_label, p_code;
end $$;

-- checkout ในนามพนักงาน (ผ่าน checkout_member_order) พร้อมลูกค้า/คูปอง
create function t.mc(p_user text, p_cust uuid, p_items jsonb, p_coupon uuid default null, p_discount uuid default null,
                     p_key uuid default gen_random_uuid(), p_method text default 'cash', p_received integer default 100000)
returns uuid language plpgsql as $$
declare v uuid;
begin
  perform t.login(p_user);
  v := public.checkout_member_order(p_key, t.shift(), p_items, p_discount, p_method, p_received, null, p_cust, null, p_coupon);
  perform t.logout();
  return v;
end $$;

create function t.cake(p_qty integer default 1) returns jsonb language sql stable as
$$ select jsonb_build_array(t.item('Original', p_qty)) $$;
create function t.drink(p_qty integer default 1) returns jsonb language sql stable as
$$ select jsonb_build_array(t.item('Apple Tea', p_qty, 'Matcha & Tea')) $$;

create function t.pts(p_cust uuid) returns integer language sql stable as
$$ select points_balance from public.member_profiles where customer_id = p_cust $$;
create function t.stm(p_cust uuid) returns integer language sql stable as
$$ select stamps_balance from public.member_profiles where customer_id = p_cust $$;
create function t.tier(p_cust uuid) returns text language sql stable as
$$ select t.code from public.member_profiles p join public.membership_tiers t on t.id = p.tier_id where p.customer_id = p_cust $$;
create function t.nledger(p_cust uuid, p_cur text, p_kind text) returns bigint language sql stable as
$$ select count(*) from public.member_ledger where customer_id = p_cust and currency = p_cur and kind = p_kind $$;
create function t.nout(p_cust uuid, p_event text) returns bigint language sql stable as
$$ select count(*) from public.notification_outbox where customer_id = p_cust and event_type = p_event $$;

-- =====================================================================
-- M0. เตรียม: ราคาเครื่องดื่ม, เปิดขาย/ลูกค้า, ส่วนลดตัวอย่าง (ยังไม่เปิดระบบสมาชิก)
-- =====================================================================
do $$
begin
  update public.products set price_satang = 6000 where price_satang is null;
  perform t.as('owner', 'update public.settings set sales_enabled = true, customers_enabled = true');
  insert into public.discounts(name, kind, value) values ('MEMBER10', 'percent', 1000), ('FIX20', 'fixed', 2000);
  perform t.n('M0 ค่าเริ่มต้น: ระบบสมาชิกปิดอยู่', (select count(*) from public.loyalty_settings where not membership_enabled and not points_enabled and satang_per_point is null), 1);
  perform t.n('M0 Tier 3 ระดับ', (select count(*) from public.membership_tiers), 3);
  perform t.n('M0 เกณฑ์ SIGNATURE/BURN CLUB ยังไม่อนุมัติ = NULL',
              (select count(*) from public.membership_tiers where code in ('SIGNATURE','THE_BURN_CLUB') and min_rolling_spend_satang is null), 2);
end $$;

-- =====================================================================
-- M1. สมัครสมาชิกที่เคาน์เตอร์
-- =====================================================================
do $$
declare v jsonb; v_c uuid; v_plain uuid;
begin
  perform t.fails('M1 ต้องยอมรับ Privacy', 'cashier',
    $q$select public.pos_register_member('ก','0812345678',null,false,false)$q$, 'CONSENT_REQUIRED');
  perform t.fails('M1 เบอร์ไม่ถูกต้อง', 'cashier',
    $q$select public.pos_register_member('ก','12345',null,true,false)$q$, 'INVALID_PHONE');
  perform t.fails('M1 ต้องเข้าสู่ระบบ', 'stranger',
    $q$select public.pos_register_member('ก','0812345678',null,true,false)$q$, 'NOT_AUTHENTICATED');

  perform t.login('cashier');
  v := public.pos_register_member('สมชาย ทดสอบ', '081-234-5678', date '1990-05-20', true, false);
  perform t.logout();
  v_c := (v->>'customer_id')::uuid;
  perform t.put('m1', v_c);
  perform t.s('M1 เลขสมาชิก BB-00001', v->>'member_no', 'BB-00001');
  perform t.s('M1 เริ่มที่ FIRST BITE', v->>'tier_code', 'FIRST_BITE');
  perform t.s('M1 เบอร์ถูก normalize', (select phone_norm from public.member_profiles where customer_id = v_c), '0812345678');
  perform t.n('M1 ได้ event registered', (select count(*) from public.member_events where customer_id = v_c and kind = 'registered'), 1);
  perform t.fails('M1 เบอร์ซ้ำ', 'cashier',
    $q$select public.pos_register_member('คนอื่น','+66 81 234 5678',null,true,false)$q$, 'PHONE_ALREADY_MEMBER');

  -- ลูกค้าเดิมของ POS (ยังไม่เป็นสมาชิก): สมัครใหม่ด้วยเบอร์เดียวกันต้องไม่ผ่าน ให้ยกระดับลูกค้าเดิมแทน
  insert into public.customers(name, phone) values ('ลูกค้าเดิม POS', '089-000-1111') returning id into v_plain;
  perform t.put('plain', v_plain);
  perform t.fails('M1 เบอร์ตรงกับลูกค้าเดิม → ให้ผูกที่เคาน์เตอร์', 'cashier',
    $q$select public.pos_register_member('ใหม่','0890001111',null,true,false)$q$, 'PHONE_EXISTS_ASK_STAFF');
  perform t.login('cashier');
  v := public.pos_register_member('ลูกค้าเดิม POS', '0890001111', null, true, true, v_plain);
  perform t.logout();
  perform t.s('M1 ยกระดับลูกค้าเดิมเป็นสมาชิก', v->>'member_no', 'BB-00002');
  perform t.fails('M1 ยกระดับซ้ำ', 'cashier',
    format($q$select public.pos_register_member('x','0890001111',null,true,true,%L)$q$, v_plain), 'ALREADY_MEMBER');
end $$;

-- =====================================================================
-- M2. ค้นหาสมาชิก (แคชเชียร์ใช้ผ่านฟังก์ชันเท่านั้น)
-- =====================================================================
do $$
declare v jsonb; v_qr text;
begin
  select qr_ref into v_qr from public.member_profiles where member_no = 'BB-00001';
  perform t.login('cashier');
  v := public.pos_find_member('5678');
  perform t.n('M2 ค้นด้วยเบอร์ 4 ตัวท้าย', jsonb_array_length(v), 1);
  perform t.s('M2 ผลมีชื่อ', v->0->>'name', 'สมชาย ทดสอบ');
  perform t.n('M2 ค้นด้วยเลขสมาชิก (ไม่สนตัวพิมพ์)', jsonb_array_length(public.pos_find_member('bb-00002')), 1);
  perform t.n('M2 ค้นด้วยชื่อบางส่วน', jsonb_array_length(public.pos_find_member('สมชาย')), 1);
  perform t.n('M2 คำค้นสั้นเกินไป = ว่าง', jsonb_array_length(public.pos_find_member('ส')), 0);
  perform t.n('M2 ไม่รู้จัก = ว่าง', jsonb_array_length(public.pos_find_member('zzzzzz')), 0);
  perform t.n('M2 ค้นผ่าน qr_ref',
              (public.pos_member_by_qr_ref(v_qr)->>'member_no' = 'BB-00001')::int, 1);
  perform t.n('M2 qr_ref มั่ว = null', (public.pos_member_by_qr_ref('nope') is null)::int, 1);
  perform t.logout();
  perform t.login('cashier'); perform t.n('M2 แคชเชียร์อ่านตาราง member_profiles ตรงไม่ได้ (RLS 0 แถว)', (select count(*) from public.member_profiles), 0); perform t.logout();
  perform t.login('mgr'); perform t.n('M2 แต่ผู้จัดการอ่านได้', (select count(*) from public.member_profiles), 2); perform t.logout();
end $$;

-- =====================================================================
-- M3. ระบบสมาชิกปิดอยู่ = ขายได้ตามปกติ ไม่ให้แต้ม; เปิดแล้ว reconcile ซ่อมย้อนหลังได้
-- =====================================================================
do $$
declare v_m uuid := t.id('m1'); v_o uuid; v_n integer;
begin
  v_o := t.mc('cashier', v_m, t.cake());
  perform t.put('o_disabled', v_o);
  perform t.n('M3 ขายสำเร็จขณะปิดระบบสมาชิก', (select count(*) from public.orders where id = v_o and customer_id = v_m), 1);
  perform t.n('M3 ไม่มีการเชื่อมสมาชิก', (select count(*) from public.member_order_links where order_id = v_o), 0);
  perform t.as('owner', 'update public.loyalty_settings set membership_enabled = true');
  perform t.fails('M3 reconcile สิทธิ์: cashier ไม่ได้', 'cashier', 'select public.membership_reconcile(7)', 'FORBIDDEN');
  perform t.login('mgr'); v_n := public.membership_reconcile(7); perform t.logout();
  perform t.n('M3 reconcile ประมวลผล 1 ออเดอร์', v_n, 1);
  perform t.s('M3 via = reconcile', (select via from public.member_order_links where order_id = v_o), 'reconcile');
  perform t.n('M3 reconcile ซ้ำ = 0', (select public.membership_reconcile_internal(7)), 0);
  perform t.n('M3 ยังไม่ตั้งอัตราแต้ม = ไม่ได้แต้ม', t.pts(v_m), 0);
  perform t.n('M3 ยอดสะสมนับแล้ว 5900', public._rolling_spend(v_m), 5900);
end $$;

-- =====================================================================
-- M4. แต้ม: ตามอัตราที่ตั้ง, ฐานหลัง/ก่อนส่วนลด, idempotent, ไม่ให้แต้มถ้าชำระไม่สำเร็จ
-- =====================================================================
do $$
declare v_m uuid := t.id('m1'); v_o uuid; v_key uuid := gen_random_uuid(); v_o2 uuid; v_disc uuid;
begin
  perform t.as('owner', 'update public.loyalty_settings set points_enabled = true, satang_per_point = 1000');
  v_o := t.mc('cashier', v_m, t.cake(), null, null, v_key);        -- 5900 สตางค์ → 5 แต้ม
  perform t.n('M4 ได้ 5 แต้ม (5900/1000 ปัดลง)', t.pts(v_m), 5);
  perform t.n('M4 ledger EARN 1 แถว', t.nledger(v_m, 'points', 'EARN'), 1);
  v_o2 := t.mc('cashier', v_m, t.cake(), null, null, v_key);       -- key เดิม = ออเดอร์เดิม
  perform t.s('M4 ส่งซ้ำ key เดิม = ออเดอร์เดิม', v_o2::text, v_o::text);
  perform t.n('M4 ส่งซ้ำไม่ให้แต้มซ้ำ', t.pts(v_m), 5);
  perform t.s('M4 balance_after ถูกต้อง', (select balance_after::text from public.member_ledger where order_id = v_o and currency = 'points'), '5');
  perform t.n('M4 first_try ของสินค้า Original', (select count(*) from public.member_events where customer_id = v_m and kind = 'first_try'), 1);

  -- ฐานหลังส่วนลด (ค่าเริ่มต้น): 2 ชิ้น 11800 − 10% = 10620 → 10 แต้ม
  select id into v_disc from public.discounts where name = 'MEMBER10';
  v_o := t.mc('cashier', v_m, t.cake(2), null, v_disc);
  perform t.n('M4 ฐานหลังส่วนลด 10620 → 10 แต้ม', (select points_earned from public.member_order_links where order_id = v_o), 10);
  perform t.as('owner', $q$update public.loyalty_settings set earn_basis = 'gross_before_discount'$q$);
  v_o := t.mc('cashier', v_m, t.cake(2), null, v_disc);
  perform t.n('M4 ฐานก่อนส่วนลด 11800 → 11 แต้ม', (select points_earned from public.member_order_links where order_id = v_o), 11);
  perform t.as('owner', $q$update public.loyalty_settings set earn_basis = 'net_after_discount'$q$);
  perform t.n('M4 รวมแต้ม 5+10+11', t.pts(v_m), 26);

  -- ชำระไม่สำเร็จ = ไม่ให้แต้ม
  perform t.fails('M4 เงินไม่พอ', 'cashier',
    format($q$select public.checkout_member_order(gen_random_uuid(), t.shift(), t.cake(), null, 'cash', 100, null, %L, null, null)$q$, v_m),
    'INSUFFICIENT_PAYMENT');
  perform t.n('M4 ชำระล้มเหลวแล้วแต้มไม่เปลี่ยน', t.pts(v_m), 26);

  -- ลูกค้าที่ไม่ใช่สมาชิก / Guest ขายได้ปกติ ไม่มีแต้ม
  v_o := t.mc('cashier', t.id('plain'), t.cake());
  perform t.n('M4 ลูกค้าเดิม (สมาชิก BB-00002 ไม่ผูก LINE) ได้แต้มด้วย', t.pts(t.id('plain')), 5);
  v_o := t.mc('cashier', null, t.cake());
  perform t.n('M4 Guest ไม่มีการเชื่อมสมาชิก', (select count(*) from public.member_order_links where order_id = v_o), 0);
end $$;

-- =====================================================================
-- M5. แสตมป์: เครื่องดื่ม 1 แก้ว = 1 ดวง, ครบเกณฑ์ → คูปองรางวัลอัตโนมัติ
-- =====================================================================
do $$
declare v_m uuid := t.id('m1'); v_o uuid; v_led uuid;
begin
  perform t.as('owner', 'update public.loyalty_settings set stamps_enabled = true, stamps_per_reward = 3');
  v_o := t.mc('cashier', v_m, t.cake());
  perform t.n('M5 เค้กไม่ได้แสตมป์', t.stm(v_m), 0);
  v_o := t.mc('cashier', v_m, t.drink(2));
  perform t.n('M5 เครื่องดื่ม 2 แก้ว = 2 ดวง', t.stm(v_m), 2);
  v_o := t.mc('cashier', v_m, t.drink(2));                       -- 2+2 = 4 → ครบ 3 → แลกคูปอง เหลือ 1
  perform t.n('M5 ครบเกณฑ์แล้วเหลือ 1', t.stm(v_m), 1);
  perform t.n('M5 สะสมตลอดชีพ 4', (select stamps_lifetime from public.member_profiles where customer_id = v_m), 4);
  perform t.n('M5 ออกคูปองรางวัล 1 ใบ', (select count(*) from public.member_coupons where customer_id = v_m and source = 'reward' and status = 'unused'), 1);
  perform t.n('M5 ledger REDEEM −3', (select -amount from public.member_ledger where customer_id = v_m and currency = 'stamps' and kind = 'REDEEM'), 3);
  perform t.n('M5 วันหมดอายุ ~90 วัน',
              (select round(extract(epoch from expires_at - issued_at) / 86400)::int from public.member_coupons where customer_id = v_m and source = 'reward'), 90);
  -- ข้ามเกณฑ์หลายครั้งในบิลเดียว: 1 + 7 = 8 → ได้ 2 ใบ เหลือ 2
  v_o := t.mc('cashier', v_m, t.drink(7));
  perform t.n('M5 ข้ามเกณฑ์ 2 ครั้ง เหลือ 2', t.stm(v_m), 2);
  perform t.n('M5 รวมคูปองรางวัล 3 ใบ', (select count(*) from public.member_coupons where customer_id = v_m and source = 'reward'), 3);
end $$;

-- =====================================================================
-- M6. Tier: เลื่อนทันทีเมื่อถึงเกณฑ์ (ค่าทดสอบ), มีประวัติ/เหตุการณ์/แจ้งเตือน; ไม่ลดอัตโนมัติถ้าไม่เปิด
-- =====================================================================
do $$
declare v_m uuid := t.id('m1');
begin
  perform t.s('M6 ก่อนตั้งเกณฑ์: ยังเป็น FIRST BITE', t.tier(v_m), 'FIRST_BITE');
  perform t.as('owner', 'update public.membership_tiers set min_rolling_spend_satang = 40000 where code = ''SIGNATURE''');
  perform t.as('owner', 'update public.membership_tiers set min_rolling_spend_satang = 500000 where code = ''THE_BURN_CLUB''');
  perform t.n('M6 ยอดสะสมสุทธิ > 40000', (public._rolling_spend(v_m) > 40000)::int, 1);
  perform t.n('M6 ตั้งเกณฑ์อย่างเดียวยังไม่เลื่อน (เลื่อนเมื่อมีการซื้อ)', (t.tier(v_m) = 'FIRST_BITE')::int, 1);
  perform t.mc('cashier', v_m, t.cake());
  perform t.s('M6 เลื่อนเป็น SIGNATURE ทันที', t.tier(v_m), 'SIGNATURE');
  perform t.n('M6 มีประวัติ Tier', (select count(*) from public.member_tier_history where customer_id = v_m), 1);
  perform t.n('M6 มี event tier_changed', (select count(*) from public.member_events where customer_id = v_m and kind = 'tier_changed'), 1);
  perform t.n('M6 ไม่เลื่อนข้ามขั้น (ยอดไม่ถึง BURN CLUB)', (t.tier(v_m) <> 'THE_BURN_CLUB')::int, 1);
  perform t.n('M6 ความคืบหน้า: เหลืออีกไปขั้นถัดไป',
              (public._tier_progress(v_m)->'next'->>'remaining_satang')::int, 500000 - public._rolling_spend(v_m)::int);
end $$;

-- =====================================================================
-- M7. คืนเงิน: ย้อนแต้มตามสัดส่วน, ย้อนแสตมป์เมื่อคืนเต็ม, ไม่ย้อนซ้ำ, Tier ไม่ลดถ้าไม่เปิดนโยบาย
-- =====================================================================
do $$
declare
  v_m uuid := t.id('m1'); v_o uuid; v_p0 integer; v_s0 integer; v_ref uuid := gen_random_uuid();
  v_pts_order integer; v_o2 uuid;
begin
  v_o := t.mc('cashier', v_m, t.cake(2));                                  -- 11800 → 11 แต้ม
  v_p0 := t.pts(v_m);
  perform t.n('M7 ออเดอร์นี้ได้ 11 แต้ม', (select points_earned from public.member_order_links where order_id = v_o), 11);
  -- คืนบางส่วน 5900/11800 = ครึ่ง → floor(11*0.5) = 5
  perform t.login('mgr'); perform public.refund_order(v_ref, v_o, 5900, 'cash', 'ทดสอบคืนบางส่วน'); perform t.logout();
  perform t.n('M7 คืนครึ่ง ย้อน 5 แต้ม', t.pts(v_m), v_p0 - 5);
  perform t.login('mgr'); perform public.refund_order(v_ref, v_o, 5900, 'cash', 'ทดสอบคืนบางส่วน'); perform t.logout();   -- key เดิม
  perform t.n('M7 คืนเงินซ้ำ (key เดิม) ไม่ย้อนซ้ำ', t.pts(v_m), v_p0 - 5);
  perform t.login('mgr'); perform public.refund_order(gen_random_uuid(), v_o, 5900, 'cash', 'คืนส่วนที่เหลือ'); perform t.logout();
  perform t.n('M7 คืนเต็ม ย้อนครบ 11 แต้ม', t.pts(v_m), v_p0 - 11);
  perform t.n('M7 ledger REFUND_REVERSAL 2 แถว', t.nledger(v_m, 'points', 'REFUND_REVERSAL'), 2);
  perform t.n('M7 ออเดอร์ที่คืนเต็มไม่ถูกนับเป็นยอดสะสม',
              (select count(*) from public.orders o where o.id = v_o and o.payment_status = 'refunded'), 1);

  -- แสตมป์: คืนเต็มออเดอร์เครื่องดื่ม → ย้อนแสตมป์
  perform t.as('owner', 'update public.loyalty_settings set stamps_per_reward = 10');
  v_o2 := t.mc('cashier', v_m, t.drink(1));
  v_s0 := t.stm(v_m) - 1;
  perform t.login('mgr'); perform public.refund_order(gen_random_uuid(), v_o2, (select total_satang from public.orders where id = v_o2), 'cash', 'คืนเครื่องดื่ม'); perform t.logout();
  perform t.n('M7 คืนเต็ม ย้อนแสตมป์ 1 ดวง', t.stm(v_m), v_s0);

  -- Tier ไม่ลดอัตโนมัติ (เปิดนโยบายไว้ที่ปิด): ยอดสะสมลดลงแล้วยังเป็น SIGNATURE
  perform t.s('M7 ไม่ลด Tier เมื่อปิด tier_downgrade_enabled', t.tier(v_m), 'SIGNATURE');
end $$;

-- ย้อนแต้มเมื่อยอดคงเหลือไม่พอ = ย้อนเท่าที่มี และบันทึก SHORTFALL (ยอดไม่ติดลบ)
do $$
declare v_m uuid; v_o uuid; v_bal integer; v_take integer;
begin
  perform t.login('cashier');
  v_m := (public.pos_register_member('ทดสอบ Shortfall', '0855550000', null, true, false)->>'customer_id')::uuid;
  perform t.logout();
  perform t.put('short', v_m);
  v_o := t.mc('cashier', v_m, t.cake(2));                                  -- 11 แต้ม
  perform t.n('M7b ได้ 11 แต้ม', t.pts(v_m), 11);
  perform t.as('mgr', format($q$select public.member_adjust_points(%L, 'points', -8, 'ปรับลดทดสอบ', 'short-1')$q$, v_m));
  perform t.n('M7b เหลือ 3 แต้ม', t.pts(v_m), 3);
  perform t.login('mgr'); perform public.refund_order(gen_random_uuid(), v_o, 11800, 'cash', 'คืนเต็ม'); perform t.logout();
  perform t.n('M7b ย้อนเท่าที่มี → 0 ไม่ติดลบ', t.pts(v_m), 0);
  perform t.n('M7b มีบันทึก SHORTFALL', (select count(*) from public.member_ledger where customer_id = v_m and note like 'SHORTFALL%'), 1);
end $$;

-- =====================================================================
-- M8. คูปอง: ใช้ตอน checkout (ส่วนลดจาก discounts เดิม), กันใช้ซ้ำ/ผิดเจ้าของ/หมดอายุ/ขั้นต่ำ/Tier, อ่านย้อนไม่ได้
-- =====================================================================
do $$
declare
  v_m uuid := t.id('m1'); v_other uuid := t.id('plain'); v_tpl uuid; v_tpl_min uuid; v_tpl_old uuid; v_tpl_free uuid;
  v_tpl_tier uuid; v_c uuid; v_o uuid; v_disc uuid; v_fix uuid; v_before bigint; v_pts integer;
begin
  select id into v_disc from public.discounts where name = 'MEMBER10';
  select id into v_fix  from public.discounts where name = 'FIX20';
  perform t.login('mgr');
  insert into public.coupon_templates(title, source, discount_id, expire_days) values ('ลด 10%', 'promotion', v_disc, 30) returning id into v_tpl;
  insert into public.coupon_templates(title, source, discount_id, expire_days, min_spend_satang) values ('ลด 10% ขั้นต่ำ 200', 'promotion', v_disc, 30, 20000) returning id into v_tpl_min;
  insert into public.coupon_templates(title, source, discount_id, expire_at) values ('หมดอายุแล้ว', 'promotion', v_fix, now() - interval '1 day') returning id into v_tpl_old;
  insert into public.coupon_templates(title, source, expire_days) values ('ฟรี 1 แก้ว (พนักงานมอบ)', 'manual', 30) returning id into v_tpl_free;
  insert into public.coupon_templates(title, source, discount_id, expire_days, min_tier_id)
    select 'เฉพาะ BURN CLUB', 'promotion', v_disc, 30, id from public.membership_tiers where code = 'THE_BURN_CLUB' returning id into v_tpl_tier;
  perform t.logout();
  perform t.fails('M8 แคชเชียร์สร้างแม่แบบไม่ได้', 'cashier',
    $q$insert into public.coupon_templates(title, source, expire_days) values ('x','manual',1)$q$, 'new row violates');
  perform t.fails('M8 แม่แบบต้องมีกติกาหมดอายุ', 'mgr',
    $q$insert into public.coupon_templates(title, source) values ('x','manual')$q$, 'new row for relation');

  -- ออกให้สมาชิก (ผู้จัดการ) แล้วใช้ตอนชำระ
  perform t.login('mgr'); v_c := public.issue_manual_coupon(v_m, v_tpl, 'k1'); perform t.logout();
  perform t.n('M8 ออกคูปองแล้ว', (select count(*) from public.member_coupons where id = v_c and status = 'unused'), 1);
  perform t.login('mgr'); perform t.n('M8 ออกซ้ำด้วย key เดิมไม่ซ้ำ', (public.issue_manual_coupon(v_m, v_tpl, 'k1') is null)::int, 1); perform t.logout();
  perform t.fails('M8 คูปองของคนอื่น', 'cashier',
    format($q$select public.checkout_member_order(gen_random_uuid(), t.shift(), t.cake(), null, 'cash', 100000, null, %L, null, %L)$q$, v_other, v_c),
    'COUPON_NOT_OWNED');
  perform t.fails('M8 คูปองต้องมีสมาชิก', 'cashier',
    format($q$select public.checkout_member_order(gen_random_uuid(), t.shift(), t.cake(), null, 'cash', 100000, null, null, null, %L)$q$, v_c),
    'COUPON_REQUIRES_MEMBER');
  perform t.fails('M8 ส่วนลดซ้อนคูปองไม่ได้', 'cashier',
    format($q$select public.checkout_member_order(gen_random_uuid(), t.shift(), t.cake(), %L, 'cash', 100000, null, %L, null, %L)$q$, v_fix, v_m, v_c),
    'DISCOUNT_CONFLICT');
  select count(*) into v_before from public.orders;
  v_pts := t.pts(v_m);
  v_o := t.mc('cashier', v_m, t.cake(2), v_c);                              -- 11800 − 10% = 10620
  perform t.n('M8 ใช้คูปองลด 10%: ยอดสุทธิ 10620', (select total_satang from public.orders where id = v_o), 10620);
  perform t.s('M8 คูปองถูกใช้พร้อมผูกออเดอร์', (select status || ':' || (used_order_id = v_o)::text from public.member_coupons where id = v_c), 'used:true');
  perform t.n('M8 ใช้คูปองแล้วยังได้แต้มจากยอดสุทธิ', t.pts(v_m) - v_pts, 10);
  perform t.fails('M8 ใช้ซ้ำไม่ได้', 'cashier',
    format($q$select public.checkout_member_order(gen_random_uuid(), t.shift(), t.cake(), null, 'cash', 100000, null, %L, null, %L)$q$, v_m, v_c),
    'COUPON_ALREADY_USED');
  perform t.fails('M8 คูปองที่ใช้แล้วย้อนสถานะไม่ได้ (trigger)', 'postgres',
    format($q$update public.member_coupons set status = 'unused', used_at = null, used_order_id = null where id = %L$q$, v_c), 'COUPON_STATUS_FINAL');
  perform t.fails('M8 ลบคูปองไม่ได้', 'postgres', format($q$delete from public.member_coupons where id = %L$q$, v_c), 'IMMUTABLE_RECORD');

  -- หมดอายุ
  perform t.login('mgr'); v_c := public.issue_manual_coupon(v_m, v_tpl_old, 'old'); perform t.logout();
  perform t.fails('M8 คูปองหมดอายุ', 'cashier',
    format($q$select public.checkout_member_order(gen_random_uuid(), t.shift(), t.cake(), null, 'cash', 100000, null, %L, null, %L)$q$, v_m, v_c),
    'COUPON_EXPIRED');

  -- ขั้นต่ำ: ล้มเหลว = rollback ทั้งออเดอร์ (ไม่มีออเดอร์ค้าง, คูปองยังไม่ถูกใช้)
  perform t.login('mgr'); v_c := public.issue_manual_coupon(v_m, v_tpl_min, 'min'); perform t.logout();
  select count(*) into v_before from public.orders;
  perform t.fails('M8 ไม่ถึงยอดขั้นต่ำ', 'cashier',
    format($q$select public.checkout_member_order(gen_random_uuid(), t.shift(), t.cake(), null, 'cash', 100000, null, %L, null, %L)$q$, v_m, v_c),
    'COUPON_MIN_SPEND');
  perform t.n('M8 ล้มแล้วไม่มีออเดอร์ค้าง', (select count(*) from public.orders), v_before);
  perform t.n('M8 ล้มแล้วคูปองยังไม่ถูกใช้', (select count(*) from public.member_coupons where id = v_c and status = 'unused'), 1);
  v_o := t.mc('cashier', v_m, t.cake(4), v_c);                              -- 23600 ≥ 20000
  perform t.n('M8 ถึงขั้นต่ำใช้ได้', (select count(*) from public.member_coupons where id = v_c and status = 'used'), 1);

  -- Tier ที่ต้องการ
  perform t.login('mgr'); v_c := public.issue_manual_coupon(v_m, v_tpl_tier, 'tier'); perform t.logout();
  perform t.fails('M8 Tier ไม่ถึง', 'cashier',
    format($q$select public.checkout_member_order(gen_random_uuid(), t.shift(), t.cake(), null, 'cash', 100000, null, %L, null, %L)$q$, v_m, v_c),
    'COUPON_TIER_NOT_ELIGIBLE');

  -- สิทธิ์ที่พนักงานมอบเอง (ไม่มีส่วนลด) ใช้ที่เคาน์เตอร์
  perform t.login('mgr'); v_c := public.issue_manual_coupon(v_m, v_tpl_free, 'free'); perform t.logout();
  perform t.login('cashier'); perform public.redeem_member_coupon(v_c, 'มอบเครื่องดื่มฟรี'); perform t.logout();
  perform t.s('M8 redeem ที่เคาน์เตอร์', (select status from public.member_coupons where id = v_c), 'used');
  perform t.fails('M8 redeem ซ้ำ', 'cashier', format($q$select public.redeem_member_coupon(%L, null)$q$, v_c), 'COUPON_ALREADY_USED');
  perform t.login('mgr'); v_c := public.issue_manual_coupon(v_m, v_tpl, 'k2'); perform t.logout();
  perform t.fails('M8 คูปองส่วนลดต้องใช้ตอนชำระ', 'cashier', format($q$select public.redeem_member_coupon(%L, null)$q$, v_c), 'COUPON_NEEDS_CHECKOUT');
  perform t.fails('M8 ยกเลิกคูปอง: แคชเชียร์ไม่ได้', 'cashier', format($q$select public.cancel_member_coupon(%L, 'x')$q$, v_c), 'FORBIDDEN');
  perform t.login('mgr'); perform public.cancel_member_coupon(v_c, 'ออกผิด'); perform t.logout();
  perform t.s('M8 ยกเลิกแล้วสถานะ cancelled', (select status from public.member_coupons where id = v_c), 'cancelled');
end $$;

-- =====================================================================
-- M9. LIFF: สมัครด้วย LINE, ข้อมูลของตัวเอง, แลกแต้ม (Point Exchange), เลิกผูก
-- =====================================================================
do $$
declare v jsonb; v_c uuid; v_tpl uuid; v_tpl_lim uuid; v_tpl_future uuid; v_tpl_off uuid; v_key text := 'claim-key-0001'; v_pts integer;
begin
  perform t.fails_svc('M9 ต้องยอมรับ Privacy', $q$select public.liff_register('Uline0001','Aom',null,'อ้อม','0866660001',null,false,false)$q$, 'CONSENT_REQUIRED');
  perform t.fails_svc('M9 เบอร์ซ้ำกับสมาชิกเดิม', $q$select public.liff_register('Uline0001','Aom',null,'อ้อม','081-234-5678',null,true,false)$q$, 'PHONE_ALREADY_MEMBER');
  v := t.svc($q$select public.liff_register('Uline0001','Aom','https://x/p.png','อ้อม','0866660001',date '1995-12-01',true,true)$q$);
  perform t.n('M9 สมัครผ่าน LIFF สำเร็จ', (v->>'linked')::boolean::int, 1);
  perform t.s('M9 ไม่เปิดเผย customer_id ให้ฝั่งลูกค้า', coalesce(v->'member'->>'customer_id', 'none'), 'none');
  v_c := public._customer_of_line('Uline0001');
  perform t.put('liff1', v_c);
  perform t.n('M9 ผูก LINE 1 รายการ', (select count(*) from public.customer_line_links where customer_id = v_c and unlinked_at is null), 1);
  perform t.n('M9 สมัครซ้ำด้วย LINE เดิม = idempotent (ไม่สร้างคนใหม่)',
              (select count(*) from public.customer_line_links where line_user_id = 'Uline0001'), 1);
  perform t.svc($q$select public.liff_register('Uline0001','Aom',null,'ชื่ออื่น','0877770002',null,true,false)$q$);
  perform t.n('M9 ไม่สร้างสมาชิกซ้ำ', (select count(*) from public.customers where name = 'ชื่ออื่น'), 0);
  perform t.n('M9 member ไม่มี LINE = linked false', (t.svc($q$select public.liff_get_member('Unknown999')$q$)->>'linked')::boolean::int, 0);
  perform t.fails_svc('M9 ส่วนที่ต้องเป็นสมาชิก (section) ไม่ใช่ → MEMBER_NOT_FOUND', $q$select public.liff_section('Unknown999','coupons')$q$, 'MEMBER_NOT_FOUND');

  -- ลูกค้ารายอื่นใช้ข้อมูลกันไม่ได้: ledger ของ liff1 ไม่รวมของ m1
  perform t.n('M9 section points เฉพาะของตัวเอง', jsonb_array_length(t.svc($q$select public.liff_section('Uline0001','points')$q$)), 0);

  -- แลกแต้ม
  perform t.as('owner', 'update public.loyalty_settings set points_enabled = true, satang_per_point = 1000');
  perform t.as('mgr', format($q$select public.member_adjust_points(%L, 'points', 10, 'โบนัสทดสอบ', 'liff1-bonus')$q$, v_c));
  perform t.n('M9 ปรับแต้มโดยผู้จัดการ +10', t.pts(v_c), 10);
  perform t.fails('M9 แคชเชียร์ปรับแต้มไม่ได้', 'cashier', format($q$select public.member_adjust_points(%L,'points',5,'x','z')$q$, v_c), 'FORBIDDEN');
  perform t.fails('M9 ปรับต้องมีเหตุผล', 'mgr', format($q$select public.member_adjust_points(%L,'points',5,'','z2')$q$, v_c), 'REASON_REQUIRED');
  perform t.as('mgr', format($q$select public.member_adjust_points(%L, 'points', 10, 'โบนัสทดสอบ', 'liff1-bonus')$q$, v_c));
  perform t.n('M9 ปรับซ้ำด้วย key เดิมไม่ซ้ำ', t.pts(v_c), 10);
  perform t.fails('M9 ปรับจนติดลบไม่ได้', 'mgr', format($q$select public.member_adjust_points(%L,'points',-11,'ลบเกิน','neg1')$q$, v_c), 'INSUFFICIENT_BALANCE');

  perform t.login('mgr');
  insert into public.coupon_templates(title, source, point_cost, expire_days) values ('แลก: ท็อปปิ้งฟรี', 'reward', 4, 60) returning id into v_tpl;
  insert into public.coupon_templates(title, source, point_cost, expire_days, quantity_limit) values ('จำกัด 1 สิทธิ์', 'reward', 1, 60, 1) returning id into v_tpl_lim;
  insert into public.coupon_templates(title, source, point_cost, expire_days, claim_start_at) values ('ยังไม่เริ่ม', 'reward', 1, 60, now() + interval '1 day') returning id into v_tpl_future;
  insert into public.coupon_templates(title, source, point_cost, expire_days, active) values ('ปิดใช้งาน', 'reward', 1, 60, false) returning id into v_tpl_off;
  perform t.logout();
  perform t.n('M9 รายการรางวัลที่แลกได้แสดง 2 รายการ (ซ่อนที่ยังไม่เริ่ม/ปิด)',
              jsonb_array_length(t.svc($q$select public.liff_section('Uline0001','rewards')$q$)), 2);

  v := t.svc(format($q$select public.liff_claim_reward('Uline0001', %L, %L)$q$, v_tpl, v_key));
  perform t.n('M9 แลกสำเร็จ หัก 4 แต้ม', t.pts(v_c), 6);
  perform t.n('M9 ได้คูปอง 1 ใบ', (select count(*) from public.member_coupons where customer_id = v_c and template_id = v_tpl), 1);
  v := t.svc(format($q$select public.liff_claim_reward('Uline0001', %L, %L)$q$, v_tpl, v_key));
  perform t.n('M9 ส่งซ้ำ key เดิม = duplicate ไม่หักซ้ำ', t.pts(v_c), 6);
  perform t.s('M9 ตอบกลับว่า duplicate', v->>'duplicate', 'true');
end $$;

-- (ตรวจเงื่อนไขการแลกแต้มที่เหลือ: แยกบล็อกเพื่อความชัดเจน)
do $$
declare v_c uuid := t.id('liff1'); v_tpl uuid; v_tpl_lim uuid; v_future uuid; v_off uuid; v_m1 uuid := t.id('m1');
begin
  select id into v_tpl from public.coupon_templates where title = 'แลก: ท็อปปิ้งฟรี';
  select id into v_tpl_lim from public.coupon_templates where title = 'จำกัด 1 สิทธิ์';
  select id into v_future from public.coupon_templates where title = 'ยังไม่เริ่ม';
  select id into v_off from public.coupon_templates where title = 'ปิดใช้งาน';
  perform t.as('mgr', format($q$select public.member_adjust_points(%L, 'points', -5, 'ปรับลดให้เหลือ 1', 'liff1-down')$q$, v_c));
  perform t.n('M9 เหลือ 1 แต้ม', t.pts(v_c), 1);
  perform t.fails_svc('M9 แต้มไม่พอ', format($q$select public.liff_claim_reward('Uline0001', %L, 'claim-key-0003')$q$, v_tpl), 'INSUFFICIENT_POINTS');
  perform t.fails_svc('M9 ยังไม่ถึงเวลารับสิทธิ์', format($q$select public.liff_claim_reward('Uline0001', %L, 'claim-key-0004')$q$, v_future), 'CLAIM_NOT_STARTED');
  perform t.fails_svc('M9 แม่แบบปิดใช้งาน', format($q$select public.liff_claim_reward('Uline0001', %L, 'claim-key-0005')$q$, v_off), 'TEMPLATE_NOT_FOUND');
  perform t.fails_svc('M9 key สั้นเกิน', format($q$select public.liff_claim_reward('Uline0001', %L, 'k')$q$, v_tpl), 'INVALID_INPUT');
  perform t.n('M9 แต้มไม่เปลี่ยนหลังแลกล้มเหลวทั้งหมด', t.pts(v_c), 1);
  -- โควตาจำกัด 1 สิทธิ์: ผู้แลกคนแรกสำเร็จ คนที่สองได้ QUANTITY_EXCEEDED
  perform t.svc(format($q$select public.liff_claim_reward('Uline0001', %L, 'claim-key-0006')$q$, v_tpl_lim));
  perform t.as('mgr', format($q$select public.member_adjust_points(%L, 'points', 5, 'ให้สมาชิกอีกคน', 'm1-give')$q$, v_m1));
  perform t.svc($q$select public.liff_register('Uline0002','Bank',null,'แบงค์','0866660002',null,true,false)$q$);
  perform t.as('mgr', format($q$select public.member_adjust_points(%L, 'points', 5, 'ให้แบงค์', 'bank-give')$q$, public._customer_of_line('Uline0002')));
  perform t.fails_svc('M9 โควตาเต็ม', format($q$select public.liff_claim_reward('Uline0002', %L, 'claim-key-0007')$q$, v_tpl_lim), 'QUANTITY_EXCEEDED');
  perform t.n('M9 โควตาเต็มแล้วแต้มไม่ถูกหัก', t.pts(public._customer_of_line('Uline0002')), 5);
end $$;

-- =====================================================================
-- M10. Claim QR: join / link / claim (รับแต้มย้อนหลัง), ใช้ได้ครั้งเดียว, หมดอายุ
-- =====================================================================
do $$
declare
  h1 text := encode(sha256('token-join-1'::bytea), 'hex'); h2 text := encode(sha256('token-claim-1'::bytea), 'hex');
  h3 text := encode(sha256('token-claim-2'::bytea), 'hex'); h4 text := encode(sha256('token-link-1'::bytea), 'hex');
  h5 text := encode(sha256('token-expired'::bytea), 'hex'); h6 text := encode(sha256('token-link-2'::bytea), 'hex');
  v jsonb; v_o uuid; v_c uuid; v_plain uuid := t.id('plain'); v_old_pts integer;
begin
  perform t.fails('M10 token ไม่ใช่ hash', 'cashier', $q$select public.pos_create_claim('abc','join')$q$, 'INVALID_INPUT');
  perform t.login('cashier'); perform public.pos_create_claim(h1, 'join'); perform t.logout();
  perform t.fails_svc('M10 join ต้องมีข้อมูลสมัคร', format($q$select public.claim_consume(%L,'Uline0003','Cat',null,null,null,null,null,null)$q$, h1), 'REGISTRATION_REQUIRED');
  perform t.n('M10 ยังไม่ใช้ token เมื่อต้องกรอกข้อมูล', (select count(*) from public.membership_claims where token_hash = h1 and used_at is null), 1);
  v := t.svc(format($q$select public.claim_consume(%L,'Uline0003','Cat',null,'แคท','0866660003',null,true,false)$q$, h1));
  perform t.s('M10 join สำเร็จ ลงทะเบียนใหม่', v->>'registered', 'true');
  perform t.fails_svc('M10 token ใช้ซ้ำไม่ได้', format($q$select public.claim_consume(%L,'Uline0003','Cat',null,'แคท','0866660003',null,true,false)$q$, h1), 'CLAIM_USED');
  perform t.fails_svc('M10 token ไม่มีอยู่', $q$select public.claim_consume(repeat('0',64),'Uline0003','Cat',null,null,null,null,null,null)$q$, 'CLAIM_INVALID');

  -- claim: ลูกค้าซื้อเป็น Guest แล้วสแกนเพื่อรับแต้มย้อนหลัง
  v_o := t.mc('cashier', null, t.cake(2));                                   -- 11800 → 11 แต้ม
  perform t.login('cashier');
  perform t.n('M10 claimable = true', (public.pos_order_membership(v_o)->>'claimable')::boolean::int, 1);
  perform public.pos_create_claim(h2, 'claim', null, v_o);
  perform t.logout();
  v_c := public._customer_of_line('Uline0003');
  v_old_pts := t.pts(v_c);
  v := t.svc(format($q$select public.claim_consume(%L,'Uline0003','Cat',null,null,null,null,null,null)$q$, h2));
  perform t.n('M10 รับแต้มย้อนหลัง 11 แต้ม', t.pts(v_c) - v_old_pts, 11);
  perform t.s('M10 via = claim', (select via from public.member_order_links where order_id = v_o), 'claim');
  perform t.n('M10 orders.customer_id ยังเป็น null (ข้อมูลการเงินไม่ถูกแก้)', (select count(*) from public.orders where id = v_o and customer_id is null), 1);
  perform t.login('cashier'); perform t.n('M10 ออเดอร์นี้ผูกสมาชิกแล้ว (ไม่ claimable อีก)', (public.pos_order_membership(v_o)->>'linked')::boolean::int, 1); perform t.logout();
  perform t.fails('M10 สร้าง claim ซ้ำบนออเดอร์ที่ถูก claim แล้ว', 'cashier', format($q$select public.pos_create_claim(%L,'claim',null,%L)$q$, h3, v_o), 'ORDER_HAS_MEMBER');
  perform t.fails('M10 ออเดอร์ที่มีสมาชิกอยู่แล้ว claim ไม่ได้', 'cashier',
    format($q$select public.pos_create_claim(%L,'claim',null,%L)$q$, h3, (select order_id from public.member_order_links where customer_id = t.id('m1') limit 1)), 'ORDER_HAS_MEMBER');

  -- หน้าต่างเวลา
  v_o := t.mc('cashier', null, t.cake());
  alter table public.orders disable trigger orders_guard_trg;
  update public.orders set created_at = now() - interval '3 days' where id = v_o;
  alter table public.orders enable trigger orders_guard_trg;
  perform t.fails('M10 เกินเวลา claim', 'cashier', format($q$select public.pos_create_claim(%L,'claim',null,%L)$q$, h3, v_o), 'CLAIM_WINDOW_PASSED');

  -- token หมดอายุ
  perform t.login('cashier'); perform public.pos_create_claim(h5, 'join'); perform t.logout();
  update public.membership_claims set expires_at = now() - interval '1 minute' where token_hash = h5;
  perform t.fails_svc('M10 token หมดอายุ', format($q$select public.claim_consume(%L,'Uline0004','Dog',null,'ด็อก','0866660004',null,true,false)$q$, h5), 'CLAIM_EXPIRED');

  -- link: ลูกค้าเดิมของ POS (plain) ผูก LINE
  perform t.login('cashier'); perform public.pos_create_claim(h4, 'link', v_plain); perform t.logout();
  perform t.fails('M10 link ลูกค้าที่ไม่ใช่สมาชิก', 'cashier',
    format($q$select public.pos_create_claim(%L,'link',%L)$q$, h6, (select id from public.customers where name = 'ลูกค้าเดิม POS' and id <> t.id('plain') limit 1)), 'MEMBER_NOT_FOUND');
  perform t.fails_svc('M10 LINE ที่ผูกกับคนอื่นอยู่แล้ว', format($q$select public.claim_consume(%L,'Uline0003','Cat',null,null,null,null,null,null)$q$, h4), 'LINE_ALREADY_LINKED');
  perform t.svc(format($q$select public.claim_consume(%L,'Uline0005','Eve',null,null,null,null,null,null)$q$, h4));
  perform t.n('M10 ผูก LINE กับลูกค้าเดิมสำเร็จ', (select count(*) from public.customer_line_links where customer_id = v_plain and unlinked_at is null), 1);
  perform t.fails('M10 ลูกค้าที่ผูก LINE แล้วสร้าง link ซ้ำไม่ได้', 'cashier', format($q$select public.pos_create_claim(%L,'link',%L)$q$, h6, v_plain), 'ALREADY_LINKED');
end $$;

-- =====================================================================
-- M11. เปลี่ยน/เลิกผูก LINE, วันเกิดแก้ไม่ได้เองหลังตั้ง, สิทธิ์ฟังก์ชัน LIFF
-- =====================================================================
do $$
declare v_c uuid := t.id('liff1'); v jsonb;
begin
  perform t.fails_svc('M11 วันเกิดถูกล็อกหลังตั้งแล้ว', $q$select public.liff_update_profile('Uline0001', null, date '1990-01-01', null, null)$q$, 'BIRTHDAY_LOCKED');
  v := t.svc($q$select public.liff_update_profile('Uline0001', 'อ้อมใหม่', null, false, true)$q$);
  perform t.s('M11 แก้ชื่อได้', v->'member'->>'name', 'อ้อมใหม่');
  perform t.s('M11 ถอนความยินยอมการตลาดได้', v->'member'->>'marketing_consent', 'false');
  perform t.svc0($q$select public.liff_unlink('Uline0001')$q$);
  perform t.n('M11 เลิกผูกแล้ว LINE นี้ไม่ใช่สมาชิก', (t.svc($q$select public.liff_get_member('Uline0001')$q$)->>'linked')::boolean::int, 0);
  perform t.n('M11 เก็บประวัติการผูกเดิม', (select count(*) from public.customer_line_links where customer_id = v_c and unlinked_at is not null), 1);
  perform t.n('M11 ข้อมูล/แต้มยังอยู่กับสมาชิก', (select count(*) from public.member_profiles where customer_id = v_c), 1);
  perform t.fails('M11 เลิกผูกโดยพนักงาน: cashier ไม่ได้', 'cashier', format($q$select public.pos_unlink_line(%L,'x')$q$, t.id('plain')), 'FORBIDDEN');
  perform t.fails('M11 เลิกผูกซ้ำ', 'mgr', format($q$select public.pos_unlink_line(%L,'ซ้ำ')$q$, v_c), 'NOT_LINKED');
  perform t.login('mgr'); perform public.pos_unlink_line(t.id('plain'), 'ลูกค้าเปลี่ยนบัญชี LINE'); perform t.logout();
  perform t.n('M11 พนักงานเลิกผูกให้ลูกค้า (เปลี่ยนบัญชี) สำเร็จ', (select count(*) from public.customer_line_links where customer_id = t.id('plain') and unlinked_at is null), 0);
  -- ผูก LINE ใหม่ให้ลูกค้าเดิมหลังเลิกผูก (บัญชีเดิมถูกปล่อยให้ผูกกับคนอื่นได้)
  perform t.login('cashier'); perform public.pos_create_claim(encode(sha256('relink'::bytea), 'hex'), 'link', t.id('plain')); perform t.logout();
  perform t.svc($q$select public.claim_consume(encode(sha256('relink'::bytea), 'hex'),'Uline0009','New',null,null,null,null,null,null)$q$);
  perform t.n('M11 ผูกบัญชี LINE ใหม่สำเร็จ', (select count(*) from public.customer_line_links where customer_id = t.id('plain') and unlinked_at is null and line_user_id = 'Uline0009'), 1);

  -- สิทธิ์ฟังก์ชัน: เฉพาะ service_role
  perform t.fails('M11 authenticated เรียก liff_get_member ไม่ได้', 'mgr', $q$select public.liff_get_member('Uline0003')$q$, 'permission denied');
  perform t.fails('M11 authenticated เรียก outbox_claim ไม่ได้', 'owner', $q$select public.outbox_claim(5)$q$, 'permission denied');
  perform t.fails('M11 authenticated เรียก _ledger_post ตรงไม่ได้', 'owner', format($q$select public._ledger_post(%L,'points','EARN',5,'hack')$q$, t.id('m1')), 'permission denied');
  perform t.fails('M11 authenticated เรียก import ไม่ได้', 'owner', $q$select public.import_line_oa_member('x',null,'n',null,null,0,0,null)$q$, 'permission denied');
  begin
    set local role anon;
    perform public.pos_find_member('abc');
    raise exception 'FAIL [M11 anon เรียก pos_find_member ได้]';
  exception when insufficient_privilege then
    reset role; raise notice 'ok - M11 anon เรียกฟังก์ชัน POS ไม่ได้';
  end;
  begin
    set local role anon;
    perform public.liff_get_member('Uline0003');
    raise exception 'FAIL [M11 anon เรียก liff_get_member ได้]';
  exception when insufficient_privilege then
    reset role; raise notice 'ok - M11 anon เรียกฟังก์ชัน LIFF ไม่ได้';
  end;
  begin
    set local role anon;
    perform count(*) from public.member_profiles;
    raise exception 'FAIL [M11 anon อ่านตารางสมาชิกได้]';
  exception when insufficient_privilege then
    reset role; raise notice 'ok - M11 anon อ่านตารางสมาชิกไม่ได้';
  end;
end $$;

-- =====================================================================
-- M12. Outbox: transactional/marketing, consent, dedupe, retry, สถานะ
-- =====================================================================
do $$
declare v_c uuid := t.id('liff1'); v_cat uuid := public._customer_of_line('Uline0003'); r jsonb; v_id uuid; v_n integer; v_att integer;
begin
  perform t.n('M12 ข้อความ welcome ของผู้สมัคร LIFF ถูกบันทึก', t.nout(v_c, 'member_registered'), 1);
  perform t.n('M12 แจ้งเตือนการซื้อ (แต้ม/ซื้อครั้งแรก) ของสมาชิกที่มี LINE เข้าคิว',
              (select count(*) from public.notification_outbox where customer_id = v_cat and event_type in ('points_earned','first_purchase') and status in ('pending','sending','sent')), 1);
  perform t.n('M12 สมาชิกไม่มี LINE (m1) = skipped NO_LINE',
              (select count(*) from public.notification_outbox where customer_id = t.id('m1') and status = 'skipped' and skip_reason = 'NO_LINE'), (select count(*) from public.notification_outbox where customer_id = t.id('m1')));
  -- การตลาดต้องมี consent
  perform public._notify(v_cat, 'marketing', 'promo_test', 'promo:1', '{}'::jsonb);
  perform t.s('M12 การตลาดโดยไม่มี consent ถูกข้าม', (select skip_reason from public.notification_outbox where dedupe_key = 'promo:1'), 'NO_MARKETING_CONSENT');
  update public.member_profiles set marketing_consent = true where customer_id = v_cat;
  perform public._notify(v_cat, 'marketing', 'promo_test', 'promo:2', '{}'::jsonb);
  perform t.s('M12 มี consent แล้วเข้าคิว', (select status from public.notification_outbox where dedupe_key = 'promo:2'), 'pending');
  perform public._notify(v_cat, 'marketing', 'promo_test', 'promo:3', '{}'::jsonb);
  perform t.s('M12 เพดานความถี่การตลาด', (select skip_reason from public.notification_outbox where dedupe_key = 'promo:3'), 'FREQUENCY_CAP');
  perform public._notify(v_cat, 'marketing', 'promo_test', 'promo:2', '{}'::jsonb);
  perform t.n('M12 dedupe_key เดิมไม่เพิ่มแถว', (select count(*) from public.notification_outbox where dedupe_key = 'promo:2'), 1);

  -- ดึงงานส่ง
  r := t.svc($q$select public.outbox_claim(50)$q$);
  perform t.n('M12 outbox_claim คืนงานที่ส่งได้', (jsonb_array_length(r) > 0)::int, 1);
  perform t.n('M12 ทุกงานที่ดึงมีบัญชี LINE',
              (select count(*) from jsonb_array_elements(r) e where e->>'line_user_id' is null), 0);
  perform t.n('M12 งานที่ดึงเป็นสถานะ sending', (select count(*) from public.notification_outbox where status = 'sending'), jsonb_array_length(r));
  perform t.n('M12 transactional มาก่อน marketing',
              (select (r->0->>'category' = 'transactional')::int), 1);
  perform t.n('M12 ดึงซ้ำไม่ได้งานเดิม', jsonb_array_length(t.svc($q$select public.outbox_claim(50)$q$)), 0);
  select id into v_id from public.notification_outbox where dedupe_key = 'promo:2';
  perform t.svc0(format($q$select public.outbox_complete(%L, true, null, true)$q$, v_id));
  perform t.s('M12 ส่งสำเร็จ = sent', (select status from public.notification_outbox where id = v_id), 'sent');
  -- ล้มเหลว: retry พร้อม backoff, เกิน 5 ครั้ง = failed
  select id into v_id from public.notification_outbox where status = 'sending' limit 1;
  if v_id is not null then
    perform t.svc0(format($q$select public.outbox_complete(%L, false, 'LINE 500', true)$q$, v_id));
    perform t.s('M12 ล้มเหลวแบบ retry ได้ → pending', (select status from public.notification_outbox where id = v_id), 'pending');
    perform t.n('M12 backoff ตั้งเวลาลองใหม่ในอนาคต', (select (next_attempt_at > now())::int from public.notification_outbox where id = v_id), 1);
    update public.notification_outbox set attempts = 5, status = 'sending' where id = v_id;
    perform t.svc0(format($q$select public.outbox_complete(%L, false, 'LINE 500', true)$q$, v_id));
    perform t.s('M12 ครบ 5 ครั้ง = failed', (select status from public.notification_outbox where id = v_id), 'failed');
  end if;
  -- ไม่เก็บ token ของคิวใน payload
  perform t.n('M12 payload ไม่มี token', (select count(*) from public.notification_outbox where payload::text ~ '[0-9a-f]{64}'), 0);
end $$;

-- คิวพร้อมรับ → แจ้งสมาชิกที่มี LINE (ผ่านปุ่มพร้อมของ KDS เดิม)
do $$
declare v_c uuid := public._customer_of_line('Uline0003'); v_o uuid; v_q uuid;
begin
  v_o := t.mc('cashier', v_c, t.cake(1));
  perform t.login('cashier'); perform public.set_station_status(v_o, 'cake', 'ready'); perform t.logout();
  perform t.n('M12 คิวพร้อมรับ → มีข้อความ queue_ready', t.nout(v_c, 'queue_ready'), 1);
  perform t.login('cashier'); perform public.reopen_handover(v_o); perform t.logout();
end $$;

-- =====================================================================
-- M13. งานตามเวลา: วันเกิด, Come Back, เตือนคูปองใกล้หมดอายุ, คูปองหมดอายุ
-- =====================================================================
do $$
declare v_c uuid := public._customer_of_line('Uline0003'); v_tpl uuid; r jsonb; v_today date := public.bkk_today();
begin
  insert into public.coupon_templates(title, source, expire_days) values ('Birthday Burn', 'birthday', 30) returning id into v_tpl;
  update public.loyalty_settings set birthday_coupon_template_id = v_tpl;
  update public.member_profiles set birthday = (v_today - interval '25 years')::date where customer_id = v_c;
  r := t.svc($q$select public.membership_enqueue_scheduled()$q$);
  perform t.n('M13 ออกคูปองวันเกิด 1 ใบ', (select count(*) from public.member_coupons where customer_id = v_c and dedupe_key like 'birthday:%'), 1);
  r := t.svc($q$select public.membership_enqueue_scheduled()$q$);
  perform t.n('M13 รันซ้ำไม่ออกซ้ำในปีเดียวกัน', (select count(*) from public.member_coupons where customer_id = v_c and dedupe_key like 'birthday:%'), 1);
  perform t.n('M13 มี event birthday_reward', (select count(*) from public.member_events where customer_id = v_c and kind = 'birthday_reward'), 1);

  update public.loyalty_settings set comeback_days = 1;
  update public.member_profiles set last_purchase_at = now() - interval '5 days', marketing_consent = true where customer_id = v_c;
  update public.notification_outbox set created_at = now() - interval '30 days' where customer_id = v_c and category = 'marketing';
  r := t.svc($q$select public.membership_enqueue_scheduled()$q$);
  perform t.n('M13 Come Back เข้าคิว (ค่าวันตั้งจาก settings)', t.nout(v_c, 'comeback'), 1);
  r := t.svc($q$select public.membership_enqueue_scheduled()$q$);
  perform t.n('M13 Come Back ไม่ซ้ำ', t.nout(v_c, 'comeback'), 1);

  update public.loyalty_settings set comeback_days = null;
  perform t.n('M13 ปิด Come Back = ไม่มีผู้สมัคร', (t.svc($q$select public.membership_enqueue_scheduled()$q$)->>'comeback_candidates')::int, 0);
  -- ระบบปิดอยู่ = ไม่ทำอะไร
  update public.loyalty_settings set membership_enabled = false;
  perform t.s('M13 ปิดระบบสมาชิก = skipped', t.svc($q$select public.membership_enqueue_scheduled()$q$)->>'skipped', 'DISABLED');
  update public.loyalty_settings set membership_enabled = true;
end $$;

-- =====================================================================
-- M14. ข้อมูลประวัติแก้/ลบไม่ได้ + การขายต้องไม่ล้มเมื่อระบบสมาชิกพลาด
-- =====================================================================
do $$
declare v_m uuid := t.id('m1'); v_o uuid; v_n bigint;
begin
  perform t.fails('M14 ledger แก้ไม่ได้', 'postgres', format($q$update public.member_ledger set amount = 99 where customer_id = %L$q$, v_m), 'IMMUTABLE_RECORD');
  perform t.fails('M14 ledger ลบไม่ได้', 'postgres', format($q$delete from public.member_ledger where customer_id = %L$q$, v_m), 'IMMUTABLE_RECORD');
  perform t.fails('M14 member_events แก้ไม่ได้', 'postgres', format($q$update public.member_events set kind = 'x' where customer_id = %L$q$, v_m), 'IMMUTABLE_RECORD');
  perform t.fails('M14 member_order_links ลบไม่ได้', 'postgres', format($q$delete from public.member_order_links where customer_id = %L$q$, v_m), 'IMMUTABLE_RECORD');
  perform t.fails('M14 tier history แก้ไม่ได้', 'postgres', format($q$update public.member_tier_history set reason = 'x' where customer_id = %L$q$, v_m), 'IMMUTABLE_RECORD');
  perform t.fails('M14 ผู้จัดการเขียน ledger ตรงไม่ได้', 'mgr', format($q$insert into public.member_ledger(customer_id,currency,kind,amount,balance_after,idempotency_key) values (%L,'points','EARN',9,9,'hack')$q$, v_m), 'permission denied');
  perform t.fails('M14 ผู้จัดการแก้ยอดแต้มตรงไม่ได้', 'mgr', format($q$update public.member_profiles set points_balance = 999999 where customer_id = %L$q$, v_m), 'permission denied');
  perform t.fails('M14 ยอดติดลบไม่ได้ (CHECK)', 'postgres', format($q$update public.member_profiles set points_balance = -1 where customer_id = %L$q$, v_m), 'new row for relation');
  perform t.fails('M14 key ledger ซ้ำไม่ได้ (UNIQUE)', 'postgres',
    format($q$insert into public.member_ledger(customer_id,currency,kind,amount,balance_after,idempotency_key) select customer_id,currency,kind,amount,balance_after,idempotency_key from public.member_ledger where customer_id = %L limit 1$q$, v_m), 'duplicate key');
  perform t.login('mgr'); update public.loyalty_settings set points_enabled = false; perform t.logout();
  perform t.n('M14 ค่าไม่เปลี่ยนเมื่อผู้จัดการพยายามแก้', (select count(*) from public.loyalty_settings where points_enabled), 1);

  -- ระบบสมาชิกพลาดต้องไม่ทำให้การขายล้ม
  alter table public.member_order_links add constraint zz_force_fail check (basis_satang < 0) not valid;
  v_o := t.mc('cashier', v_m, t.cake());
  alter table public.member_order_links drop constraint zz_force_fail;
  perform t.n('M14 ขายสำเร็จแม้ประมวลผลสมาชิกพลาด', (select count(*) from public.orders where id = v_o), 1);
  perform t.n('M14 ไม่มีการเชื่อมสมาชิกค้างครึ่งๆ กลางๆ', (select count(*) from public.member_order_links where order_id = v_o), 0);
  perform t.n('M14 ไม่มี ledger ของออเดอร์ที่พลาด', (select count(*) from public.member_ledger where order_id = v_o), 0);
  perform t.login('mgr'); perform t.n('M14 reconcile ซ่อมออเดอร์ที่พลาด', public.membership_reconcile(1), 1); perform t.logout();
  perform t.n('M14 หลังซ่อมได้ 5 แต้ม', (select points_earned from public.member_order_links where order_id = v_o), 5);
end $$;

-- =====================================================================
-- M15. รายงานสมาชิก + นำเข้าข้อมูลจาก LINE OA เดิม
-- =====================================================================


do $$
declare r jsonb;
begin
  perform t.fails('M15 cashier ดูรายงานสมาชิกไม่ได้', 'cashier', $q$select public.members_overview(current_date - 7, current_date)$q$, 'FORBIDDEN');
  perform t.fails('M15 ช่วงวันที่ไม่ถูกต้อง', 'mgr', $q$select public.members_overview(current_date, current_date - 1)$q$, 'INVALID_RANGE');
  perform t.login('mgr'); r := public.members_overview(public.bkk_today() - 1, public.bkk_today()); perform t.logout();
  perform t.n('M15 จำนวนสมาชิกทั้งหมด', (r->>'total_members')::int, (select count(*)::int from public.member_profiles));
  perform t.n('M15 สมาชิกที่มี LINE ผูกอยู่', (r->>'linked_members')::int, (select count(*)::int from public.customer_line_links where unlinked_at is null));
  perform t.n('M15 แต้มคงค้าง = Σ ยอดของทุกสมาชิก', (r->>'points_outstanding')::bigint, (select sum(points_balance) from public.member_profiles));
  perform t.n('M15 สมาชิก + ไม่ใช่สมาชิก = ออเดอร์ทั้งหมดที่ไม่ถูกคืนเต็ม',
              (r->>'member_orders')::int + (r->>'nonmember_orders')::int,
              (select count(*)::int from public.orders o where o.payment_status <> 'refunded' and o.created_at >= (public.bkk_today() - 1)::timestamp at time zone 'Asia/Bangkok'));
end $$;

do $$
declare v_c uuid; v_c2 uuid; v_cp uuid;
begin
  v_c := (t.svc($q$select to_jsonb(public.import_line_oa_member('M-000123','Uimport001','ลูกค้าเก่า','064-111-2222',date '1988-03-04',4,17,timestamptz '2025-06-01 10:00+07'))$q$) #>> '{}')::uuid;
  v_c2 := (t.svc($q$select to_jsonb(public.import_line_oa_member('M-000123','Uimport001','ลูกค้าเก่า','064-111-2222',date '1988-03-04',4,17,timestamptz '2025-06-01 10:00+07'))$q$) #>> '{}')::uuid;
  perform t.s('M15 นำเข้าซ้ำได้สมาชิกคนเดิม', v_c::text, v_c2::text);
  perform t.n('M15 นำเข้าแสตมป์คงเหลือ 4 ผ่าน ledger', t.stm(v_c), 4);
  perform t.n('M15 สะสมตลอดชีพ 17', (select stamps_lifetime from public.member_profiles where customer_id = v_c), 17);
  perform t.n('M15 ledger นำเข้าเป็น ADMIN_ADJUSTMENT', t.nledger(v_c, 'stamps', 'ADMIN_ADJUSTMENT'), 1);
  perform t.n('M15 ผูก LINE เดิมแล้ว', (select count(*) from public.customer_line_links where customer_id = v_c and line_user_id = 'Uimport001'), 1);
  perform t.n('M15 สมาชิกนำเข้ายังไม่ยอมรับ Privacy (ต้องยืนยันตอนเข้า LIFF)',
              (select count(*) from public.member_profiles where customer_id = v_c and privacy_accepted_at is null), 1);
  v_cp := (t.svc($q$select to_jsonb(public.import_line_oa_coupon('M-000123','ABCDEF123456','reward','Free Drink Coupon','เดิม','unused', now() - interval '10 days', now() + interval '20 days', null))$q$) #>> '{}')::uuid;
  perform t.n('M15 นำเข้าคูปองที่ยังไม่ใช้', (select count(*) from public.member_coupons where id = v_cp and status = 'unused' and code = 'ABCDEF123456'), 1);
  perform t.svc($q$select to_jsonb(public.import_line_oa_coupon('M-000123','USEDCODE0001','reward','เดิม-ใช้แล้ว',null,'used', now() - interval '60 days', now() - interval '30 days', now() - interval '40 days'))$q$);
  perform t.n('M15 นำเข้าคูปองที่ใช้แล้วคงสถานะ used', (select count(*) from public.member_coupons where customer_id = v_c and status = 'used'), 1);
  perform t.n('M15 นำเข้าคูปองซ้ำไม่ซ้ำ',
              ((t.svc($q$select to_jsonb(public.import_line_oa_coupon('M-000123','ABCDEF123456','reward','Free Drink Coupon','เดิม','unused', now(), now() + interval '20 days', null))$q$) #>> '{}')::uuid = v_cp)::int, 1);
end $$;

-- รวมผล
select 'ALL MEMBERSHIP ASSERTIONS PASSED' as result;
