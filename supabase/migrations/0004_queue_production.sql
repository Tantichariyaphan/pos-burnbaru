-- =====================================================================
-- 0004: คิวลูกค้า (QR) + สถานีผลิต (เค้ก/เครื่องดื่ม) + รอบอบเค้ก
--
-- ★ Additive เท่านั้น: ไม่แก้/ไม่ลบ ตาราง ฟังก์ชัน trigger หรือ policy เดิมใดๆ
--   * checkout_order(), set_order_prep_status(), refund_order() ไม่ถูกแก้ไข
--   * คิวถูกสร้างโดย trigger AFTER INSERT บน payments (อยู่ใน transaction เดียวกับการชำระเงิน
--     ชำระไม่สำเร็จ = rollback = ไม่มีคิว) และ "ไม่มีวันทำให้การขายล้มเหลว" (ถ้าสร้างคิวพลาด
--     จะแจ้งเตือนแล้วขายต่อได้ แล้วซ่อมทีหลังด้วย ensure_order_queue)
--   * การเขียนข้อมูลคิว/รอบอบทำผ่านฟังก์ชันเท่านั้น (ไม่มีสิทธิ์เขียนตรงจาก API)
--   * ลูกค้าอ่านได้ผ่าน get_public_queue(token) ฟังก์ชันเดียว คืนเฉพาะข้อมูลของออเดอร์ตัวเอง
--
-- Rollback: ดู supabase/rollback/0004_rollback.sql (ลบเฉพาะของใหม่ ไม่แตะข้อมูลการเงิน)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) ตั้งค่าการผลิต + การกำหนดสถานีของสินค้า
-- ---------------------------------------------------------------------
create table public.production_settings (
  id               boolean primary key default true check (id),
  batch_capacity   integer not null default 22 check (batch_capacity between 1 and 200),
  -- true = เค้กต่างรสอยู่รอบเดียวกันได้ / false = หนึ่งรอบต่อหนึ่งรส
  mix_flavors      boolean not null default true,
  -- เวลาอบต่อรอบ (นาที) — ถ้าไม่ตั้ง ระบบจะ "ไม่ประมาณเวลารอ" (ไม่มีข้อมูลรองรับ)
  bake_minutes     integer check (bake_minutes is null or bake_minutes between 1 and 600),
  -- สินค้าที่ไม่ได้กำหนดสถานีจะไปที่สถานีนี้
  default_station  text not null default 'drink' check (default_station in ('cake','drink')),
  -- ลิงก์คิวของลูกค้าใช้ได้กี่ชั่วโมงหลังสร้าง
  queue_link_hours integer not null default 24 check (queue_link_hours between 1 and 168),
  updated_at       timestamptz not null default now()
);
insert into public.production_settings (id) values (true) on conflict do nothing;
create trigger production_settings_touch before update on public.production_settings
  for each row execute function public.touch_updated_at();
create trigger audit_production_settings after insert or update on public.production_settings
  for each row execute function public.audit_row();

create table public.category_stations (
  category_id uuid primary key references public.categories(id) on delete cascade,
  station     text not null check (station in ('cake','drink'))
);
create table public.product_stations (          -- override ระดับสินค้า (ไม่บังคับ)
  product_id  uuid primary key references public.products(id) on delete cascade,
  station     text not null check (station in ('cake','drink'))
);
create trigger audit_category_stations after insert or update or delete on public.category_stations
  for each row execute function public.audit_row();
create trigger audit_product_stations after insert or update or delete on public.product_stations
  for each row execute function public.audit_row();

-- ค่าเริ่มต้นจากชื่อหมวด (เดาจากชื่อ — เจ้าของตรวจ/แก้ได้ที่ ตั้งค่า → สถานีผลิต)
insert into public.category_stations (category_id, station)
select c.id, 'cake' from public.categories c
 where c.name ~* '(cheese ?cake|cake|เค้ก|bakery|เบเกอรี่|เบเกอรี)'
on conflict do nothing;
insert into public.category_stations (category_id, station)
select c.id, 'drink' from public.categories c
 where c.name ~* '(matcha|tea|coffee|latte|drink|beverage|ชา|กาแฟ|เครื่องดื่ม)'
   and not exists (select 1 from public.category_stations s where s.category_id = c.id)
on conflict do nothing;

-- สินค้า → สถานี: override สินค้า → หมวด → ค่าเริ่มต้น
create or replace function public.resolve_station(p_product_id uuid, p_category_name text default null)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select ps.station from public.product_stations ps where ps.product_id = p_product_id),
    (select cs.station from public.products p join public.category_stations cs on cs.category_id = p.category_id
      where p.id = p_product_id),
    (select cs.station from public.categories c join public.category_stations cs on cs.category_id = c.id
      where p_product_id is null and c.name = p_category_name),
    (select default_station from public.production_settings)
  )
$$;

-- ---------------------------------------------------------------------
-- 2) คิว
-- ---------------------------------------------------------------------
create table public.queue_counters (            -- เลขคิวรีเซ็ตทุกวัน (Asia/Bangkok) ไม่ซ้ำภายในวัน
  business_date date primary key,
  last_no       integer not null
);

create table public.order_queues (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null unique references public.orders(id) on delete restrict,
  business_date date not null,
  queue_no      integer not null check (queue_no > 0),
  -- bearer token ของ QR: 64 hex (≈244 บิต) จาก gen_random_uuid() ×2 (CSPRNG) — ห้ามเขียนลง log
  public_token  text not null unique check (public_token ~ '^[0-9a-f]{64}$'),
  status        text not null default 'queued'
                  check (status in ('queued','preparing','ready','completed','cancelled')),
  version       integer not null default 1,     -- ป้องกันการอัปเดตทับกัน (stale update)
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  ready_at      timestamptz,
  completed_at  timestamptz,
  completed_by  uuid references public.employees(id) on delete restrict,
  updated_at    timestamptz not null default now(),
  unique (business_date, queue_no)
);
create index order_queues_active_idx on public.order_queues(business_date, queue_no)
  where status in ('queued','preparing','ready');

create table public.item_preparations (
  id             uuid primary key default gen_random_uuid(),
  queue_id       uuid not null references public.order_queues(id) on delete restrict,
  order_id       uuid not null references public.orders(id) on delete restrict,
  order_item_id  uuid not null unique references public.order_items(id) on delete restrict,
  station        text not null check (station in ('cake','drink')),
  product_id     uuid,                           -- snapshot (ไม่ผูก FK เพื่อให้ลบสินค้าได้)
  product_name   text not null,
  quantity       integer not null check (quantity > 0),
  ready_quantity integer not null default 0 check (ready_quantity >= 0 and ready_quantity <= quantity),
  status         text not null default 'queued' check (status in ('queued','preparing','ready','cancelled')),
  started_at     timestamptz,
  ready_at       timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (status <> 'ready' or ready_quantity = quantity)
);
create index item_preparations_queue_idx on public.item_preparations(queue_id);
create index item_preparations_station_idx on public.item_preparations(station, status);

-- คิวกับรายการต้องเป็นออเดอร์เดียวกัน (ไม่ใช้ composite FK เพื่อไม่ให้ PostgREST embed กำกวม)
create or replace function public.item_preparations_consistency() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from public.order_queues q where q.id = new.queue_id and q.order_id = new.order_id)
     or not exists (select 1 from public.order_items i where i.id = new.order_item_id and i.order_id = new.order_id) then
    raise exception 'INVALID_REFERENCE: item_preparations must match its queue and order';
  end if;
  return new;
