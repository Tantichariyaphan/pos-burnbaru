-- =====================================================================
-- 0002: ฟังก์ชันฝั่งฐานข้อมูล (SECURITY DEFINER)
--
-- ทุกการเขียนข้อมูลการเงินต้องผ่านฟังก์ชันเหล่านี้เท่านั้น:
--   * ตรวจสิทธิ์จาก auth.uid() (พนักงานต้อง active)
--   * ตรวจและคำนวณยอดเองทั้งหมด — ไม่เชื่อราคา/ยอดที่ส่งมาจาก client
--   * อยู่ในทรานแซกชันเดียว (ล้มเหลว = rollback ทั้งหมด)
--   * ข้อผิดพลาดใช้ข้อความรูปแบบ  CODE  หรือ  CODE: รายละเอียด
-- =====================================================================

-- ---------- auth helpers ----------
create or replace function public.auth_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.employees where id = auth.uid() and active
$$;

create or replace function public.auth_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.employees where id = auth.uid() and active
$$;

create or replace function public.has_role(p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() = any(p_roles), false)
$$;

-- คืน employee id ถ้าผ่าน; p_roles = null หมายถึงพนักงานที่ active ทุกบทบาท
create or replace function public.require_role(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid;
  v_role text;
begin
  select id, role into v_id, v_role from public.employees where id = auth.uid() and active;
  if v_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if p_roles is not null and not (v_role = any(p_roles)) then
    raise exception 'FORBIDDEN';
  end if;
  return v_id;
end $$;

-- ---------- new user → employees ----------
-- คนแรกที่สมัคร = owner
-- บัญชีที่เจ้าของสร้างผ่าน Admin API ใส่ app_metadata.pos_role / pos_name ได้ (ผู้สมัครเองแก้ app_metadata ไม่ได้)
-- บัญชีอื่น ๆ ที่สมัครเอง = cashier แบบ "ยังไม่อนุมัติ" (active = false)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_active boolean;
  v_name text;
begin
  v_name := coalesce(nullif(btrim(new.raw_app_meta_data->>'pos_name'), ''),
                     nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                     'พนักงาน');
  if not exists (select 1 from public.employees) then
    v_role := 'owner'; v_active := true;
  elsif (new.raw_app_meta_data->>'pos_role') in ('owner','manager','cashier') then
    v_role := new.raw_app_meta_data->>'pos_role'; v_active := true;
  else
    v_role := 'cashier'; v_active := false;
  end if;
  insert into public.employees(id, name, email, role, active)
  values (new.id, v_name, new.email, v_role, v_active);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- pure calculators ----------
-- ส่วนลดเปอร์เซ็นต์: basis points, ปัดเศษครึ่งขึ้น (ต้องตรงกับ src/lib/money.ts)
create or replace function public.calc_discount(p_subtotal bigint, p_kind text, p_value integer)
returns integer language sql immutable as $$
  select case
    when p_kind = 'percent' then ((p_subtotal * p_value + 5000) / 10000)::integer
    else least(p_value::bigint, p_subtotal)::integer
  end
$$;

-- เลือกกะที่เปิดอยู่: ระบุ id มา = ต้องเป็นกะที่ยังเปิด; ไม่ระบุ = ใช้กะเดียวที่เปิดอยู่ (ถ้ามี)
create or replace function public.resolve_open_shift(p_shift_id uuid, p_lock text default 'none')
returns public.shifts
language plpgsql security definer set search_path = public as $$
declare
  v_shift public.shifts;
  v_count integer;
begin
  if p_shift_id is not null then
    if p_lock = 'update' then
      select * into v_shift from public.shifts where id = p_shift_id and status = 'open' for update;
    elsif p_lock = 'share' then
      select * into v_shift from public.shifts where id = p_shift_id and status = 'open' for share;
    else
      select * into v_shift from public.shifts where id = p_shift_id and status = 'open';
    end if;
    if not found then
      raise exception 'SHIFT_NOT_OPEN';
    end if;
    return v_shift;
  end if;

  select count(*) into v_count from public.shifts where status = 'open';
  if v_count = 0 then
    return null;
  elsif v_count > 1 then
    raise exception 'SHIFT_REQUIRED';
  end if;
  if p_lock = 'update' then
    select * into v_shift from public.shifts where status = 'open' for update;
  elsif p_lock = 'share' then
    select * into v_shift from public.shifts where status = 'open' for share;
  else
    select * into v_shift from public.shifts where status = 'open';
  end if;
  return v_shift;
end $$;

-- ---------- shift summary (นิยามเดียวใช้ทั้งปิดกะ/รายงาน) ----------
--  total_sales   = ผลรวมยอดก่อนส่วนลดของออเดอร์ในกะ
--  net_sales     = total_sales − discounts − refunds(ที่จ่ายคืนในกะนี้)
--  expected_cash = เงินทอนตั้งต้น + ขายเงินสด + เงินสดเข้า − เงินสดออก − คืนเงินสด
--  เงินโอนไม่เกี่ยวกับลิ้นชักเงินสด
create or replace function public.compute_shift_summary(p_shift_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s public.shifts;
  v_gross bigint; v_disc bigint; v_orders integer;
  v_cash_sales bigint; v_transfer_sales bigint; v_cash_orders integer; v_transfer_orders integer;
  v_refund_total bigint; v_cash_refunds bigint; v_transfer_refunds bigint;
  v_cash_in bigint; v_cash_out bigint; v_tr_in bigint; v_tr_out bigint;
  v_expected bigint;
begin
  select * into s from public.shifts where id = p_shift_id;
  if not found then
    raise exception 'SHIFT_NOT_FOUND';
  end if;

  select coalesce(sum(subtotal_satang), 0), coalesce(sum(discount_satang), 0), count(*)
    into v_gross, v_disc, v_orders
    from public.orders where shift_id = p_shift_id;

  select coalesce(sum(amount_satang) filter (where method = 'cash'), 0),
         coalesce(sum(amount_satang) filter (where method = 'transfer'), 0),
         count(*) filter (where method = 'cash'),
         count(*) filter (where method = 'transfer')
    into v_cash_sales, v_transfer_sales, v_cash_orders, v_transfer_orders
    from public.payments where shift_id = p_shift_id;

  select coalesce(sum(amount_satang), 0),
         coalesce(sum(amount_satang) filter (where method = 'cash'), 0),
         coalesce(sum(amount_satang) filter (where method = 'transfer'), 0)
    into v_refund_total, v_cash_refunds, v_transfer_refunds
    from public.refunds where shift_id = p_shift_id;

  select coalesce(sum(amount_satang) filter (where channel = 'cash' and direction = 'in'), 0),
         coalesce(sum(amount_satang) filter (where channel = 'cash' and direction = 'out'), 0),
         coalesce(sum(amount_satang) filter (where channel = 'transfer' and direction = 'in'), 0),
         coalesce(sum(amount_satang) filter (where channel = 'transfer' and direction = 'out'), 0)
    into v_cash_in, v_cash_out, v_tr_in, v_tr_out
    from public.cash_movements where shift_id = p_shift_id;

  v_expected := s.opening_cash_satang + v_cash_sales + v_cash_in - v_cash_out - v_cash_refunds;

  return jsonb_build_object(
    'opening_cash_satang',       s.opening_cash_satang,
    'cash_sales_satang',         v_cash_sales,
    'cash_refunds_satang',       v_cash_refunds,
    'cash_in_satang',            v_cash_in,
    'cash_out_satang',           v_cash_out,
    'expected_cash_satang',      v_expected,
    'total_sales_satang',        v_gross,
    'discounts_satang',          v_disc,
    'refunds_satang',            v_refund_total,
    'net_sales_satang',          v_gross - v_disc - v_refund_total,
    'cash_payments_satang',      v_cash_sales,
    'transfer_payments_satang',  v_transfer_sales,
    'transfer_refunds_satang',   v_transfer_refunds,
    'transfer_in_satang',        v_tr_in,
    'transfer_out_satang',       v_tr_out,
    'order_count',               v_orders,
    'cash_order_count',          v_cash_orders,
    'transfer_order_count',      v_transfer_orders
  );
end $$;

-- ---------- open shift ----------
create or replace function public.open_shift(p_register_id uuid, p_opening_cash_satang integer)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_id uuid;
begin
  v_emp := public.require_role(null);
  if p_opening_cash_satang is null or p_opening_cash_satang < 0 or p_opening_cash_satang > 1000000000 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if not exists (select 1 from public.registers where id = p_register_id and active) then
    raise exception 'REGISTER_NOT_FOUND';
  end if;

  begin
    insert into public.shifts(register_id, opened_by, opening_cash_satang)
    values (p_register_id, v_emp, p_opening_cash_satang)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'SHIFT_ALREADY_OPEN';
  end;

  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'open_shift', 'shifts', v_id::text,
          jsonb_build_object('opening_cash_satang', p_opening_cash_satang));
  return v_id;
end $$;

-- ---------- close shift ----------
create or replace function public.close_shift(
  p_shift_id uuid, p_counted_cash_satang integer, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_shift public.shifts;
  v_sum jsonb;
  v_expected integer;
  v_variance integer;
begin
  v_emp := public.require_role(null);
  if p_counted_cash_satang is null or p_counted_cash_satang < 0 or p_counted_cash_satang > 1000000000 then
    raise exception 'INVALID_AMOUNT';
  end if;

  -- ล็อกกะ: รอธุรกรรมที่กำลังรับเงิน/เบิกเงินในกะนี้ให้เสร็จก่อน
  select * into v_shift from public.shifts where id = p_shift_id and status = 'open' for update;
  if not found then
    raise exception 'SHIFT_NOT_OPEN';
  end if;

  v_sum := public.compute_shift_summary(p_shift_id);
  v_expected := (v_sum->>'expected_cash_satang')::integer;
  v_variance := p_counted_cash_satang - v_expected;
  v_sum := v_sum || jsonb_build_object(
    'counted_cash_satang', p_counted_cash_satang,
    'variance_satang', v_variance
  );

  update public.shifts
     set status = 'closed', closed_by = v_emp, closed_at = now(),
         counted_cash_satang = p_counted_cash_satang,
         expected_cash_satang = v_expected,
         variance_satang = v_variance,
         summary = v_sum,
         close_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_shift_id;

  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'close_shift', 'shifts', p_shift_id::text, v_sum);
  return v_sum;
end $$;

-- ดูสรุปกะ: กะที่ปิดแล้วคืน snapshot เดิม, กะที่เปิดอยู่คำนวณสด
create or replace function public.get_shift_summary(p_shift_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_shift public.shifts;
  v_role text;
begin
  perform public.require_role(null);
  v_role := public.auth_role();
  select * into v_shift from public.shifts where id = p_shift_id;
  if not found then
    raise exception 'SHIFT_NOT_FOUND';
  end if;
  if v_shift.status = 'closed' then
    if v_role = 'cashier' and (v_shift.opened_at at time zone 'Asia/Bangkok')::date <> public.bkk_today() then
      raise exception 'FORBIDDEN';
    end if;
    return v_shift.summary;
  end if;
  return public.compute_shift_summary(p_shift_id);
end $$;

-- ---------- checkout ----------
-- p_items: [{ "product_id": uuid, "quantity": 1..99, "addon_ids": [uuid,...] }]
-- ราคา/ส่วนลด/ยอดรวม คำนวณใหม่จากฐานข้อมูลทั้งหมด
create or replace function public.checkout_order(
  p_idempotency_key uuid,
  p_shift_id uuid,
  p_items jsonb,
  p_discount_id uuid,
  p_method text,
  p_received_satang integer,
  p_reference text default null,
  p_customer_id uuid default null,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_settings public.settings;
  v_shift public.shifts;
  v_existing uuid;
  v_item jsonb;
  v_prod public.products;
  v_cat_name text;
  v_qty integer;
  v_addon_ids uuid[];
  v_addon_id uuid;
  v_addon public.addons;
  v_addons_json jsonb;
  v_addon_unit integer;
  v_line bigint;
  v_lines jsonb := '[]'::jsonb;
  v_subtotal bigint := 0;
  v_discount public.discounts;
  v_disc integer := 0;
  v_total integer;
  v_change integer;
  v_order_id uuid := gen_random_uuid();
  v_order_item_id uuid;
  v_no integer;
  v_bdate date := public.bkk_today();
  v_line_rec jsonb;
  v_recipe record;
begin
  v_emp := public.require_role(null);

  if p_idempotency_key is null then
    raise exception 'INVALID_INPUT: idempotency key is required';
  end if;

  -- ส่งซ้ำด้วย key เดิม = ได้ออเดอร์เดิมกลับ ไม่สร้างซ้ำ
  select order_id into v_existing from public.payments where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_settings from public.settings;
  if not v_settings.sales_enabled then
    raise exception 'SALES_DISABLED';
  end if;

  -- ล็อกแบบ share: ปิดกะ (for update) จะรอเราเสร็จ และถ้าปิดไปก่อนแล้วเราจะไม่พบกะที่เปิด
  v_shift := public.resolve_open_shift(p_shift_id, 'share');
  if v_shift.id is null then
    raise exception 'SHIFT_NOT_OPEN';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'INVALID_INPUT: too many lines';
  end if;

  -- ----- รอบที่ 1: ตรวจสอบและคำนวณทุกบรรทัด -----
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 99 then
      raise exception 'INVALID_QUANTITY';
    end if;

    select * into v_prod from public.products where id = (v_item->>'product_id')::uuid;
    if not found or not v_prod.is_active then
      raise exception 'PRODUCT_UNAVAILABLE';
    end if;
    if not v_prod.is_available then
      raise exception 'PRODUCT_SOLD_OUT: %', v_prod.name;
    end if;
    if v_prod.price_satang is null then
      raise exception 'PRICE_NOT_SET: %', v_prod.name;
    end if;
    select c.name into v_cat_name from public.categories c where c.id = v_prod.category_id;

    v_addon_ids := array(
      select distinct x::uuid
      from jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)) as t(x)
    );
    v_addons_json := '[]'::jsonb;
    v_addon_unit := 0;
    foreach v_addon_id in array v_addon_ids loop
      select a.* into v_addon
        from public.addons a
        join public.product_addons pa on pa.addon_id = a.id and pa.product_id = v_prod.id
       where a.id = v_addon_id and a.active;
      if not found then
        raise exception 'ADDON_INVALID';
      end if;
      v_addons_json := v_addons_json || jsonb_build_object(
        'id', v_addon.id, 'name', v_addon.name, 'price_satang', v_addon.price_satang);
      v_addon_unit := v_addon_unit + v_addon.price_satang;
    end loop;

    v_line := (v_prod.price_satang::bigint + v_addon_unit) * v_qty;
    v_subtotal := v_subtotal + v_line;
    if v_subtotal > 100000000 then
      raise exception 'AMOUNT_TOO_LARGE';
    end if;

    v_lines := v_lines || jsonb_build_object(
      'product_id', v_prod.id, 'product_name', v_prod.name, 'category_name', v_cat_name,
      'unit_price_satang', v_prod.price_satang, 'addons', v_addons_json,
      'addon_unit_satang', v_addon_unit, 'quantity', v_qty, 'line_total_satang', v_line);
  end loop;

  -- ----- ส่วนลด -----
  if p_discount_id is not null then
    select * into v_discount from public.discounts where id = p_discount_id and active;
    if not found then
      raise exception 'DISCOUNT_INVALID';
    end if;
    v_disc := public.calc_discount(v_subtotal, v_discount.kind, v_discount.value);
  end if;
  v_total := (v_subtotal - v_disc)::integer;
  if v_total <= 0 then
    raise exception 'TOTAL_NOT_POSITIVE';
  end if;

  -- ----- การชำระเงิน -----
  if p_method is null or p_method not in ('cash','transfer') then
    raise exception 'INVALID_METHOD';
  end if;
  if p_received_satang is null or p_received_satang <= 0 or p_received_satang > 1000000000 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_method = 'cash' then
    if p_received_satang < v_total then
      raise exception 'INSUFFICIENT_PAYMENT';
    end if;
    v_change := p_received_satang - v_total;
  else
    if p_received_satang <> v_total then
      raise exception 'TRANSFER_AMOUNT_MISMATCH';
    end if;
    v_change := 0;
  end if;

  if v_settings.customers_enabled and p_customer_id is not null then
    if not exists (select 1 from public.customers where id = p_customer_id and active) then
      raise exception 'CUSTOMER_NOT_FOUND';
    end if;
  else
    p_customer_id := null;
  end if;

  -- ----- เลขออเดอร์ต่อวัน (ใน transaction เดียวกัน: rollback แล้วเลขไม่ข้าม) -----
  insert into public.order_counters(business_date, last_no) values (v_bdate, 1)
  on conflict (business_date) do update set last_no = public.order_counters.last_no + 1
  returning last_no into v_no;

  begin
    insert into public.orders(id, order_no, business_date, shift_id, employee_id, customer_id,
                              subtotal_satang, discount_id, discount_name, discount_satang,
                              total_satang, note)
    values (v_order_id, v_no, v_bdate, v_shift.id, v_emp, p_customer_id,
            v_subtotal::integer, p_discount_id,
            v_discount.name, v_disc, v_total, nullif(btrim(coalesce(p_note, '')), ''));

    for v_line_rec in select * from jsonb_array_elements(v_lines) loop
      v_order_item_id := gen_random_uuid();
      insert into public.order_items(id, order_id, product_id, product_name, category_name,
                                     unit_price_satang, addons, addon_unit_satang, quantity,
                                     line_total_satang)
      values (v_order_item_id, v_order_id, (v_line_rec->>'product_id')::uuid,
              v_line_rec->>'product_name', v_line_rec->>'category_name',
              (v_line_rec->>'unit_price_satang')::integer, v_line_rec->'addons',
              (v_line_rec->>'addon_unit_satang')::integer, (v_line_rec->>'quantity')::integer,
              (v_line_rec->>'line_total_satang')::integer);

      -- ตัดสต็อกตามสูตร (เฉพาะเมื่อเปิดใช้สต็อก; unique index กันตัดซ้ำ)
      if v_settings.inventory_enabled then
        for v_recipe in
          select r.inventory_item_id, r.qty_per_unit
            from public.recipes r where r.product_id = (v_line_rec->>'product_id')::uuid
        loop
          insert into public.stock_movements(inventory_item_id, kind, qty_delta, order_item_id, employee_id)
          values (v_recipe.inventory_item_id, 'sale',
                  -(v_recipe.qty_per_unit * (v_line_rec->>'quantity')::integer),
                  v_order_item_id, v_emp);
          update public.inventory_items
             set qty_on_hand = qty_on_hand - (v_recipe.qty_per_unit * (v_line_rec->>'quantity')::integer)
           where id = v_recipe.inventory_item_id;
        end loop;
      end if;
    end loop;

    insert into public.payments(order_id, shift_id, method, amount_satang, received_satang,
                                change_satang, reference, confirmed_by, idempotency_key)
    values (v_order_id, v_shift.id, p_method, v_total, p_received_satang, v_change,
            nullif(btrim(coalesce(p_reference, '')), ''), v_emp, p_idempotency_key);
  exception when unique_violation then
    -- ชนกันเพราะส่ง key เดิมพร้อมกัน → คืนออเดอร์ที่สำเร็จไปแล้ว
    select order_id into v_existing from public.payments where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
    raise;
  end;

  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'checkout', 'orders', v_order_id::text,
          jsonb_build_object('order_no', v_no, 'total_satang', v_total, 'method', p_method));
  return v_order_id;
