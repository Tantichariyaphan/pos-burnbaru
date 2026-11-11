-- =====================================================================
-- 0003: Row Level Security + สิทธิ์การเข้าถึง
--
-- บทบาท: owner (เจ้าของ) > manager (ผู้จัดการ) > cashier (แคชเชียร์)
--  * ตารางการเงิน: อ่านได้ตามสิทธิ์ แต่ "เขียนตรงไม่ได้เลย" (ไม่มี policy + revoke)
--    การเขียนทำผ่านฟังก์ชันใน 0002 เท่านั้น
--  * แคชเชียร์เห็นเฉพาะข้อมูลของวันนี้ (เวลา Asia/Bangkok); ผู้จัดการ/เจ้าของเห็นทั้งหมด
-- =====================================================================

-- ---------- เปิด RLS ทุกตาราง ----------
alter table public.employees        enable row level security;
alter table public.registers        enable row level security;
alter table public.categories       enable row level security;
alter table public.products         enable row level security;
alter table public.addons           enable row level security;
alter table public.product_addons   enable row level security;
alter table public.discounts        enable row level security;
alter table public.customers        enable row level security;
alter table public.settings         enable row level security;
alter table public.shifts           enable row level security;
alter table public.order_counters   enable row level security;
alter table public.orders           enable row level security;
alter table public.order_items      enable row level security;
alter table public.payments         enable row level security;
alter table public.refunds          enable row level security;
alter table public.cash_movements   enable row level security;
alter table public.inventory_items  enable row level security;
alter table public.recipes          enable row level security;
alter table public.stock_movements  enable row level security;
alter table public.audit_logs       enable row level security;

-- ---------- employees ----------
create policy employees_select on public.employees for select to authenticated
  using (id = auth.uid() or public.has_role(array['owner','manager']));
-- แก้ไขได้เฉพาะเจ้าของ (สร้างบัญชีทำผ่าน Admin API ฝั่งเซิร์ฟเวอร์)
create policy employees_update on public.employees for update to authenticated
  using (public.has_role(array['owner'])) with check (public.has_role(array['owner']));

-- ---------- ข้อมูลเมนู/ตั้งค่า: ทุกคนที่ active อ่านได้, ผู้จัดการขึ้นไปแก้ได้ ----------
create policy registers_select on public.registers for select to authenticated
  using (public.auth_employee_id() is not null);
create policy registers_write on public.registers for all to authenticated
  using (public.has_role(array['owner'])) with check (public.has_role(array['owner']));

create policy categories_select on public.categories for select to authenticated
  using (public.auth_employee_id() is not null);
create policy categories_write on public.categories for all to authenticated
  using (public.has_role(array['owner','manager'])) with check (public.has_role(array['owner','manager']));

create policy products_select on public.products for select to authenticated
  using (public.auth_employee_id() is not null);
create policy products_write on public.products for all to authenticated
  using (public.has_role(array['owner','manager'])) with check (public.has_role(array['owner','manager']));

create policy addons_select on public.addons for select to authenticated
  using (public.auth_employee_id() is not null);
create policy addons_write on public.addons for all to authenticated
  using (public.has_role(array['owner','manager'])) with check (public.has_role(array['owner','manager']));

create policy product_addons_select on public.product_addons for select to authenticated
  using (public.auth_employee_id() is not null);
create policy product_addons_write on public.product_addons for all to authenticated
  using (public.has_role(array['owner','manager'])) with check (public.has_role(array['owner','manager']));

create policy discounts_select on public.discounts for select to authenticated
  using (public.auth_employee_id() is not null);
create policy discounts_write on public.discounts for all to authenticated
  using (public.has_role(array['owner','manager'])) with check (public.has_role(array['owner','manager']));

create policy settings_select on public.settings for select to authenticated
  using (public.auth_employee_id() is not null);
create policy settings_update on public.settings for update to authenticated
  using (public.has_role(array['owner'])) with check (public.has_role(array['owner']));

-- ลูกค้า: ทุกคนเพิ่ม/แก้ได้ (ไม่มีนโยบายลบ — ใช้ปิดการใช้งานแทน)
create policy customers_select on public.customers for select to authenticated
  using (public.auth_employee_id() is not null);
create policy customers_insert on public.customers for insert to authenticated
  with check (public.auth_employee_id() is not null);
create policy customers_update on public.customers for update to authenticated
  using (public.auth_employee_id() is not null) with check (public.auth_employee_id() is not null);

-- ---------- สต็อก: ผู้จัดการขึ้นไป ----------
create policy inventory_items_select on public.inventory_items for select to authenticated
  using (public.has_role(array['owner','manager']));