end $$;
create trigger item_preparations_consistency_trg before insert on public.item_preparations
  for each row execute function public.item_preparations_consistency();

-- ---------------------------------------------------------------------
-- 3) รอบอบ
-- ---------------------------------------------------------------------
create table public.production_batches (
  id            uuid primary key default gen_random_uuid(),
  business_date date not null default public.bkk_today(),
  batch_no      integer not null check (batch_no > 0),
  station       text not null default 'cake' check (station = 'cake'),   -- ขยายสถานีอื่นได้ภายหลัง
  status        text not null default 'planning' check (status in ('planning','baking','completed','cancelled')),
  capacity      integer not null check (capacity > 0),
  created_by    uuid references public.employees(id) on delete restrict,
  started_by    uuid references public.employees(id) on delete restrict,
  completed_by  uuid references public.employees(id) on delete restrict,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  unique (business_date, batch_no)
);
create index production_batches_open_idx on public.production_batches(business_date, batch_no)
  where status in ('planning','baking');

create table public.batch_items (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid not null references public.production_batches(id) on delete restrict,
  item_preparation_id uuid not null references public.item_preparations(id) on delete restrict,
  quantity            integer not null check (quantity > 0),
  created_at          timestamptz not null default now(),
  unique (batch_id, item_preparation_id)
);
create index batch_items_prep_idx on public.batch_items(item_preparation_id);

-- กันจัดเกินความจุ/เกินจำนวนที่สั่ง แม้มีหลายเครื่องแก้พร้อมกัน (ล็อกแถวแม่ก่อนนับ)
create or replace function public.batch_items_guard() returns trigger
language plpgsql as $$
declare
  v_batch public.production_batches;
  v_prep  public.item_preparations;
  v_batch_load integer;
  v_prep_alloc integer;
begin
  select * into v_batch from public.production_batches where id = new.batch_id for update;
  select * into v_prep  from public.item_preparations  where id = new.item_preparation_id for update;
  if v_prep.station <> 'cake' then
    raise exception 'INVALID_STATION: only cake items can be batched';
  end if;
  if v_prep.status = 'cancelled' then
    raise exception 'ITEM_CANCELLED';
  end if;
  if tg_op = 'INSERT' and v_batch.status <> 'planning' then
    raise exception 'BATCH_LOCKED';
  end if;

  select coalesce(sum(quantity), 0) into v_batch_load
    from public.batch_items where batch_id = new.batch_id and id is distinct from new.id;
  if v_batch_load + new.quantity > v_batch.capacity then
    raise exception 'BATCH_CAPACITY_EXCEEDED: % + % > %', v_batch_load, new.quantity, v_batch.capacity;
  end if;

  -- จำนวนที่จัดลงรอบที่ยังไม่เสร็จ + ที่เสร็จแล้ว ต้องไม่เกินจำนวนที่สั่ง
  select coalesce(sum(bi.quantity), 0) into v_prep_alloc
    from public.batch_items bi join public.production_batches b on b.id = bi.batch_id
   where bi.item_preparation_id = new.item_preparation_id and b.status in ('planning','baking')
     and bi.id is distinct from new.id;
  if v_prep_alloc + new.quantity > v_prep.quantity - v_prep.ready_quantity then
    raise exception 'ITEM_OVER_ALLOCATED: % + % > % - %', v_prep_alloc, new.quantity, v_prep.quantity, v_prep.ready_quantity;
  end if;
  return new;
end $$;
create trigger batch_items_guard_trg before insert or update on public.batch_items
  for each row execute function public.batch_items_guard();

create trigger audit_production_batches after insert or update on public.production_batches
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- 4) ฟังก์ชันภายใน (ไม่ให้ client เรียกตรง — revoke ท้ายไฟล์)
-- ---------------------------------------------------------------------
create or replace function public._station_status(p_queue_id uuid, p_station text)
returns text language sql stable security definer set search_path = public as $$
  select case
           when count(*) = 0 then null
           when bool_and(status = 'ready') then 'ready'
           when bool_or(status in ('preparing','ready')) then 'preparing'
           else 'queued'
         end
    from public.item_preparations
   where queue_id = p_queue_id and station = p_station and status <> 'cancelled'
$$;

-- คำนวณสถานะรวมของคิวจากสถานี + เพิ่ม version (เรียกทุกครั้งที่งานของคิวเปลี่ยน)
create or replace function public._recompute_queue(p_queue_id uuid) returns public.order_queues
language plpgsql security definer set search_path = public as $$
declare
  v_q public.order_queues;
  v_cake text; v_drink text; v_new text;
begin
  select * into v_q from public.order_queues where id = p_queue_id for update;
  if v_q.status in ('completed','cancelled') then
    return v_q;
  end if;
  v_cake  := public._station_status(p_queue_id, 'cake');
  v_drink := public._station_status(p_queue_id, 'drink');
  if v_cake is null and v_drink is null then
    v_new := v_q.status;
  elsif coalesce(v_cake, 'ready') = 'ready' and coalesce(v_drink, 'ready') = 'ready' then
    v_new := 'ready';                                  -- ทุกสถานีที่ต้องทำเสร็จครบ
  elsif v_cake in ('preparing','ready') or v_drink in ('preparing','ready') then
    v_new := 'preparing';
  else
    v_new := 'queued';
  end if;
  update public.order_queues
     set status = v_new,
         version = version + 1,
         updated_at = now(),
         started_at = case when v_new in ('preparing','ready') then coalesce(started_at, now()) else started_at end,
         ready_at = case when v_new = 'ready' then coalesce(ready_at, now()) else null end
   where id = p_queue_id
  returning * into v_q;
  return v_q;
end $$;