end $$;

-- ---------- สถานะการทำออเดอร์ ----------
create or replace function public.set_order_prep_status(
  p_order_id uuid, p_status text, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_order public.orders;
begin
  v_emp := public.require_role(null);
  if p_status is null or p_status not in ('preparing','done') then
    raise exception 'INVALID_STATUS';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if public.auth_role() = 'cashier' and v_order.business_date <> public.bkk_today() then
    raise exception 'FORBIDDEN';
  end if;
  if v_order.prep_status = p_status then
    return;  -- กดซ้ำ ไม่มีผล
  end if;

  update public.orders
     set prep_status = p_status,
         prepared_at = case when p_status = 'done' then now() else null end,
         prepared_by = case when p_status = 'done' then v_emp else null end
   where id = p_order_id;

  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'prep_status', 'orders', p_order_id::text,
          jsonb_build_object('from', v_order.prep_status, 'to', p_status, 'note', p_note));
end $$;

-- ---------- คืนเงิน ----------
create or replace function public.refund_order(
  p_idempotency_key uuid,
  p_order_id uuid,
  p_amount_satang integer,
  p_method text,
  p_reason text,
  p_shift_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_order public.orders;
  v_shift public.shifts;
  v_refunded bigint;
  v_id uuid;
  v_new_status text;
begin
  v_emp := public.require_role(array['owner','manager']);
  if p_idempotency_key is null then
    raise exception 'INVALID_INPUT: idempotency key is required';
  end if;

  select id into v_id from public.refunds where idempotency_key = p_idempotency_key;
  if found then
    return v_id;
  end if;

  if p_amount_satang is null or p_amount_satang <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_method is null or p_method not in ('cash','transfer') then
    raise exception 'INVALID_METHOD';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  select coalesce(sum(amount_satang), 0) into v_refunded from public.refunds where order_id = p_order_id;
  if p_amount_satang > v_order.total_satang - v_refunded then
    raise exception 'REFUND_EXCEEDS_PAID';
  end if;

  -- คืนเงินสดต้องมีกะที่เปิดอยู่ (หักจากลิ้นชักของกะนั้น และต้องมีเงินพอ)
  v_shift := public.resolve_open_shift(p_shift_id, case when p_method = 'cash' then 'update' else 'share' end);
  if p_method = 'cash' then
    if v_shift.id is null then
      raise exception 'NO_OPEN_SHIFT';
    end if;
    if p_amount_satang > (public.compute_shift_summary(v_shift.id)->>'expected_cash_satang')::bigint then
      raise exception 'INSUFFICIENT_DRAWER_CASH';
    end if;
  end if;

  begin
    insert into public.refunds(order_id, shift_id, amount_satang, method, reason, employee_id, idempotency_key)
    values (p_order_id, v_shift.id, p_amount_satang, p_method, btrim(p_reason), v_emp, p_idempotency_key)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.refunds where idempotency_key = p_idempotency_key;
    if found then
      return v_id;
    end if;
    raise;
  end;

  v_new_status := case when v_refunded + p_amount_satang >= v_order.total_satang
                       then 'refunded' else 'partially_refunded' end;
  update public.orders set payment_status = v_new_status where id = p_order_id;

  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'refund', 'orders', p_order_id::text,
          jsonb_build_object('refund_id', v_id, 'amount_satang', p_amount_satang,
                             'method', p_method, 'reason', btrim(p_reason)));
  return v_id;
