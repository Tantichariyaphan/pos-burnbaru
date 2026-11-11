-- =====================================================================
-- Grandfa Farm Cafe & Resort — POS
-- 0001: schema (ตาราง, constraints, triggers ป้องกันแก้ไขข้อมูลการเงิน)
--
-- หลักการ
--  * เงินทุกจำนวนเป็น "สตางค์" (integer) — ไม่ใช้ float
--  * ข้อมูลการเงิน (orders/order_items/payments/refunds/cash_movements/shifts)
--    ห้ามลบ และห้ามแก้ยอด — แก้ไขด้วยรายการคืนเงิน/รายการกลับรายการเท่านั้น
--  * เวลาธุรกิจใช้เขตเวลา Asia/Bangkok
-- =====================================================================

-- ---------- helpers ----------
create or replace function public.bkk_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Bangkok')::date $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- employees ----------
create table public.employees (
  id          uuid primary key references auth.users(id) on delete restrict,
  name        text not null check (length(btrim(name)) > 0),
  email       text,
  role        text not null default 'cashier' check (role in ('owner','manager','cashier')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger employees_touch before update on public.employees
  for each row execute function public.touch_updated_at();

-- ---------- registers (เครื่อง POS / ลิ้นชักเงินสด) ----------
create table public.registers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- catalog ----------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(btrim(name)) > 0),
  emoji       text,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger categories_touch before update on public.categories
  for each row execute function public.touch_updated_at();

create table public.products (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid not null references public.categories(id) on delete restrict,
  name          text not null check (length(btrim(name)) > 0),
  emoji         text,
  -- NULL = ยังไม่ได้ยืนยันราคา → ขายไม่ได้
  price_satang  integer check (price_satang is null or (price_satang >= 0 and price_satang <= 10000000)),
  is_active     boolean not null default true,   -- เปิด/ปิดการใช้งานสินค้า
  is_available  boolean not null default true,   -- มีของ/หมดชั่วคราว
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (category_id, name)
);
create index products_category_idx on public.products(category_id, sort_order);
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

create table public.addons (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique check (length(btrim(name)) > 0),
  price_satang  integer not null default 0 check (price_satang >= 0 and price_satang <= 1000000),
  sort_order    integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger addons_touch before update on public.addons
  for each row execute function public.touch_updated_at();

create table public.product_addons (
  product_id  uuid not null references public.products(id) on delete cascade,
  addon_id    uuid not null references public.addons(id) on delete cascade,
  primary key (product_id, addon_id)
);

create table public.discounts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(btrim(name)) > 0),
  kind        text not null check (kind in ('percent','fixed')),
  -- percent: basis points (1000 = 10%)  |  fixed: satang
  value       integer not null check (value > 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (kind <> 'percent' or value <= 10000)
);
create trigger discounts_touch before update on public.discounts
  for each row execute function public.touch_updated_at();

create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  phone       text,
  note        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

-- ---------- settings (แถวเดียว) ----------
create table public.settings (
  id                 boolean primary key default true check (id),
  shop_name          text not null default 'Grandfa Farm Cafe & Resort',
  receipt_footer     text not null default 'ขอบคุณที่มาใช้บริการ',
  -- ต้องให้เจ้าของยืนยันราคาแล้วเปิดเอง ระบบจึงจะรับชำระเงินได้
  sales_enabled      boolean not null default false,
  inventory_enabled  boolean not null default false,
  customers_enabled  boolean not null default false,
  updated_at         timestamptz not null default now()
);
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- ---------- shifts ----------
create table public.shifts (
  id                   uuid primary key default gen_random_uuid(),
  register_id          uuid not null references public.registers(id) on delete restrict,
  opened_by            uuid not null references public.employees(id) on delete restrict,
  opened_at            timestamptz not null default now(),
  opening_cash_satang  integer not null check (opening_cash_satang >= 0),
  status               text not null default 'open' check (status in ('open','closed')),
  closed_by            uuid references public.employees(id) on delete restrict,
  closed_at            timestamptz,
  counted_cash_satang  integer check (counted_cash_satang >= 0),
  expected_cash_satang integer,
  variance_satang      integer,
  summary              jsonb,        -- snapshot ตอนปิดกะ (ห้ามแก้)
  close_note           text,
  check (
    (status = 'open'   and closed_at is null and counted_cash_satang is null)
    or
    (status = 'closed' and closed_at is not null and counted_cash_satang is not null
                       and expected_cash_satang is not null and variance_satang is not null
                       and summary is not null)
  )
);
-- เครื่องเดียวเปิดกะซ้อนกันไม่ได้
create unique index shifts_one_open_per_register on public.shifts(register_id) where status = 'open';
create index shifts_opened_at_idx on public.shifts(opened_at desc);

-- ---------- orders ----------
-- เก็บเฉพาะออเดอร์ที่ "ชำระเงินแล้ว" (ตะกร้าที่ยังไม่ชำระอยู่ฝั่งหน้าจอเท่านั้น)
create table public.order_counters (
  business_date date primary key,
  last_no       integer not null
);

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_no         integer not null check (order_no > 0),
  business_date    date not null default public.bkk_today(),
  shift_id         uuid not null references public.shifts(id) on delete restrict,
  employee_id      uuid not null references public.employees(id) on delete restrict,
  customer_id      uuid references public.customers(id) on delete restrict,
  subtotal_satang  integer not null check (subtotal_satang > 0),
  discount_id      uuid references public.discounts(id) on delete restrict,
  discount_name    text,
  discount_satang  integer not null default 0 check (discount_satang >= 0),
  total_satang     integer not null check (total_satang > 0),
  payment_status   text not null default 'paid'
                     check (payment_status in ('paid','partially_refunded','refunded')),
  prep_status      text not null default 'preparing' check (prep_status in ('preparing','done')),
  prepared_at      timestamptz,
  prepared_by      uuid references public.employees(id) on delete restrict,
  note             text,
  created_at       timestamptz not null default now(),
  unique (business_date, order_no),
  check (discount_satang <= subtotal_satang),
  check (total_satang = subtotal_satang - discount_satang)
);
create index orders_date_idx on public.orders(business_date, created_at desc);
create index orders_shift_idx on public.orders(shift_id);
create index orders_prep_idx on public.orders(business_date, prep_status);