-- สร้างคิวให้ออเดอร์ที่ "ชำระเงินแล้ว" (idempotent: มีแล้วคืนของเดิม)
create or replace function public._create_queue(p_order_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders;
  v_q uuid;
  v_no integer;
  v_station text;
  v_item record;
begin
  select id into v_q from public.order_queues where order_id = p_order_id;
  if found then
    return v_q;
  end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  -- ไม่สร้างคิวให้ออเดอร์ที่ยังไม่ชำระ/คืนเงินเต็มจำนวนแล้ว
  if v_order.payment_status = 'refunded' or not exists (select 1 from public.payments where order_id = p_order_id) then
    return null;
  end if;

  insert into public.queue_counters(business_date, last_no) values (v_order.business_date, 1)
  on conflict (business_date) do update set last_no = public.queue_counters.last_no + 1
  returning last_no into v_no;

  insert into public.order_queues(order_id, business_date, queue_no, public_token)
  values (p_order_id, v_order.business_date, v_no,
          replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  returning id into v_q;

  for v_item in select * from public.order_items where order_id = p_order_id order by id loop
    v_station := public.resolve_station(v_item.product_id, v_item.category_name);
    insert into public.item_preparations(queue_id, order_id, order_item_id, station, product_id, product_name, quantity)
    values (v_q, p_order_id, v_item.id, v_station, v_item.product_id, v_item.product_name, v_item.quantity);
  end loop;

  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'queue_created', 'order_queues', v_q::text,
          jsonb_build_object('order_id', p_order_id, 'queue_no', v_no));
  return v_q;
end $$;

-- trigger: สร้างคิวทันทีที่บันทึกการชำระเงินสำเร็จ (ไม่ทำให้การขายล้มเหลวถ้าพลาด)
create or replace function public.payments_create_queue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public._create_queue(new.order_id);
  exception when others then
    raise warning 'QUEUE_CREATE_FAILED order=% : %', new.order_id, sqlerrm;
  end;
  return new;
end $$;
create trigger payments_create_queue_trg after insert on public.payments
  for each row execute function public.payments_create_queue();

-- ยกเลิกคิวเมื่อออเดอร์ถูกคืนเงินเต็มจำนวน (ผ่านขั้นตอนคืนเงินเดิม)
create or replace function public._cancel_queue(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_q public.order_queues;
begin
  select * into v_q from public.order_queues where order_id = p_order_id for update;
  if not found or v_q.status in ('completed','cancelled') then
    return;
  end if;
  delete from public.batch_items bi using public.production_batches b
   where b.id = bi.batch_id and b.status = 'planning'
     and bi.item_preparation_id in (select id from public.item_preparations where queue_id = v_q.id);
  update public.item_preparations set status = 'cancelled', updated_at = now() where queue_id = v_q.id;
  update public.order_queues set status = 'cancelled', version = version + 1, updated_at = now() where id = v_q.id;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'queue_cancelled', 'order_queues', v_q.id::text, jsonb_build_object('order_id', p_order_id));
end $$;

create or replace function public.orders_refund_cancels_queue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public._cancel_queue(new.id);
  exception when others then
    raise warning 'QUEUE_CANCEL_FAILED order=% : %', new.id, sqlerrm;
  end;
  return new;
end $$;
create trigger orders_refund_cancels_queue_trg after update of payment_status on public.orders
  for each row when (new.payment_status = 'refunded' and old.payment_status is distinct from 'refunded')
  execute function public.orders_refund_cancels_queue();

-- ส่งมอบ (completed) ภายใน: ใช้ร่วมกันระหว่าง RPC และ trigger ของปุ่ม DONE เดิม
create or replace function public._complete_queue(p_queue_id uuid, p_emp uuid, p_via text) returns public.order_queues
language plpgsql security definer set search_path = public as $$
declare v_q public.order_queues;
begin
  select * into v_q from public.order_queues where id = p_queue_id for update;
  if v_q.status in ('completed','cancelled') then
    return v_q;
  end if;
  -- งานที่ยังไม่เสร็จถูกปิดตามการส่งมอบ (คนส่งมอบยืนยันแล้ว) — รอบอบที่ยังไม่จบไม่ถูกแตะ
  -- เค้กที่ยังอยู่ในแผน (planning) ถูกถอดออกจากรอบ (ไม่กินความจุ); รอบที่กำลังอบจริงไม่ถูกแตะ
  delete from public.batch_items bi using public.production_batches b
   where b.id = bi.batch_id and b.status = 'planning'
     and bi.item_preparation_id in (select id from public.item_preparations where queue_id = p_queue_id);
  update public.item_preparations
     set status = 'ready', ready_quantity = quantity, ready_at = coalesce(ready_at, now()),
         started_at = coalesce(started_at, now()), updated_at = now()
   where queue_id = p_queue_id and status in ('queued','preparing');
  update public.order_queues
     set status = 'completed', version = version + 1, completed_at = now(), completed_by = p_emp,
         ready_at = coalesce(ready_at, now()), started_at = coalesce(started_at, now()), updated_at = now()
   where id = p_queue_id returning * into v_q;
  update public.orders set prep_status = 'done', prepared_at = now(), prepared_by = p_emp
   where id = v_q.order_id and prep_status <> 'done';
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (p_emp, 'queue_completed', 'order_queues', p_queue_id::text,
          jsonb_build_object('order_id', v_q.order_id, 'via', p_via));
  return v_q;
end $$;

-- ปุ่ม DONE เดิม (set_order_prep_status) ยังใช้ได้และคิวซิงก์ตาม: DONE = ส่งมอบ, ย้อนกลับ = เปิดคิวใหม่
create or replace function public.orders_prep_status_syncs_queue() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_q public.order_queues;
begin
  select * into v_q from public.order_queues where order_id = new.id;
  if not found then
    return new;
  end if;
  if new.prep_status = 'done' and v_q.status in ('queued','preparing','ready') then
    perform public._complete_queue(v_q.id, coalesce(new.prepared_by, auth.uid()), 'legacy_done');
  elsif new.prep_status = 'preparing' and v_q.status = 'completed' then
    update public.order_queues
       set status = 'ready', version = version + 1, completed_at = null, completed_by = null, updated_at = now()
     where id = v_q.id;
  end if;
  return new;
end $$;
create trigger orders_prep_status_syncs_queue_trg after update of prep_status on public.orders
  for each row when (new.prep_status is distinct from old.prep_status)
  execute function public.orders_prep_status_syncs_queue();

-- ---------------------------------------------------------------------
-- 5) ฟังก์ชันที่พนักงานเรียกได้ (SECURITY DEFINER + ตรวจสิทธิ์ + transaction)
-- ---------------------------------------------------------------------
create or replace function public._queue_json(p_q public.order_queues, p_changed boolean) returns jsonb
language sql stable as $$
  select jsonb_build_object('queue_id', p_q.id, 'order_id', p_q.order_id, 'status', p_q.status,
                            'version', p_q.version, 'changed', p_changed)
$$;

-- ล็อกคิว + ตรวจสิทธิ์ (แคชเชียร์แตะได้เฉพาะคิวของวันนี้ เหมือน set_order_prep_status)
create or replace function public._lock_queue(p_order_id uuid) returns public.order_queues
language plpgsql security definer set search_path = public as $$
declare v_q public.order_queues;
begin
  perform public.require_role(null);
  select * into v_q from public.order_queues where order_id = p_order_id for update;
  if not found then
    raise exception 'QUEUE_NOT_FOUND';
  end if;
  if public.auth_role() = 'cashier' and v_q.business_date <> public.bkk_today() then
    raise exception 'FORBIDDEN';
  end if;
  return v_q;
end $$;