end $$;

-- ---------- เงินเข้า-ออก ----------
create or replace function public.record_cash_movement(
  p_idempotency_key uuid,
  p_direction text,
  p_channel text,
  p_amount_satang integer,
  p_category text,
  p_note text default null,
  p_shift_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_shift public.shifts;
  v_id uuid;
begin
  v_emp := public.require_role(null);
  if p_idempotency_key is null then
    raise exception 'INVALID_INPUT: idempotency key is required';
  end if;
  select id into v_id from public.cash_movements where idempotency_key = p_idempotency_key;
  if found then
    return v_id;
  end if;

  if p_direction is null or p_direction not in ('in','out') then
    raise exception 'INVALID_DIRECTION';
  end if;
  if p_channel is null or p_channel not in ('cash','transfer') then
    raise exception 'INVALID_METHOD';
  end if;
  if p_amount_satang is null or p_amount_satang <= 0 or p_amount_satang > 1000000000 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_category is null or length(btrim(p_category)) = 0 then
    raise exception 'REASON_REQUIRED';
  end if;

  -- ถ้าเป็นเงินสดออก ล็อกกะเพื่อกันเบิกพร้อมกันจนลิ้นชักติดลบ
  v_shift := public.resolve_open_shift(
    p_shift_id, case when p_channel = 'cash' and p_direction = 'out' then 'update' else 'share' end);
  if p_channel = 'cash' and v_shift.id is null then
    raise exception 'NO_OPEN_SHIFT';
  end if;
  if p_channel = 'cash' and p_direction = 'out' then
    if p_amount_satang > (public.compute_shift_summary(v_shift.id)->>'expected_cash_satang')::bigint then
      raise exception 'INSUFFICIENT_DRAWER_CASH';
    end if;
  end if;

  begin
    insert into public.cash_movements(shift_id, direction, channel, amount_satang, category, note,
                                      employee_id, idempotency_key)
    values (v_shift.id, p_direction, p_channel, p_amount_satang, btrim(p_category),
            nullif(btrim(coalesce(p_note, '')), ''), v_emp, p_idempotency_key)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.cash_movements where idempotency_key = p_idempotency_key;
    if found then
      return v_id;
    end if;
    raise;
  end;

  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'cash_movement', 'cash_movements', v_id::text,
          jsonb_build_object('direction', p_direction, 'channel', p_channel,
                             'amount_satang', p_amount_satang, 'category', btrim(p_category)));
  return v_id;