create table public.order_items (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders(id) on delete restrict,
  product_id           uuid references public.products(id) on delete set null,
  -- snapshot: แก้สินค้าภายหลังแล้วใบเสร็จเก่าต้องไม่เปลี่ยน
  product_name         text not null,
  category_name        text not null,
  unit_price_satang    integer not null check (unit_price_satang >= 0),
  addons               jsonb not null default '[]'::jsonb,
  addon_unit_satang    integer not null default 0 check (addon_unit_satang >= 0),
  quantity             integer not null check (quantity between 1 and 99),
  line_total_satang    integer not null check (line_total_satang >= 0),
  check (line_total_satang = (unit_price_satang + addon_unit_satang) * quantity)
);
create index order_items_order_idx on public.order_items(order_id);

-- ---------- payments ----------
create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id) on delete restrict,
  shift_id         uuid not null references public.shifts(id) on delete restrict,
  method           text not null check (method in ('cash','transfer')),
  amount_satang    integer not null check (amount_satang > 0),    -- ยอดที่ตัดชำระออเดอร์
  received_satang  integer not null check (received_satang > 0),  -- เงินที่รับมาจริง
  change_satang    integer not null default 0 check (change_satang >= 0),
  reference        text,                                          -- เลขอ้างอิงการโอน
  confirmed_by     uuid not null references public.employees(id) on delete restrict,
  idempotency_key  uuid not null unique,                          -- กันกดชำระซ้ำ
  created_at       timestamptz not null default now(),
  check (
    (method = 'cash'     and received_satang >= amount_satang and change_satang = received_satang - amount_satang)
    or
    (method = 'transfer' and received_satang = amount_satang  and change_satang = 0)
  )
);
create index payments_order_idx on public.payments(order_id);
create index payments_shift_idx on public.payments(shift_id);

-- ---------- refunds ----------
create table public.refunds (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id) on delete restrict,
  shift_id         uuid references public.shifts(id) on delete restrict,   -- กะที่จ่ายคืน (กะปัจจุบัน)
  amount_satang    integer not null check (amount_satang > 0),
  method           text not null check (method in ('cash','transfer')),
  reason           text not null check (length(btrim(reason)) > 0),
  employee_id      uuid not null references public.employees(id) on delete restrict,
  idempotency_key  uuid not null unique,
  created_at       timestamptz not null default now(),
  check (method <> 'cash' or shift_id is not null)
);
create index refunds_order_idx on public.refunds(order_id);
create index refunds_shift_idx on public.refunds(shift_id);