-- ซ่อม/สร้างคิวให้ออเดอร์ที่ชำระแล้ว (idempotent) — เรียกหลัง checkout เพื่อความแน่ใจ
create or replace function public.ensure_order_queue(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_q uuid; v_row public.order_queues; v_order public.orders;
begin
  perform public.require_role(null);
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if public.auth_role() = 'cashier' and v_order.business_date <> public.bkk_today() then
    raise exception 'FORBIDDEN';
  end if;
  v_q := public._create_queue(p_order_id);
  if v_q is null then
    return null;
  end if;
  select * into v_row from public.order_queues where id = v_q;
  return jsonb_build_object('queue_id', v_row.id, 'queue_no', v_row.queue_no,
                            'public_token', v_row.public_token, 'status', v_row.status, 'version', v_row.version);
end $$;

-- ซ่อมคิวที่ขาดของวันนี้ทั้งหมด (ปุ่มใน Dashboard) — คืนจำนวนที่สร้าง
create or replace function public.repair_missing_queues() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  perform public.require_role(null);
  for r in select o.id from public.orders o
            where o.business_date = public.bkk_today() and o.payment_status <> 'refunded'
              and exists (select 1 from public.payments p where p.order_id = o.id)
              and not exists (select 1 from public.order_queues q where q.order_id = o.id)
            order by o.created_at loop
    if public._create_queue(r.id) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- เปลี่ยนสถานะงานของ "สถานี" หนึ่งในออเดอร์ (ปุ่ม เริ่มทำ / พร้อมแล้ว / ย้อนกลับ)
-- idempotent: ถึงสถานะเป้าหมายแล้ว = ไม่ทำอะไร (changed=false) — กดซ้ำ/สองเครื่องกดพร้อมกันปลอดภัย
-- p_expected_version: ถ้าส่งมาและไม่ตรง (และยังไม่ถึงเป้าหมาย) = STALE_STATE ให้หน้าจอโหลดใหม่
create or replace function public.set_station_status(
  p_order_id uuid, p_station text, p_target text, p_expected_version integer default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_q public.order_queues;
  v_cur text;
  v_has_baking boolean;
  v_has_batch_done boolean;
begin
  if p_station not in ('cake','drink') or p_target not in ('queued','preparing','ready') then
    raise exception 'INVALID_STATUS';
  end if;
  v_q := public._lock_queue(p_order_id);
  if v_q.status in ('completed','cancelled') then
    raise exception 'QUEUE_CLOSED';
  end if;
  v_cur := public._station_status(v_q.id, p_station);
  if v_cur is null then
    raise exception 'STATION_NOT_REQUIRED';
  end if;
  if v_cur = p_target then
    return public._queue_json(v_q, false);
  end if;
  if p_expected_version is not null and p_expected_version <> v_q.version then
    raise exception 'STALE_STATE';
  end if;

  if p_station = 'cake' then
    -- เค้กเดินตามรอบอบ: เริ่ม/เสร็จผ่านรอบอบ; ที่นี่ทำได้เฉพาะ "พร้อมแล้วโดยไม่ผ่านรอบ" (เช่น มีเค้กในตู้)
    if p_target = 'preparing' then
      raise exception 'USE_BATCH';
    end if;
    select exists (select 1 from public.batch_items bi join public.production_batches b on b.id = bi.batch_id
                    join public.item_preparations ip on ip.id = bi.item_preparation_id
                    where ip.queue_id = v_q.id and ip.station = 'cake' and b.status = 'baking'),
           exists (select 1 from public.batch_items bi join public.production_batches b on b.id = bi.batch_id
                    join public.item_preparations ip on ip.id = bi.item_preparation_id
                    where ip.queue_id = v_q.id and ip.station = 'cake' and b.status = 'completed')
      into v_has_baking, v_has_batch_done;
    if p_target = 'ready' then
      if v_has_baking then raise exception 'CAKE_IN_BAKING_BATCH'; end if;
      delete from public.batch_items bi using public.production_batches b, public.item_preparations ip
       where b.id = bi.batch_id and b.status = 'planning' and ip.id = bi.item_preparation_id
         and ip.queue_id = v_q.id and ip.station = 'cake';
    elsif v_has_batch_done or v_has_baking then   -- p_target = 'queued' (ย้อนจาก ready)
      raise exception 'CAKE_BATCH_COMPLETED';
    end if;
  end if;

  update public.item_preparations
     set status = p_target,
         ready_quantity = case when p_target = 'ready' then quantity else 0 end,
         started_at = case when p_target = 'queued' then null else coalesce(started_at, now()) end,
         ready_at = case when p_target = 'ready' then coalesce(ready_at, now()) else null end,
         updated_at = now()
   where queue_id = v_q.id and station = p_station and status <> 'cancelled';

  v_q := public._recompute_queue(v_q.id);
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'station_status', 'order_queues', v_q.id::text,
          jsonb_build_object('station', p_station, 'from', v_cur, 'to', p_target));
  return public._queue_json(v_q, true);
end $$;

-- ส่งมอบให้ลูกค้า: ready → completed (ต้องยืนยันชัดเจน; p_force = ส่งมอบแม้งานยังไม่ครบ)
create or replace function public.complete_handover(
  p_order_id uuid, p_expected_version integer default null, p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_q public.order_queues; v_emp uuid;
begin
  v_q := public._lock_queue(p_order_id);
  v_emp := public.auth_employee_id();
  if v_q.status = 'completed' then
    return public._queue_json(v_q, false);
  end if;
  if v_q.status = 'cancelled' then
    raise exception 'QUEUE_CLOSED';
  end if;
  if p_expected_version is not null and p_expected_version <> v_q.version then
    raise exception 'STALE_STATE';
  end if;
  if v_q.status <> 'ready' and not coalesce(p_force, false) then
    raise exception 'NOT_READY';
  end if;
  v_q := public._complete_queue(v_q.id, v_emp, case when p_force then 'forced' else 'handover' end);
  return public._queue_json(v_q, true);
end $$;

-- ย้อนการส่งมอบ (completed → ready) — หน้าจอต้องขอให้ยืนยันก่อน
create or replace function public.reopen_handover(p_order_id uuid, p_expected_version integer default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_q public.order_queues;
begin
  v_q := public._lock_queue(p_order_id);
  if v_q.status in ('queued','preparing','ready') then
    return public._queue_json(v_q, false);
  end if;
  if v_q.status = 'cancelled' then
    raise exception 'QUEUE_CLOSED';
  end if;
  if p_expected_version is not null and p_expected_version <> v_q.version then
    raise exception 'STALE_STATE';
  end if;
  update public.order_queues
     set status = 'ready', version = version + 1, completed_at = null, completed_by = null, updated_at = now()
   where id = v_q.id returning * into v_q;
  update public.orders set prep_status = 'preparing', prepared_at = null, prepared_by = null
   where id = p_order_id and prep_status <> 'preparing';
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'queue_reopened', 'order_queues', v_q.id::text, jsonb_build_object('order_id', p_order_id));
  return public._queue_json(v_q, true);
end $$;

-- ---------------------------------------------------------------------
-- 6) วางแผนรอบอบ
-- ---------------------------------------------------------------------
-- งานเค้กที่ "ยังไม่ได้จัดลงรอบ" เรียงตามคิว (FIFO) — เฉพาะคิวที่ชำระแล้วและยังไม่เสร็จ/ยกเลิก
create or replace function public._cake_demand()
returns table (prep_id uuid, order_id uuid, queue_no integer, product_id uuid, product_name text, remaining integer)
language sql stable security definer set search_path = public as $$
  select ip.id, ip.order_id, q.queue_no, ip.product_id, ip.product_name,
         (ip.quantity - ip.ready_quantity - coalesce(a.qty, 0))::integer
    from public.item_preparations ip
    join public.order_queues q on q.id = ip.queue_id
    left join lateral (
      select sum(bi.quantity) as qty
        from public.batch_items bi join public.production_batches b on b.id = bi.batch_id
       where bi.item_preparation_id = ip.id and b.status in ('planning','baking')
    ) a on true
   where ip.station = 'cake' and ip.status <> 'cancelled'
     and q.status in ('queued','preparing') and q.business_date >= public.bkk_today() - 2
     and ip.quantity - ip.ready_quantity - coalesce(a.qty, 0) > 0
   order by q.business_date, q.queue_no, ip.created_at, ip.id
$$;

-- เสนอแผน: เติมรอบ planning ที่มีอยู่ก่อน แล้วเปิดรอบใหม่ตามต้องการ — FIFO, ไม่เกินความจุ,
-- ไม่แตะรอบที่เริ่มอบแล้ว  (ไม่เขียนข้อมูล)
create or replace function public._cake_plan() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cap integer; v_mix boolean; v_today date := public.bkk_today();
  s_id uuid[] := '{}'; s_no integer[] := '{}'; s_cap integer[] := '{}'; s_load integer[] := '{}';
  s_load0 integer[] := '{}'; s_prod text[] := '{}'; s_new boolean[] := '{}'; s_adds jsonb[] := '{}';
  v_next integer; r record; v_left integer; v_i integer; v_k integer; v_take integer; v_out jsonb := '[]'::jsonb;
begin
  select batch_capacity, mix_flavors into v_cap, v_mix from public.production_settings;
  for r in
    select b.id, b.batch_no, b.capacity,
           coalesce((select sum(bi.quantity) from public.batch_items bi where bi.batch_id = b.id), 0)::integer as load,
           (select min(ip.product_name) from public.batch_items bi
              join public.item_preparations ip on ip.id = bi.item_preparation_id where bi.batch_id = b.id) as prod
      from public.production_batches b
     where b.status = 'planning' and b.business_date = v_today order by b.batch_no
  loop
    s_id := s_id || r.id; s_no := s_no || r.batch_no; s_cap := s_cap || r.capacity; s_load := s_load || r.load;
    s_load0 := s_load0 || r.load; s_prod := s_prod || r.prod; s_new := s_new || false; s_adds := s_adds || '[]'::jsonb;
  end loop;
  select coalesce(max(batch_no), 0) + 1 into v_next from public.production_batches where business_date = v_today;

  for r in select * from public._cake_demand() loop
    v_left := r.remaining;
    while v_left > 0 loop
      v_i := null;
      for v_k in 1 .. coalesce(array_length(s_id, 1), 0) loop
        if s_load[v_k] < s_cap[v_k] and (v_mix or s_prod[v_k] is null or s_prod[v_k] = r.product_name) then
          v_i := v_k; exit;
        end if;
      end loop;
      if v_i is null then
        s_id := s_id || null::uuid; s_no := s_no || v_next; s_cap := s_cap || v_cap; s_load := s_load || 0;
        s_load0 := s_load0 || 0; s_prod := s_prod || null::text; s_new := s_new || true; s_adds := s_adds || '[]'::jsonb;
        v_next := v_next + 1;
        v_i := array_length(s_id, 1);
      end if;
      v_take := least(v_left, s_cap[v_i] - s_load[v_i]);
      s_adds[v_i] := s_adds[v_i] || jsonb_build_array(jsonb_build_object(
        'prep_id', r.prep_id, 'order_id', r.order_id, 'queue_no', r.queue_no,
        'product_id', r.product_id, 'product_name', r.product_name, 'quantity', v_take));
      s_load[v_i] := s_load[v_i] + v_take;
      if s_prod[v_i] is null then s_prod[v_i] := r.product_name; end if;
      v_left := v_left - v_take;
    end loop;
  end loop;

  for v_k in 1 .. coalesce(array_length(s_id, 1), 0) loop
    if jsonb_array_length(s_adds[v_k]) > 0 then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'batch_id', s_id[v_k], 'batch_no', s_no[v_k], 'is_new', s_new[v_k], 'capacity', s_cap[v_k],
        'current_load', s_load0[v_k], 'add_load', s_load[v_k] - s_load0[v_k], 'load_after', s_load[v_k],
        'items', s_adds[v_k]));
    end if;
  end loop;
  return v_out;