end $$;

-- กลับรายการ: สร้างรายการตรงข้ามอ้างอิงรายการเดิม (ไม่แก้/ไม่ลบรายการเดิม)
create or replace function public.reverse_cash_movement(
  p_idempotency_key uuid, p_movement_id uuid, p_reason text, p_shift_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_orig public.cash_movements;
  v_shift public.shifts;
  v_dir text;
  v_id uuid;
begin
  v_emp := public.require_role(array['owner','manager']);
  select id into v_id from public.cash_movements where idempotency_key = p_idempotency_key;
  if found then
    return v_id;
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED';
  end if;

  select * into v_orig from public.cash_movements where id = p_movement_id;
  if not found then
    raise exception 'MOVEMENT_NOT_FOUND';
  end if;
  if v_orig.reverses_id is not null then
    raise exception 'ALREADY_REVERSED: a reversal cannot be reversed';
  end if;
  if exists (select 1 from public.cash_movements where reverses_id = p_movement_id) then
    raise exception 'ALREADY_REVERSED';
  end if;

  v_dir := case when v_orig.direction = 'in' then 'out' else 'in' end;
  -- ผลต่อลิ้นชักเงินสดตกที่กะปัจจุบัน (กะเดิมอาจปิดไปแล้ว)
  v_shift := public.resolve_open_shift(
    p_shift_id, case when v_orig.channel = 'cash' and v_dir = 'out' then 'update' else 'share' end);
  if v_orig.channel = 'cash' and v_shift.id is null then
    raise exception 'NO_OPEN_SHIFT';
  end if;
  if v_orig.channel = 'cash' and v_dir = 'out' then
    if v_orig.amount_satang > (public.compute_shift_summary(v_shift.id)->>'expected_cash_satang')::bigint then
      raise exception 'INSUFFICIENT_DRAWER_CASH';
    end if;
  end if;

  begin
    insert into public.cash_movements(shift_id, direction, channel, amount_satang, category, note,
                                      employee_id, reverses_id, idempotency_key)
    values (v_shift.id, v_dir, v_orig.channel, v_orig.amount_satang,
            'กลับรายการ: ' || v_orig.category, btrim(p_reason), v_emp, v_orig.id, p_idempotency_key)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.cash_movements where idempotency_key = p_idempotency_key;
    if found then
      return v_id;
    end if;
    raise exception 'ALREADY_REVERSED';
  end;

  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'reverse_cash_movement', 'cash_movements', v_id::text,
          jsonb_build_object('reverses', p_movement_id, 'reason', btrim(p_reason)));
  return v_id;