-- ---------- cash movements (เงินเข้า-ออก) ----------
-- direction (เข้า/ออก) และ channel (เงินสด/โอน) แยกจากกันโดยอิสระ
-- ผลต่อลิ้นชักเงินสด: เฉพาะ channel = 'cash'
create table public.cash_movements (
  id               uuid primary key default gen_random_uuid(),
  shift_id         uuid references public.shifts(id) on delete restrict,
  direction        text not null check (direction in ('in','out')),
  channel          text not null check (channel in ('cash','transfer')),
  amount_satang    integer not null check (amount_satang > 0 and amount_satang <= 1000000000),
  category         text not null check (length(btrim(category)) > 0),
  note             text,
  employee_id      uuid not null references public.employees(id) on delete restrict,
  reverses_id      uuid unique references public.cash_movements(id) on delete restrict,
  idempotency_key  uuid not null unique,
  created_at       timestamptz not null default now(),
  check (channel <> 'cash' or shift_id is not null)
);
create index cash_movements_shift_idx on public.cash_movements(shift_id);
create index cash_movements_created_idx on public.cash_movements(created_at desc);

-- ---------- inventory ----------
create table public.inventory_items (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique check (length(btrim(name)) > 0),
  unit             text not null default 'หน่วย',
  qty_on_hand      numeric(14,3) not null default 0,
  low_stock_level  numeric(14,3) not null default 0 check (low_stock_level >= 0),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger inventory_items_touch before update on public.inventory_items
  for each row execute function public.touch_updated_at();

-- สูตร: สินค้า 1 หน่วย ตัดวัตถุดิบเท่าไร (ตัดตอนชำระเงินเท่านั้น และเฉพาะเมื่อเปิดใช้สต็อก)
create table public.recipes (
  product_id         uuid not null references public.products(id) on delete cascade,
  inventory_item_id  uuid not null references public.inventory_items(id) on delete cascade,
  qty_per_unit       numeric(14,3) not null check (qty_per_unit > 0),
  primary key (product_id, inventory_item_id)
);

create table public.stock_movements (
  id                 uuid primary key default gen_random_uuid(),
  inventory_item_id  uuid not null references public.inventory_items(id) on delete restrict,
  kind               text not null check (kind in ('receive','sale','waste','adjust')),
  qty_delta          numeric(14,3) not null check (qty_delta <> 0),
  order_item_id      uuid references public.order_items(id) on delete restrict,
  note               text,
  employee_id        uuid references public.employees(id) on delete restrict,
  created_at         timestamptz not null default now(),
  check ((kind = 'sale') = (order_item_id is not null))
);
-- กันตัดสต็อกซ้ำ: 1 รายการสินค้า × 1 วัตถุดิบ ตัดได้ครั้งเดียว
create unique index stock_sale_once on public.stock_movements(order_item_id, inventory_item_id)
  where kind = 'sale';
create index stock_movements_item_idx on public.stock_movements(inventory_item_id, created_at desc);

-- ---------- audit ----------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,
  entity      text not null,
  entity_id   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs(created_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity, entity_id);

-- =====================================================================
-- Guards: ข้อมูลการเงินห้ามลบ/แก้
-- =====================================================================
create or replace function public.forbid_modify() returns trigger
language plpgsql as $$
begin
  raise exception 'IMMUTABLE_RECORD: % on % is not allowed', tg_op, tg_table_name;
end $$;

create trigger payments_immutable        before update or delete on public.payments
  for each row execute function public.forbid_modify();
create trigger refunds_immutable         before update or delete on public.refunds
  for each row execute function public.forbid_modify();
create trigger cash_movements_immutable  before update or delete on public.cash_movements
  for each row execute function public.forbid_modify();
create trigger order_items_immutable     before update or delete on public.order_items
  for each row execute function public.forbid_modify();
create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function public.forbid_modify();
create trigger audit_logs_immutable      before update or delete on public.audit_logs
  for each row execute function public.forbid_modify();

-- orders: แก้ได้เฉพาะสถานะการทำอาหาร/สถานะคืนเงิน
create or replace function public.orders_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE_RECORD: DELETE on orders is not allowed';
  end if;
  if (new.id, new.order_no, new.business_date, new.shift_id, new.employee_id, new.customer_id,
      new.subtotal_satang, new.discount_id, new.discount_name, new.discount_satang,
      new.total_satang, new.created_at)
     is distinct from
     (old.id, old.order_no, old.business_date, old.shift_id, old.employee_id, old.customer_id,
      old.subtotal_satang, old.discount_id, old.discount_name, old.discount_satang,
      old.total_satang, old.created_at)
  then
    raise exception 'IMMUTABLE_RECORD: financial columns of orders cannot be changed';
  end if;
  return new;
end $$;
create trigger orders_guard_trg before update or delete on public.orders
  for each row execute function public.orders_guard();

-- shifts: กะที่ปิดแล้วห้ามแก้; ข้อมูลตอนเปิดกะห้ามแก้
create or replace function public.shifts_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE_RECORD: DELETE on shifts is not allowed';
  end if;
  if old.status = 'closed' then
    raise exception 'IMMUTABLE_RECORD: a closed shift cannot be modified';
  end if;
  if (new.id, new.register_id, new.opened_by, new.opened_at, new.opening_cash_satang)
     is distinct from
     (old.id, old.register_id, old.opened_by, old.opened_at, old.opening_cash_satang)
  then
    raise exception 'IMMUTABLE_RECORD: opening data of a shift cannot be changed';
  end if;
  return new;
end $$;
create trigger shifts_guard_trg before update or delete on public.shifts
  for each row execute function public.shifts_guard();

-- employees: ต้องเหลือเจ้าของที่ใช้งานอยู่อย่างน้อย 1 คนเสมอ
create or replace function public.employees_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE_RECORD: employees cannot be deleted (deactivate instead)';
  end if;
  if old.role = 'owner' and old.active and (new.role <> 'owner' or not new.active) then
    if not exists (select 1 from public.employees e
                   where e.role = 'owner' and e.active and e.id <> old.id) then
      raise exception 'LAST_OWNER: at least one active owner is required';
    end if;
  end if;
  return new;
end $$;
create trigger employees_guard_trg before update or delete on public.employees
  for each row execute function public.employees_guard();

-- =====================================================================
-- Audit trigger สำหรับข้อมูลที่แก้ไขได้ (ราคา, สินค้า, พนักงาน, ตั้งค่า ...)
-- =====================================================================
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id text;
begin
  if tg_op = 'DELETE' then
    v_id := (to_jsonb(old)->>'id');
    insert into public.audit_logs(actor_id, action, entity, entity_id, details)
    values (auth.uid(), 'delete', tg_table_name, v_id, jsonb_build_object('old', to_jsonb(old)));
    return old;
  elsif tg_op = 'UPDATE' then
    v_id := (to_jsonb(new)->>'id');
    insert into public.audit_logs(actor_id, action, entity, entity_id, details)
    values (auth.uid(), 'update', tg_table_name, v_id,
            jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)));
    return new;
  else
    v_id := (to_jsonb(new)->>'id');
    insert into public.audit_logs(actor_id, action, entity, entity_id, details)
    values (auth.uid(), 'insert', tg_table_name, v_id, jsonb_build_object('new', to_jsonb(new)));
    return new;
  end if;
end $$;

create trigger audit_products         after insert or update or delete on public.products         for each row execute function public.audit_row();
create trigger audit_categories       after insert or update or delete on public.categories       for each row execute function public.audit_row();
create trigger audit_addons           after insert or update or delete on public.addons           for each row execute function public.audit_row();
create trigger audit_discounts        after insert or update or delete on public.discounts        for each row execute function public.audit_row();
create trigger audit_employees        after insert or update on public.employees                  for each row execute function public.audit_row();
create trigger audit_settings         after insert or update on public.settings                   for each row execute function public.audit_row();
create trigger audit_inventory_items  after insert or update or delete on public.inventory_items  for each row execute function public.audit_row();
create trigger audit_customers        after insert or update on public.customers                  for each row execute function public.audit_row();

-- =====================================================================
-- ข้อมูลตั้งต้นที่จำเป็นต่อการทำงาน (ไม่ใช่ข้อมูลเมนู — เมนูอยู่ใน seed.sql)
-- =====================================================================
insert into public.settings (id) values (true) on conflict do nothing;
insert into public.registers (name) values ('POS 1') on conflict do nothing;