end $$;

create or replace function public.get_cake_plan() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_plan jsonb;
begin
  perform public.require_role(null);
  v_plan := public._cake_plan();
  return jsonb_build_object('batches', v_plan, 'signature', md5(v_plan::text));
end $$;

create or replace function public._plan_lock() returns void
language sql security definer set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('cake_plan:' || public.bkk_today()::text, 0))
$$;

-- พนักงานตรวจแผนแล้วกดยืนยัน → บันทึกเป็นรอบ (planning); signature กันแผนเปลี่ยนระหว่างที่ดูอยู่
create or replace function public.confirm_cake_plan(p_signature text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid; v_plan jsonb; v_b jsonb; v_it jsonb; v_batch uuid; v_no integer; v_cap integer; v_applied integer := 0;
begin
  v_emp := public.require_role(null);
  perform public._plan_lock();
  v_plan := public._cake_plan();
  if jsonb_array_length(v_plan) = 0 then
    return jsonb_build_object('applied', 0, 'batches', '[]'::jsonb);
  end if;
  if p_signature is distinct from md5(v_plan::text) then
    raise exception 'PLAN_CHANGED';
  end if;
  select batch_capacity into v_cap from public.production_settings;
  for v_b in select * from jsonb_array_elements(v_plan) loop
    if (v_b->>'is_new')::boolean then
      select coalesce(max(batch_no), 0) + 1 into v_no from public.production_batches where business_date = public.bkk_today();
      insert into public.production_batches(batch_no, capacity, created_by)
      values (v_no, (v_b->>'capacity')::integer, v_emp) returning id into v_batch;
    else
      v_batch := (v_b->>'batch_id')::uuid;
    end if;
    for v_it in select * from jsonb_array_elements(v_b->'items') loop
      insert into public.batch_items(batch_id, item_preparation_id, quantity)
      values (v_batch, (v_it->>'prep_id')::uuid, (v_it->>'quantity')::integer)
      on conflict (batch_id, item_preparation_id) do update set quantity = public.batch_items.quantity + excluded.quantity;
      v_applied := v_applied + (v_it->>'quantity')::integer;
    end loop;
  end loop;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'cake_plan_confirmed', 'production_batches', null, jsonb_build_object('pieces', v_applied));
  return jsonb_build_object('applied', v_applied, 'batches', v_plan);
end $$;

create or replace function public._touch_queues_of_batch(p_batch_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct ip.queue_id from public.batch_items bi
             join public.item_preparations ip on ip.id = bi.item_preparation_id where bi.batch_id = p_batch_id
  loop
    perform public._recompute_queue(r.queue_id);
  end loop;
end $$;

-- เริ่มอบ: ทำเฉพาะงานเค้กที่จัดอยู่ในรอบนี้
create or replace function public.start_batch(p_batch_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_b public.production_batches; v_emp uuid;
begin
  v_emp := public.require_role(null);
  perform public._plan_lock();
  select * into v_b from public.production_batches where id = p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_b.status in ('baking','completed') then
    return jsonb_build_object('batch_id', v_b.id, 'status', v_b.status, 'changed', false);
  end if;
  if v_b.status <> 'planning' then raise exception 'BATCH_LOCKED'; end if;
  if not exists (select 1 from public.batch_items where batch_id = p_batch_id) then raise exception 'EMPTY_BATCH'; end if;
  update public.production_batches set status = 'baking', started_at = now(), started_by = v_emp where id = p_batch_id;
  update public.item_preparations ip
     set status = 'preparing', started_at = coalesce(ip.started_at, now()), updated_at = now()
   where ip.status = 'queued' and ip.id in (select item_preparation_id from public.batch_items where batch_id = p_batch_id);
  perform public._touch_queues_of_batch(p_batch_id);
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'batch_started', 'production_batches', p_batch_id::text, '{}'::jsonb);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'baking', 'changed', true);
end $$;