create policy inventory_items_write on public.inventory_items for all to authenticated
  using (public.has_role(array['owner','manager'])) with check (public.has_role(array['owner','manager']));
create policy recipes_select on public.recipes for select to authenticated
  using (public.has_role(array['owner','manager']));
create policy recipes_write on public.recipes for all to authenticated
  using (public.has_role(array['owner','manager'])) with check (public.has_role(array['owner','manager']));
create policy stock_movements_select on public.stock_movements for select to authenticated
  using (public.has_role(array['owner','manager']));

-- ---------- ข้อมูลการเงิน: อ่านอย่างเดียว ----------
create policy shifts_select on public.shifts for select to authenticated
  using (
    public.has_role(array['owner','manager'])
    or (public.auth_employee_id() is not null
        and (status = 'open' or (opened_at at time zone 'Asia/Bangkok')::date = public.bkk_today()))
  );

create policy orders_select on public.orders for select to authenticated
  using (
    public.has_role(array['owner','manager'])
    or (public.auth_employee_id() is not null and business_date = public.bkk_today())
  );

create policy order_items_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_items.order_id));

create policy payments_select on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = payments.order_id));

create policy refunds_select on public.refunds for select to authenticated
  using (
    public.has_role(array['owner','manager'])
    or (public.auth_employee_id() is not null
        and (created_at at time zone 'Asia/Bangkok')::date = public.bkk_today())
  );

create policy cash_movements_select on public.cash_movements for select to authenticated
  using (
    public.has_role(array['owner','manager'])
    or (public.auth_employee_id() is not null
        and (created_at at time zone 'Asia/Bangkok')::date = public.bkk_today())
  );

-- audit log: เจ้าของอ่านได้เท่านั้น
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.has_role(array['owner']));

-- order_counters: ไม่มี policy = ไม่มีใครเข้าถึงตรงได้ (ฟังก์ชัน SECURITY DEFINER เท่านั้น)

-- =====================================================================
-- Grants (defense in depth)
-- =====================================================================
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ตารางการเงิน: ห้ามเขียนตรงแม้ผ่าน RLS
revoke insert, update, delete, truncate on
  public.shifts, public.order_counters, public.orders, public.order_items, public.payments,
  public.refunds, public.cash_movements, public.stock_movements, public.audit_logs
  from authenticated;
-- พนักงาน: ห้ามสร้าง/ลบแถวเอง (สร้างผ่าน trigger/Admin API) และห้ามแก้ตัวตน
revoke insert, delete, truncate on public.employees from authenticated;
revoke insert, delete, truncate on public.settings  from authenticated;
-- ไม่มีการลบลูกค้า/ทะเบียนเครื่อง
revoke delete, truncate on public.customers from authenticated;

-- ฟังก์ชัน: ปิดทางเข้า anon/public แล้วเปิดเฉพาะ authenticated ที่จำเป็น
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;

grant execute on function public.bkk_today()                                   to authenticated;
grant execute on function public.auth_employee_id()                            to authenticated;
grant execute on function public.auth_role()                                   to authenticated;
grant execute on function public.has_role(text[])                              to authenticated;
grant execute on function public.get_shift_summary(uuid)                       to authenticated;
grant execute on function public.open_shift(uuid, integer)                     to authenticated;
grant execute on function public.close_shift(uuid, integer, text)              to authenticated;
grant execute on function public.checkout_order(uuid, uuid, jsonb, uuid, text, integer, text, uuid, text)
                                                                               to authenticated;
grant execute on function public.set_order_prep_status(uuid, text, text)       to authenticated;
grant execute on function public.refund_order(uuid, uuid, integer, text, text, uuid)
                                                                               to authenticated;
grant execute on function public.record_cash_movement(uuid, text, text, integer, text, text, uuid)
                                                                               to authenticated;
grant execute on function public.reverse_cash_movement(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.adjust_stock(uuid, text, numeric, text)       to authenticated;
grant execute on function public.sales_report(date, date)                      to authenticated;
-- หมายเหตุ: require_role / compute_shift_summary / resolve_open_shift / calc_discount
-- ใช้ภายในฟังก์ชันเท่านั้น (เรียกจาก SECURITY DEFINER ได้โดยไม่ต้อง grant ให้ authenticated)

-- พนักงาน: แก้ได้เฉพาะ ชื่อ / บทบาท / สถานะใช้งาน (ห้ามแก้ id, email)
revoke update on public.employees from authenticated;
grant update (name, role, active) on public.employees to authenticated;