end $$;

-- ---------- สต็อก ----------
-- kind: receive (+), waste (−), adjust (+/− ตามที่ส่งมา)
create or replace function public.adjust_stock(
  p_item_id uuid, p_kind text, p_qty numeric, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_delta numeric;
begin
  v_emp := public.require_role(array['owner','manager']);
  if p_kind is null or p_kind not in ('receive','waste','adjust') then
    raise exception 'INVALID_KIND';
  end if;
  if p_qty is null or p_qty = 0 or abs(p_qty) > 1000000 then
    raise exception 'INVALID_AMOUNT';
  end if;
  v_delta := case p_kind
    when 'receive' then abs(p_qty)
    when 'waste'   then -abs(p_qty)
    else p_qty end;

  perform 1 from public.inventory_items where id = p_item_id for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND';
  end if;
  insert into public.stock_movements(inventory_item_id, kind, qty_delta, note, employee_id)
  values (p_item_id, p_kind, v_delta, nullif(btrim(coalesce(p_note, '')), ''), v_emp);
  update public.inventory_items set qty_on_hand = qty_on_hand + v_delta where id = p_item_id;
end $$;

-- ---------- รายงานขาย ----------
-- นิยาม (ใช้ตรงกับสรุปกะ/ใบเสร็จ)
--   ยอดขาย (gross)  = Σ ยอดก่อนส่วนลด ของออเดอร์ในช่วงวันที่
--   ส่วนลด          = Σ ส่วนลดของออเดอร์เหล่านั้น
--   คืนเงิน         = Σ รายการคืนเงินที่ "จ่ายคืนในช่วงวันที่" (ไม่ใช่ขาย ไม่นับซ้ำ)
--   ยอดขายสุทธิ     = ยอดขาย − ส่วนลด − คืนเงิน
--   เงินเข้า-ออก (รายจ่าย ฯลฯ) ไม่นับเป็นยอดขายเด็ดขาด
create or replace function public.sales_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_summary jsonb;
begin
  perform public.require_role(array['owner','manager']);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'INVALID_RANGE';
  end if;

  select jsonb_build_object(
      'gross_satang', coalesce(sum(o.subtotal_satang), 0),
      'discounts_satang', coalesce(sum(o.discount_satang), 0),
      'order_count', count(*),
      'discounted_order_count', count(*) filter (where o.discount_satang > 0)
    ) into v_summary
    from public.orders o where o.business_date between p_from and p_to;

  v_summary := v_summary || jsonb_build_object(
    'refunds_satang', (select coalesce(sum(r.amount_satang), 0) from public.refunds r
                        where (r.created_at at time zone 'Asia/Bangkok')::date between p_from and p_to));
  v_summary := v_summary || jsonb_build_object(
    'net_satang', (v_summary->>'gross_satang')::bigint - (v_summary->>'discounts_satang')::bigint
                  - (v_summary->>'refunds_satang')::bigint,
    'avg_order_satang', case when (v_summary->>'order_count')::bigint = 0 then 0
        else round(((v_summary->>'gross_satang')::numeric - (v_summary->>'discounts_satang')::numeric)
                   / (v_summary->>'order_count')::numeric) end);

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'summary', v_summary,
    'by_payment', coalesce((
      select jsonb_agg(x order by x->>'method') from (
        select jsonb_build_object('method', p.method, 'orders', count(*), 'amount_satang', sum(p.amount_satang)) as x
          from public.payments p join public.orders o on o.id = p.order_id
         where o.business_date between p_from and p_to group by p.method) q), '[]'::jsonb),
    'refunds_by_method', coalesce((
      select jsonb_agg(x order by x->>'method') from (
        select jsonb_build_object('method', r.method, 'count', count(*), 'amount_satang', sum(r.amount_satang)) as x
          from public.refunds r
         where (r.created_at at time zone 'Asia/Bangkok')::date between p_from and p_to group by r.method) q), '[]'::jsonb),
    'by_product', coalesce((
      select jsonb_agg(x order by (x->>'gross_satang')::bigint desc) from (
        select jsonb_build_object('product_name', i.product_name, 'category_name', i.category_name,
                                  'quantity', sum(i.quantity), 'gross_satang', sum(i.line_total_satang)) as x
          from public.order_items i join public.orders o on o.id = i.order_id
         where o.business_date between p_from and p_to
         group by i.product_name, i.category_name) q), '[]'::jsonb),
    'by_category', coalesce((
      select jsonb_agg(x order by (x->>'gross_satang')::bigint desc) from (
        select jsonb_build_object('category_name', i.category_name,
                                  'quantity', sum(i.quantity), 'gross_satang', sum(i.line_total_satang)) as x
          from public.order_items i join public.orders o on o.id = i.order_id
         where o.business_date between p_from and p_to
         group by i.category_name) q), '[]'::jsonb),
    'by_employee', coalesce((
      select jsonb_agg(x order by (x->>'gross_satang')::bigint desc) from (
        select jsonb_build_object('employee_name', e.name, 'orders', count(*),
                                  'gross_satang', sum(o.subtotal_satang),
                                  'discounts_satang', sum(o.discount_satang)) as x
          from public.orders o join public.employees e on e.id = o.employee_id
         where o.business_date between p_from and p_to group by e.id, e.name) q), '[]'::jsonb),
    'by_shift', coalesce((
      select jsonb_agg(x order by x->>'opened_at') from (
        select jsonb_build_object(
                 'shift_id', s.id, 'opened_at', s.opened_at, 'closed_at', s.closed_at, 'status', s.status,
                 'opened_by', e.name,
                 'orders', (select count(*) from public.orders o where o.shift_id = s.id),
                 'gross_satang', (select coalesce(sum(o.subtotal_satang),0) from public.orders o where o.shift_id = s.id),
                 'discounts_satang', (select coalesce(sum(o.discount_satang),0) from public.orders o where o.shift_id = s.id),
                 'refunds_satang', (select coalesce(sum(r.amount_satang),0) from public.refunds r where r.shift_id = s.id),
                 'expected_cash_satang', s.expected_cash_satang,
                 'counted_cash_satang', s.counted_cash_satang,
                 'variance_satang', s.variance_satang) as x
          from public.shifts s join public.employees e on e.id = s.opened_by
         where (s.opened_at at time zone 'Asia/Bangkok')::date between p_from and p_to) q), '[]'::jsonb),
    'discount_orders', coalesce((
      select jsonb_agg(x order by x->>'created_at' desc) from (
        select jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'business_date', o.business_date,
                                  'created_at', o.created_at, 'discount_name', o.discount_name,
                                  'discount_satang', o.discount_satang, 'subtotal_satang', o.subtotal_satang,
                                  'total_satang', o.total_satang) as x
          from public.orders o
         where o.business_date between p_from and p_to and o.discount_satang > 0
         order by o.created_at desc limit 200) q), '[]'::jsonb),
    'refund_history', coalesce((
      select jsonb_agg(x order by x->>'created_at' desc) from (
        select jsonb_build_object('id', r.id, 'created_at', r.created_at, 'order_no', o.order_no,
                                  'business_date', o.business_date, 'amount_satang', r.amount_satang,
                                  'method', r.method, 'reason', r.reason, 'employee_name', e.name) as x
          from public.refunds r
          join public.orders o on o.id = r.order_id
          join public.employees e on e.id = r.employee_id
         where (r.created_at at time zone 'Asia/Bangkok')::date between p_from and p_to
         order by r.created_at desc limit 200) q), '[]'::jsonb),
    'movements', jsonb_build_object(
      'cash_in_satang',      (select coalesce(sum(m.amount_satang),0) from public.cash_movements m where m.channel='cash' and m.direction='in'
                                and (m.created_at at time zone 'Asia/Bangkok')::date between p_from and p_to),
      'cash_out_satang',     (select coalesce(sum(m.amount_satang),0) from public.cash_movements m where m.channel='cash' and m.direction='out'
                                and (m.created_at at time zone 'Asia/Bangkok')::date between p_from and p_to),
      'transfer_in_satang',  (select coalesce(sum(m.amount_satang),0) from public.cash_movements m where m.channel='transfer' and m.direction='in'
                                and (m.created_at at time zone 'Asia/Bangkok')::date between p_from and p_to),
      'transfer_out_satang', (select coalesce(sum(m.amount_satang),0) from public.cash_movements m where m.channel='transfer' and m.direction='out'
                                and (m.created_at at time zone 'Asia/Bangkok')::date between p_from and p_to))
  );
end $$;