-- อบเสร็จ: เฉพาะจำนวนที่จัดในรอบนี้เป็น "พร้อมแล้ว" (ไม่แตะเครื่องดื่ม/เค้กรายการอื่น)
create or replace function public.complete_batch(p_batch_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_b public.production_batches; v_emp uuid; r record;
begin
  v_emp := public.require_role(null);
  perform public._plan_lock();
  select * into v_b from public.production_batches where id = p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_b.status = 'completed' then
    return jsonb_build_object('batch_id', v_b.id, 'status', 'completed', 'changed', false);
  end if;
  if v_b.status <> 'baking' then raise exception 'BATCH_NOT_STARTED'; end if;
  for r in select bi.quantity, ip.id as prep_id from public.batch_items bi
             join public.item_preparations ip on ip.id = bi.item_preparation_id
            where bi.batch_id = p_batch_id order by ip.id for update of ip
  loop
    update public.item_preparations
       set ready_quantity = least(quantity, ready_quantity + r.quantity),
           status = case when least(quantity, ready_quantity + r.quantity) = quantity then 'ready' else 'preparing' end,
           ready_at = case when least(quantity, ready_quantity + r.quantity) = quantity then coalesce(ready_at, now()) else ready_at end,
           started_at = coalesce(started_at, now()), updated_at = now()
     where id = r.prep_id and status in ('queued','preparing');
  end loop;
  update public.production_batches set status = 'completed', completed_at = now(), completed_by = v_emp where id = p_batch_id;
  perform public._touch_queues_of_batch(p_batch_id);
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'batch_completed', 'production_batches', p_batch_id::text, '{}'::jsonb);
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'completed', 'changed', true);
end $$;

-- ยกเลิกรอบที่ยังไม่เริ่ม (งานกลับไปรอจัดแผนใหม่)
create or replace function public.cancel_batch(p_batch_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_b public.production_batches;
begin
  perform public.require_role(null);
  perform public._plan_lock();
  select * into v_b from public.production_batches where id = p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_b.status = 'cancelled' then return jsonb_build_object('batch_id', v_b.id, 'status', 'cancelled', 'changed', false); end if;
  if v_b.status <> 'planning' then raise exception 'BATCH_LOCKED'; end if;
  delete from public.batch_items where batch_id = p_batch_id;
  update public.production_batches set status = 'cancelled' where id = p_batch_id;
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'cancelled', 'changed', true);
end $$;

-- ปรับแผนด้วยมือ (เฉพาะรอบที่ยังไม่เริ่ม): ย้ายบางส่วน/ทั้งหมดไปรอบอื่น หรือถอดออกจากแผน (p_target_batch_id = null)
create or replace function public.move_batch_allocation(p_batch_item_id uuid, p_target_batch_id uuid, p_qty integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bi public.batch_items; v_src public.production_batches; v_dst public.production_batches; v_prod text; v_mix boolean;
begin
  perform public.require_role(null);
  perform public._plan_lock();
  select * into v_bi from public.batch_items where id = p_batch_item_id for update;
  if not found then raise exception 'ALLOCATION_NOT_FOUND'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > v_bi.quantity then raise exception 'INVALID_QUANTITY'; end if;
  select * into v_src from public.production_batches where id = v_bi.batch_id for update;
  if v_src.status <> 'planning' then raise exception 'BATCH_LOCKED'; end if;
  if p_target_batch_id is not null then
    if p_target_batch_id = v_src.id then raise exception 'INVALID_TARGET'; end if;
    select * into v_dst from public.production_batches where id = p_target_batch_id for update;
    if not found then raise exception 'BATCH_NOT_FOUND'; end if;
    if v_dst.status <> 'planning' then raise exception 'BATCH_LOCKED'; end if;
    select mix_flavors into v_mix from public.production_settings;
    if not v_mix then
      select product_name into v_prod from public.item_preparations where id = v_bi.item_preparation_id;
      if exists (select 1 from public.batch_items bi join public.item_preparations ip on ip.id = bi.item_preparation_id
                  where bi.batch_id = v_dst.id and ip.product_name <> v_prod) then
        raise exception 'MIXED_FLAVORS_NOT_ALLOWED';
      end if;
    end if;
  end if;
  if p_qty = v_bi.quantity then
    delete from public.batch_items where id = v_bi.id;
  else
    update public.batch_items set quantity = quantity - p_qty where id = v_bi.id;
  end if;
  if p_target_batch_id is not null then
    insert into public.batch_items(batch_id, item_preparation_id, quantity)
    values (p_target_batch_id, v_bi.item_preparation_id, p_qty)
    on conflict (batch_id, item_preparation_id) do update set quantity = public.batch_items.quantity + excluded.quantity;
  end if;
  return jsonb_build_object('moved', p_qty, 'to', p_target_batch_id);
end $$;

-- ---------------------------------------------------------------------
-- 7) ภาพรวมสำหรับ Dashboard (ครั้งเดียวจบ ขนาดเล็ก)
-- ---------------------------------------------------------------------
create or replace function public.get_production_snapshot() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := public.bkk_today();
  v_settings jsonb; v_queues jsonb; v_cake jsonb; v_drink jsonb; v_batches jsonb; v_plan jsonb; v_counts jsonb;
  v_missing integer;
begin
  perform public.require_role(null);
  select to_jsonb(s) - 'id' - 'updated_at' into v_settings from public.production_settings s;

  select coalesce(jsonb_agg(x order by (x->>'sort_group')::int, (x->>'business_date'), (x->>'queue_no')::int), '[]'::jsonb) into v_queues
  from (
    select jsonb_build_object(
      'queue_id', q.id, 'order_id', q.order_id, 'order_no', o.order_no, 'queue_no', q.queue_no,
      'business_date', q.business_date, 'status', q.status, 'version', q.version,
      'created_at', q.created_at, 'ready_at', q.ready_at, 'completed_at', q.completed_at,
      'sort_group', case when q.status in ('queued','preparing','ready') then 0 else 1 end,
      'cake_status', public._station_status(q.id, 'cake'),
      'drink_status', public._station_status(q.id, 'drink'),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', ip.id, 'station', ip.station, 'name', ip.product_name, 'quantity', ip.quantity,
                  'ready_quantity', ip.ready_quantity, 'status', ip.status,
                  'addons', (select coalesce(jsonb_agg(a->>'name'), '[]'::jsonb) from jsonb_array_elements(oi.addons) a),
                  'batches', (select coalesce(jsonb_agg(jsonb_build_object('batch_no', b.batch_no, 'status', b.status, 'quantity', bi.quantity)
                                                        order by b.batch_no), '[]'::jsonb)
                                from public.batch_items bi join public.production_batches b on b.id = bi.batch_id
                               where bi.item_preparation_id = ip.id and b.status in ('planning','baking','completed'))
                ) order by ip.station, ip.created_at, ip.id), '[]'::jsonb)
                from public.item_preparations ip join public.order_items oi on oi.id = ip.order_item_id
               where ip.queue_id = q.id and ip.status <> 'cancelled')
    ) as x
    from public.order_queues q join public.orders o on o.id = q.order_id
   where (q.status in ('queued','preparing','ready') and q.business_date >= v_today - 2)
      or (q.business_date = v_today and q.status = 'completed' and q.completed_at > now() - interval '3 hours')
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'name', product_name, 'waiting', waiting, 'in_progress', in_progress)
                            order by product_name), '[]'::jsonb) into v_cake
  from (
    select ip.product_id, ip.product_name,
           sum(ip.quantity - ip.ready_quantity - coalesce(bk.qty, 0))::int as waiting,
           sum(coalesce(bk.qty, 0))::int as in_progress
      from public.item_preparations ip join public.order_queues q on q.id = ip.queue_id
      left join lateral (select sum(bi.quantity) qty from public.batch_items bi join public.production_batches b on b.id = bi.batch_id
                          where bi.item_preparation_id = ip.id and b.status = 'baking') bk on true
     where ip.station = 'cake' and ip.status <> 'cancelled' and q.status in ('queued','preparing')
     group by ip.product_id, ip.product_name
    having sum(ip.quantity - ip.ready_quantity) > 0
  ) c;

  select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'name', product_name, 'waiting', waiting, 'in_progress', in_progress)
                            order by product_name), '[]'::jsonb) into v_drink
  from (
    select ip.product_id, ip.product_name,
           sum(case when ip.status = 'queued' then ip.quantity else 0 end)::int as waiting,
           sum(case when ip.status = 'preparing' then ip.quantity else 0 end)::int as in_progress
      from public.item_preparations ip join public.order_queues q on q.id = ip.queue_id
     where ip.station = 'drink' and ip.status in ('queued','preparing') and q.status in ('queued','preparing')
     group by ip.product_id, ip.product_name
  ) d;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'batch_no', b.batch_no, 'status', b.status, 'capacity', b.capacity,
      'started_at', b.started_at,
      'load', (select coalesce(sum(bi.quantity), 0) from public.batch_items bi where bi.batch_id = b.id),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', bi.id, 'prep_id', ip.id, 'order_id', ip.order_id, 'queue_no', q.queue_no,
                  'product_name', ip.product_name, 'quantity', bi.quantity) order by q.queue_no, ip.created_at), '[]'::jsonb)
                  from public.batch_items bi join public.item_preparations ip on ip.id = bi.item_preparation_id
                  join public.order_queues q on q.id = ip.queue_id where bi.batch_id = b.id)
    ) order by b.batch_no), '[]'::jsonb) into v_batches
  from public.production_batches b where b.business_date = v_today and b.status in ('planning','baking');

  v_plan := public._cake_plan();

  select jsonb_build_object(
    'active_queues', count(*) filter (where status in ('queued','preparing','ready')),
    'ready_for_pickup', count(*) filter (where status = 'ready'),
    'preparing', count(*) filter (where status = 'preparing'),
    'queued', count(*) filter (where status = 'queued')
  ) into v_counts from public.order_queues where status in ('queued','preparing','ready') and business_date >= v_today - 2;

  select count(*) into v_missing from public.orders o
   where o.business_date = v_today and o.payment_status <> 'refunded'
     and exists (select 1 from public.payments p where p.order_id = o.id)
     and not exists (select 1 from public.order_queues q where q.order_id = o.id);

  return jsonb_build_object(
    'server_time', now(), 'business_date', v_today, 'settings', v_settings,
    'queues', v_queues, 'cake_totals', v_cake, 'drink_totals', v_drink, 'batches', v_batches,
    'plan', jsonb_build_object('batches', v_plan, 'signature', md5(v_plan::text)),
    'counts', v_counts, 'missing_queues', v_missing);
end $$;

-- ภาระงานเค้กแบบเบา สำหรับหน้า POS (เตือนแคชเชียร์ว่ารอบอบเต็ม) — เป็นตัวชี้วัดการวางแผนการผลิต ไม่ใช่สต็อก
create or replace function public.get_cake_load() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ps public.production_settings; v_queued integer; v_baking integer; v_started timestamptz; v_active integer; v_by jsonb;
begin
  perform public.require_role(null);
  select * into v_ps from public.production_settings;
  select coalesce(sum(ip.quantity - ip.ready_quantity - coalesce(bk.qty, 0)), 0)::integer into v_queued
    from public.item_preparations ip join public.order_queues q on q.id = ip.queue_id
    left join lateral (select sum(bi.quantity) qty from public.batch_items bi join public.production_batches b on b.id = bi.batch_id
                        where bi.item_preparation_id = ip.id and b.status = 'baking') bk on true
   where ip.station = 'cake' and ip.status <> 'cancelled' and q.status in ('queued','preparing')
     and q.business_date >= public.bkk_today() - 2;
  select coalesce(sum(bi.quantity), 0)::integer, min(b.started_at) into v_baking, v_started
    from public.batch_items bi join public.production_batches b on b.id = bi.batch_id
   where b.status = 'baking' and b.business_date = public.bkk_today();
  select count(*)::integer into v_active from public.order_queues
   where status in ('queued','preparing','ready') and business_date >= public.bkk_today() - 2;
  select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'waiting', x.waiting, 'in_progress', x.in_progress) order by x.name), '[]'::jsonb)
    into v_by
    from (
      select ip.product_name as name,
             sum(ip.quantity - ip.ready_quantity - coalesce(bk.qty, 0))::integer as waiting,
             sum(coalesce(bk.qty, 0))::integer as in_progress
        from public.item_preparations ip join public.order_queues q on q.id = ip.queue_id
        left join lateral (select sum(bi.quantity) qty from public.batch_items bi join public.production_batches b on b.id = bi.batch_id
                            where bi.item_preparation_id = ip.id and b.status = 'baking') bk on true
       where ip.station = 'cake' and ip.status <> 'cancelled' and q.status in ('queued','preparing')
         and q.business_date >= public.bkk_today() - 2
       group by ip.product_name having sum(ip.quantity - ip.ready_quantity) > 0
    ) x;
  return jsonb_build_object('capacity', v_ps.batch_capacity, 'bake_minutes', v_ps.bake_minutes,
    'queued_pieces', v_queued, 'baking_pieces', v_baking, 'baking_started_at', v_started, 'active_queues', v_active,
    'by_product', v_by);
end $$;

-- ---------------------------------------------------------------------
-- 8) หน้าลูกค้า: ฟังก์ชันเดียวที่ anon เรียกได้ — คืนเฉพาะออเดอร์ของ token นั้น
--    ไม่คืน: id ภายใน, พนักงาน/กะ, การชำระเงิน, ยอดเงิน, ข้อมูลติดต่อ, โน้ตภายใน, สต็อก, ออเดอร์อื่น
-- ---------------------------------------------------------------------
create or replace function public.get_public_queue(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_q public.order_queues; v_ps public.production_settings; v_ahead integer; v_items jsonb;
  v_cake text; v_drink text; v_est integer; v_shop text;
  v_unbaked_ahead integer; v_own_unbaked integer; v_k integer; v_remaining numeric; v_bk public.production_batches;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into v_ps from public.production_settings;
  select * into v_q from public.order_queues
   where public_token = p_token and created_at > now() - make_interval(hours => v_ps.queue_link_hours);
  if not found then
    return null;
  end if;

  select count(*) into v_ahead from public.order_queues
   where business_date = v_q.business_date and queue_no < v_q.queue_no and status in ('queued','preparing');

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', ip.product_name, 'quantity', ip.quantity, 'station', ip.station,
           'addons', (select coalesce(jsonb_agg(a->>'name'), '[]'::jsonb) from jsonb_array_elements(oi.addons) a))
         order by ip.station, ip.created_at, ip.id), '[]'::jsonb) into v_items
    from public.item_preparations ip join public.order_items oi on oi.id = ip.order_item_id
   where ip.queue_id = v_q.id and ip.status <> 'cancelled';

  v_cake := public._station_status(v_q.id, 'cake');
  v_drink := public._station_status(v_q.id, 'drink');

  -- เวลารอโดยประมาณ: คำนวณได้เฉพาะเมื่อร้านตั้งเวลาอบ และยังมีเค้กรออบ
  v_est := null;
  if v_ps.bake_minutes is not null and v_q.status in ('queued','preparing') and v_cake in ('queued','preparing') then
    select coalesce(sum(ip.quantity - ip.ready_quantity), 0) into v_own_unbaked
      from public.item_preparations ip where ip.queue_id = v_q.id and ip.station = 'cake' and ip.status <> 'cancelled';
    select coalesce(sum(ip.quantity - ip.ready_quantity - coalesce(bk.qty, 0)), 0) into v_unbaked_ahead
      from public.item_preparations ip join public.order_queues q2 on q2.id = ip.queue_id
      left join lateral (select sum(bi.quantity) qty from public.batch_items bi join public.production_batches b on b.id = bi.batch_id
                          where bi.item_preparation_id = ip.id and b.status = 'baking') bk on true
     where ip.station = 'cake' and ip.status <> 'cancelled' and q2.status in ('queued','preparing')
       and q2.business_date = v_q.business_date and q2.queue_no < v_q.queue_no;
    select * into v_bk from public.production_batches
     where status = 'baking' and business_date = v_q.business_date order by started_at limit 1;
    -- ชิ้นของเราอยู่ในรอบที่กำลังอบหรือไม่
    if exists (select 1 from public.batch_items bi join public.production_batches b on b.id = bi.batch_id
                join public.item_preparations ip on ip.id = bi.item_preparation_id
               where ip.queue_id = v_q.id and b.status = 'baking') then
      select b.* into v_bk from public.production_batches b join public.batch_items bi on bi.batch_id = b.id
        join public.item_preparations ip on ip.id = bi.item_preparation_id
       where ip.queue_id = v_q.id and b.status = 'baking' order by b.started_at limit 1;
      v_remaining := greatest(0, v_ps.bake_minutes - extract(epoch from (now() - v_bk.started_at)) / 60.0);
      v_est := ceil(v_remaining)::integer;
    else
      v_k := greatest(1, ceil((v_unbaked_ahead + v_own_unbaked)::numeric / v_ps.batch_capacity)::integer);
      v_remaining := case when v_bk.id is null then 0
                          else greatest(0, v_ps.bake_minutes - extract(epoch from (now() - v_bk.started_at)) / 60.0) end;
      v_est := ceil(v_remaining + v_k * v_ps.bake_minutes)::integer;
    end if;
  end if;

  select shop_name into v_shop from public.settings;
  return jsonb_build_object(
    'queue_no', v_q.queue_no, 'status', v_q.status, 'ahead', v_ahead,
    'cake_status', v_cake, 'drink_status', v_drink, 'items', v_items,
    'estimated_wait_minutes', v_est, 'shop_name', v_shop,
    'created_at', v_q.created_at, 'updated_at', v_q.updated_at);
end $$;

-- ---------------------------------------------------------------------
-- 9) RLS + สิทธิ์
-- ---------------------------------------------------------------------
alter table public.production_settings enable row level security;
alter table public.category_stations   enable row level security;
alter table public.product_stations    enable row level security;
alter table public.queue_counters      enable row level security;
alter table public.order_queues        enable row level security;
alter table public.item_preparations   enable row level security;
alter table public.production_batches  enable row level security;
alter table public.batch_items         enable row level security;

create policy production_settings_select on public.production_settings for select to authenticated
  using (public.auth_employee_id() is not null);
create policy production_settings_update on public.production_settings for update to authenticated
  using (public.has_role(array['owner','manager'])) with check (public.has_role(array['owner','manager']));

create policy category_stations_select on public.category_stations for select to authenticated
  using (public.auth_employee_id() is not null);
create policy category_stations_write on public.category_stations for all to authenticated
  using (public.has_role(array['owner','manager'])) with check (public.has_role(array['owner','manager']));
create policy product_stations_select on public.product_stations for select to authenticated
  using (public.auth_employee_id() is not null);
create policy product_stations_write on public.product_stations for all to authenticated
  using (public.has_role(array['owner','manager'])) with check (public.has_role(array['owner','manager']));

-- queue_counters: ไม่มี policy = ไม่มีใครเข้าถึงตรง
create policy order_queues_select on public.order_queues for select to authenticated
  using (
    public.has_role(array['owner','manager'])
    or (public.auth_employee_id() is not null
        and (business_date = public.bkk_today() or status in ('queued','preparing','ready')))
  );
create policy item_preparations_select on public.item_preparations for select to authenticated
  using (exists (select 1 from public.order_queues q where q.id = item_preparations.queue_id));
create policy production_batches_select on public.production_batches for select to authenticated
  using (
    public.has_role(array['owner','manager'])
    or (public.auth_employee_id() is not null
        and (business_date = public.bkk_today() or status in ('planning','baking')))
  );
create policy batch_items_select on public.batch_items for select to authenticated
  using (exists (select 1 from public.production_batches b where b.id = batch_items.batch_id));

-- ห้ามเขียนตรง (แม้ผ่าน RLS) — เขียนผ่านฟังก์ชันเท่านั้น; anon ไม่มีสิทธิ์ใดๆ กับตารางใหม่
revoke all on public.production_settings, public.category_stations, public.product_stations,
              public.queue_counters, public.order_queues, public.item_preparations,
              public.production_batches, public.batch_items from anon;
revoke insert, update, delete, truncate on public.order_queues, public.item_preparations,
              public.production_batches, public.batch_items, public.queue_counters from authenticated;
revoke all on public.queue_counters from authenticated;
revoke insert, delete, truncate on public.production_settings from authenticated;
revoke update on public.production_settings from authenticated;
grant update (batch_capacity, mix_flavors, bake_minutes, default_station, queue_link_hours)
  on public.production_settings to authenticated;
revoke truncate on public.category_stations, public.product_stations from authenticated;

-- ฟังก์ชัน: ปิดทุกอย่างก่อน แล้วเปิดเฉพาะที่จำเป็น
revoke execute on function
  public.resolve_station(uuid, text), public._station_status(uuid, text), public._recompute_queue(uuid),
  public._create_queue(uuid), public._cancel_queue(uuid), public._complete_queue(uuid, uuid, text),
  public._queue_json(public.order_queues, boolean), public._lock_queue(uuid), public._cake_demand(),
  public._cake_plan(), public._plan_lock(), public._touch_queues_of_batch(uuid),
  public.payments_create_queue(), public.orders_refund_cancels_queue(), public.orders_prep_status_syncs_queue(),
  public.item_preparations_consistency(), public.batch_items_guard()
  from public, anon, authenticated;

revoke execute on function
  public.ensure_order_queue(uuid), public.repair_missing_queues(),
  public.set_station_status(uuid, text, text, integer), public.complete_handover(uuid, integer, boolean),
  public.reopen_handover(uuid, integer), public.get_cake_plan(), public.confirm_cake_plan(text),
  public.start_batch(uuid), public.complete_batch(uuid), public.cancel_batch(uuid),
  public.move_batch_allocation(uuid, uuid, integer), public.get_production_snapshot(), public.get_cake_load(),
  public.get_public_queue(text)
  from public, anon;

grant execute on function
  public.ensure_order_queue(uuid), public.repair_missing_queues(),
  public.set_station_status(uuid, text, text, integer), public.complete_handover(uuid, integer, boolean),
  public.reopen_handover(uuid, integer), public.get_cake_plan(), public.confirm_cake_plan(text),
  public.start_batch(uuid), public.complete_batch(uuid), public.cancel_batch(uuid),
  public.move_batch_allocation(uuid, uuid, integer), public.get_production_snapshot(), public.get_cake_load()
  to authenticated;

-- หน้าลูกค้า (ฝั่งเซิร์ฟเวอร์ของแอปเรียกด้วย anon key): ฟังก์ชันนี้ฟังก์ชันเดียว
grant execute on function public.get_public_queue(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 10) Realtime (เฉพาะบน Supabase ที่มี publication; ผู้รับต้องผ่าน RLS ของตารางเอง)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['order_queues','item_preparations','production_batches','batch_items'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;
