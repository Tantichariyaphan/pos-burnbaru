-- =====================================================================
-- 0005: BURN BARU CLUB — ระบบสมาชิก (additive เท่านั้น: ไม่แก้/ลบตารางหรือฟังก์ชันของ 0001–0004)
--
-- หลักการ
--   * POS เป็น source of truth ของออเดอร์/เงิน — สมาชิกคือ "ส่วนต่อขยาย" ของ customers (1:1) ไม่ใช่ identity ใหม่
--   * แต้ม/แสตมป์เป็น ledger แบบ append-only (ห้ามแก้/ลบ) ยอดคงเหลือเก็บใน member_profiles และแก้ได้ผ่าน _ledger_post เท่านั้น
--   * การให้แต้ม/แสตมป์/อัปเดต Tier เกิดจาก trigger หลังบันทึกการชำระเงิน — ครอบ exception แล้ว "การขายต้องไม่ล้ม"
--     (มี membership_reconcile() ซ่อมออเดอร์ที่พลาด)
--   * ลูกค้า (LINE/LIFF) ไม่มีบัญชีฐานข้อมูล: เซิร์ฟเวอร์ Next.js ตรวจ LINE ID token แล้วเรียกฟังก์ชัน liff_* ด้วย service_role
--     ฟังก์ชันกลุ่มนี้ revoke จาก anon/authenticated ทั้งหมด
--   * ตัวเลขกติกาที่เจ้าของยังไม่อนุมัติ (อัตราแต้ม, เกณฑ์ Tier) เป็น NULL → ระบบไม่ให้แต้ม/ไม่เลื่อน Tier จนกว่าจะตั้งค่า
-- =====================================================================

create sequence public.member_no_seq;

-- ---------------------------------------------------------------------
-- 1) Tier
-- ---------------------------------------------------------------------
create table public.membership_tiers (
  id                       uuid primary key default gen_random_uuid(),
  code                     text not null unique check (code ~ '^[A-Z0-9_]{2,30}$'),
  name                     text not null check (length(btrim(name)) > 0),
  sort_order               integer not null unique check (sort_order > 0),
  -- ยอดซื้อสุทธิย้อนหลัง (สตางค์) ที่ต้องถึงเพื่อได้ Tier นี้; NULL = ยังไม่ได้กำหนด (เลื่อนอัตโนมัติไม่ได้)
  min_rolling_spend_satang bigint check (min_rolling_spend_satang is null or min_rolling_spend_satang >= 0),
  benefits                 jsonb not null default '[]'::jsonb check (jsonb_typeof(benefits) = 'array'),
  active                   boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger membership_tiers_touch before update on public.membership_tiers
  for each row execute function public.touch_updated_at();

-- ชื่อ Tier ตามแบรนด์; Tier แรก (FIRST BITE) = ระดับเริ่มต้นของสมาชิกใหม่ จึงตั้งเกณฑ์ 0 ได้ตามนิยาม
-- เกณฑ์ของ SIGNATURE / THE BURN CLUB ยังไม่ได้อนุมัติ → NULL (ห้ามกำหนดเอง)
insert into public.membership_tiers (code, name, sort_order, min_rolling_spend_satang) values
  ('FIRST_BITE',    'FIRST BITE',    1, 0),
  ('SIGNATURE',     'SIGNATURE',     2, null),
  ('THE_BURN_CLUB', 'THE BURN CLUB', 3, null);

-- ---------------------------------------------------------------------
-- 2) แม่แบบคูปอง/รางวัล + คูปองของสมาชิก
-- ---------------------------------------------------------------------
create table public.coupon_templates (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (length(btrim(title)) > 0),
  description      text,
  source           text not null default 'reward'
                     check (source in ('reward','birthday','holiday','promotion','welcome','manual')),
  -- ผูกกับตาราง discounts เดิม (percent/fixed) เพื่อใช้ส่วนลดที่ checkout_order คำนวณอยู่แล้ว; NULL = สิทธิ์ที่พนักงานมอบเอง (เช่น เครื่องดื่มฟรี)
  discount_id      uuid references public.discounts(id) on delete restrict,
  point_cost       integer check (point_cost is null or point_cost > 0),   -- NULL = แลกด้วยแต้มไม่ได้
  min_tier_id      uuid references public.membership_tiers(id) on delete restrict,
  min_spend_satang integer check (min_spend_satang is null or min_spend_satang > 0),
  claim_start_at   timestamptz,
  claim_end_at     timestamptz,
  expire_days      integer check (expire_days is null or expire_days > 0),
  expire_at        timestamptz,
  quantity_limit   integer check (quantity_limit is null or quantity_limit > 0),
  active           boolean not null default true,
  created_by       uuid references public.employees(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (expire_days is not null or expire_at is not null),               -- ต้องมีกติกาวันหมดอายุเสมอ
  check (claim_end_at is null or claim_start_at is null or claim_end_at > claim_start_at)
);
create trigger coupon_templates_touch before update on public.coupon_templates
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3) ตั้งค่า loyalty (แถวเดียว) — ค่าที่เจ้าของยังไม่อนุมัติเป็น NULL/ปิดไว้
-- ---------------------------------------------------------------------
create table public.loyalty_settings (
  id                          boolean primary key default true check (id),
  membership_enabled          boolean not null default false,   -- สวิตช์หลัก: ปิดอยู่ = ไม่ให้แต้ม/แสตมป์/Tier
  points_enabled              boolean not null default false,
  satang_per_point            integer check (satang_per_point is null or satang_per_point > 0),  -- ซื้อทุก N สตางค์ = 1 แต้ม (NULL = ยังไม่กำหนด)
  earn_basis                  text not null default 'net_after_discount'
                                check (earn_basis in ('net_after_discount','gross_before_discount')),
  tier_rolling_months         integer not null default 12 check (tier_rolling_months between 1 and 60),
  tier_downgrade_enabled      boolean not null default false,   -- ปิด = Tier ไม่ลดอัตโนมัติ (รอเจ้าของกำหนดนโยบาย)
  stamps_enabled              boolean not null default false,   -- แสตมป์เดิมของ LINE OA (เครื่องดื่ม 1 แก้ว = 1 ดวง)
  stamps_per_reward           integer not null default 10 check (stamps_per_reward between 1 and 1000),
  stamp_station               text not null default 'drink' check (stamp_station in ('cake','drink')),
  stamp_reward_title          text not null default 'เครื่องดื่มฟรี 1 แก้ว',
  stamp_reward_expire_days    integer not null default 90 check (stamp_reward_expire_days > 0),
  welcome_coupon_template_id  uuid references public.coupon_templates(id) on delete set null,
  birthday_coupon_template_id uuid references public.coupon_templates(id) on delete set null,
  claim_qr_minutes            integer not null default 15 check (claim_qr_minutes between 1 and 1440),
  claim_order_window_hours    integer not null default 24 check (claim_order_window_hours between 1 and 720),
  comeback_days               integer check (comeback_days is null or comeback_days > 0),   -- NULL = ปิดแคมเปญ Come Back
  marketing_cap_days          integer not null default 7 check (marketing_cap_days >= 0),   -- ข้อความการตลาดต่อคน: อย่างน้อยห่างกันกี่วัน
  updated_at                  timestamptz not null default now()
);
create trigger loyalty_settings_touch before update on public.loyalty_settings
  for each row execute function public.touch_updated_at();
insert into public.loyalty_settings default values;

-- ---------------------------------------------------------------------
-- 4) โปรไฟล์สมาชิก (ต่อยอด customers 1:1) + การผูก LINE
-- ---------------------------------------------------------------------
create table public.member_profiles (
  customer_id         uuid primary key references public.customers(id) on delete restrict,
  member_no           text not null unique,
  qr_ref              text not null unique default replace(gen_random_uuid()::text, '-', ''),  -- ตัวอ้างอิงทึบของ Member QR (หมุนค่าเพื่อเพิกถอน)
  phone_norm          text unique check (phone_norm is null or phone_norm ~ '^0[0-9]{8,9}$'),
  phone_verified_at   timestamptz,                -- ยืนยันที่เคาน์เตอร์โดยพนักงาน (ยังไม่มี OTP)
  birthday            date,
  joined_at           timestamptz not null default now(),
  joined_via          text not null check (joined_via in ('pos','liff','claim','import')),
  privacy_accepted_at timestamptz,
  marketing_consent   boolean not null default false,
  marketing_consent_at timestamptz,
  tier_id             uuid references public.membership_tiers(id) on delete restrict,
  points_balance      integer not null default 0 check (points_balance >= 0),
  stamps_balance      integer not null default 0 check (stamps_balance >= 0),
  stamps_lifetime     integer not null default 0 check (stamps_lifetime >= 0),
  last_purchase_at    timestamptz,
  legacy_member_uid   text unique,                -- member_uid เดิมจาก LINE OA (ใช้ตอนนำเข้าเท่านั้น)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger member_profiles_touch before update on public.member_profiles
  for each row execute function public.touch_updated_at();

create table public.customer_line_links (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id) on delete restrict,
  line_user_id  text not null check (length(line_user_id) between 5 and 64),
  display_name  text,                             -- ห้ามใช้เป็นหลักฐานยืนยันตัวบุคคล
  picture_url   text,
  linked_at     timestamptz not null default now(),
  unlinked_at   timestamptz,
  unlink_reason text
);
-- LINE หนึ่งบัญชีผูกได้กับลูกค้าหนึ่งคน (ที่ยังผูกอยู่) และลูกค้าหนึ่งคนมี LINE ที่ผูกอยู่ได้หนึ่งบัญชี; ประวัติเก่าเก็บไว้
create unique index customer_line_links_active_line on public.customer_line_links(line_user_id) where unlinked_at is null;
create unique index customer_line_links_active_cust on public.customer_line_links(customer_id)  where unlinked_at is null;
create index customer_line_links_cust_idx on public.customer_line_links(customer_id);

-- ---------------------------------------------------------------------
-- 5) Ledger แต้ม/แสตมป์ (append-only) + เชื่อมออเดอร์ที่ประมวลผลแล้ว
-- ---------------------------------------------------------------------
create table public.member_ledger (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id) on delete restrict,
  currency        text not null check (currency in ('points','stamps')),
  kind            text not null check (kind in ('EARN','REDEEM','REFUND_REVERSAL','EXPIRE','ADMIN_ADJUSTMENT','CAMPAIGN_BONUS')),
  amount          integer not null check (amount <> 0),
  balance_after   integer not null check (balance_after >= 0),
  order_id        uuid references public.orders(id) on delete restrict,
  refund_id       uuid references public.refunds(id) on delete restrict,
  coupon_id       uuid,
  idempotency_key text not null unique,
  note            text,
  created_by      uuid references public.employees(id) on delete set null,
  created_at      timestamptz not null default now(),
  check ((kind in ('EARN','CAMPAIGN_BONUS') and amount > 0) or (kind in ('REDEEM','REFUND_REVERSAL','EXPIRE') and amount < 0) or kind = 'ADMIN_ADJUSTMENT')
);
create index member_ledger_cust_idx on public.member_ledger(customer_id, currency, created_at desc);
create unique index member_ledger_one_earn_per_order on public.member_ledger(order_id, currency) where kind = 'EARN' and order_id is not null;
create unique index member_ledger_one_reversal_per_refund on public.member_ledger(refund_id, currency) where kind = 'REFUND_REVERSAL';
create trigger member_ledger_immutable before update or delete on public.member_ledger
  for each row execute function public.forbid_modify();

-- ออเดอร์ที่ประมวลผลเป็นของสมาชิกแล้ว (กันให้ซ้ำ + ใช้คิดยอดสะสม/ประวัติ/Signature Collector)
-- หมายเหตุ: orders.customer_id แก้ไม่ได้หลังสร้าง จึงใช้ตารางนี้เป็นตัวผูก "การรับแต้มย้อนหลังด้วย Claim QR" ด้วย
create table public.member_order_links (
  order_id      uuid primary key references public.orders(id) on delete restrict,
  customer_id   uuid not null references public.customers(id) on delete restrict,
  via           text not null check (via in ('checkout','claim','reconcile')),
  basis_satang  integer not null check (basis_satang > 0),
  points_earned integer not null default 0 check (points_earned >= 0),
  stamps_earned integer not null default 0 check (stamps_earned >= 0),
  processed_at  timestamptz not null default now()
);
create index member_order_links_cust_idx on public.member_order_links(customer_id, processed_at desc);
create trigger member_order_links_immutable before update or delete on public.member_order_links
  for each row execute function public.forbid_modify();

-- ---------------------------------------------------------------------
-- 6) Timeline (Burn Journey) + ประวัติ Tier
-- ---------------------------------------------------------------------
create table public.member_events (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  kind        text not null,
  dedupe_key  text not null,
  detail      jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (customer_id, kind, dedupe_key)
);
create index member_events_cust_idx on public.member_events(customer_id, occurred_at desc);
create trigger member_events_immutable before update or delete on public.member_events
  for each row execute function public.forbid_modify();

create table public.member_tier_history (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid not null references public.customers(id) on delete restrict,
  from_tier_id        uuid references public.membership_tiers(id) on delete restrict,
  to_tier_id          uuid not null references public.membership_tiers(id) on delete restrict,
  rolling_spend_satang bigint not null,
  reason              text not null,
  order_id            uuid references public.orders(id) on delete restrict,
  created_at          timestamptz not null default now()
);
create index member_tier_history_cust_idx on public.member_tier_history(customer_id, created_at desc);
create trigger member_tier_history_immutable before update or delete on public.member_tier_history
  for each row execute function public.forbid_modify();

-- ---------------------------------------------------------------------
-- 7) คูปองของสมาชิก (ความเป็นเจ้าของ) — คัดลอกข้อมูลจาก template ตอนออก ไม่อ้างอิงแบบไดนามิก
-- ---------------------------------------------------------------------
create table public.member_coupons (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[A-Z0-9]{12}$'),
  customer_id   uuid not null references public.customers(id) on delete restrict,
  template_id   uuid references public.coupon_templates(id) on delete set null,
  source        text not null check (source in ('reward','birthday','holiday','promotion','welcome','manual')),
  title         text not null,
  description   text,
  discount_id   uuid references public.discounts(id) on delete restrict,
  status        text not null default 'unused' check (status in ('unused','used','expired','cancelled')),
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_by       uuid references public.employees(id) on delete set null,
  used_order_id uuid references public.orders(id) on delete restrict,
  note          text,
  dedupe_key    text,
  created_at    timestamptz not null default now(),
  check (status <> 'used' or used_at is not null),   -- used_by ว่างได้เฉพาะคูปองที่นำเข้าจากระบบเดิม; ฟังก์ชันใช้คูปองใหม่ใส่ทุกครั้ง
  unique (customer_id, dedupe_key)
);
create index member_coupons_cust_idx on public.member_coupons(customer_id, status, expires_at);
create index member_coupons_template_idx on public.member_coupons(template_id);

create or replace function public.member_coupons_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE_RECORD: DELETE on member_coupons is not allowed';
  end if;
  if (new.id, new.code, new.customer_id, new.template_id, new.source, new.title, new.description,
      new.discount_id, new.issued_at, new.expires_at, new.dedupe_key, new.created_at)
     is distinct from
     (old.id, old.code, old.customer_id, old.template_id, old.source, old.title, old.description,
      old.discount_id, old.issued_at, old.expires_at, old.dedupe_key, old.created_at) then
    raise exception 'IMMUTABLE_RECORD: coupon content cannot change';
  end if;
  if old.status <> 'unused' and
     (new.status, new.used_at, new.used_by, new.used_order_id) is distinct from
     (old.status, old.used_at, old.used_by, old.used_order_id) then
    raise exception 'COUPON_STATUS_FINAL';
  end if;
  return new;
end $$;
create trigger member_coupons_guard_trg before update or delete on public.member_coupons
  for each row execute function public.member_coupons_guard();

-- ---------------------------------------------------------------------
-- 8) Claim QR (สมัคร/ผูก LINE/รับแต้มย้อนหลัง) — เก็บเฉพาะ hash ของ token, ใช้ได้ครั้งเดียว, หมดอายุ
-- ---------------------------------------------------------------------
create table public.membership_claims (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  purpose       text not null check (purpose in ('join','link','claim')),
  customer_id   uuid references public.customers(id) on delete restrict,
  order_id      uuid references public.orders(id) on delete restrict,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_by_line  text,
  created_by    uuid references public.employees(id) on delete set null,
  created_at    timestamptz not null default now(),
  check ((purpose = 'join'  and customer_id is null and order_id is null)
      or (purpose = 'link'  and customer_id is not null and order_id is null)
      or (purpose = 'claim' and order_id is not null and customer_id is null))
);
create index membership_claims_order_idx on public.membership_claims(order_id) where order_id is not null;

-- ---------------------------------------------------------------------
-- 9) Outbox การแจ้งเตือน LINE (แยก transactional / marketing; มี dedupe, retry, สถานะส่ง)
-- ---------------------------------------------------------------------
create table public.notification_outbox (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id) on delete restrict,
  category        text not null check (category in ('transactional','marketing')),
  event_type      text not null,
  dedupe_key      text not null unique,
  payload         jsonb not null default '{}'::jsonb,    -- ห้ามใส่ token/ข้อมูลลับ
  status          text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
  skip_reason     text,
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index notification_outbox_due_idx on public.notification_outbox(next_attempt_at) where status = 'pending';
create index notification_outbox_cust_idx on public.notification_outbox(customer_id, created_at desc);
create trigger notification_outbox_touch before update on public.notification_outbox
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 10) คีย์เวิร์ดแชตบอต (ย้ายแนวคิดจาก LINE OA เดิม: ตอบจากตาราง ไม่ใช้ AI)
-- ---------------------------------------------------------------------
create table public.chat_keywords (
  id            uuid primary key default gen_random_uuid(),
  keyword       text not null unique check (length(btrim(keyword)) > 0),
  response_text text not null check (length(btrim(response_text)) > 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger chat_keywords_touch before update on public.chat_keywords
  for each row execute function public.touch_updated_at();

create trigger audit_loyalty_settings after insert or update on public.loyalty_settings for each row execute function public.audit_row();
create trigger audit_membership_tiers after insert or update on public.membership_tiers for each row execute function public.audit_row();
create trigger audit_coupon_templates after insert or update on public.coupon_templates for each row execute function public.audit_row();
create trigger audit_member_profiles_ins after insert on public.member_profiles for each row execute function public.audit_row();
-- ไม่บันทึกการเปลี่ยนยอดแต้ม/แสตมป์ลง audit (มี ledger เป็นหลักฐานอยู่แล้ว) — บันทึกเฉพาะการแก้ข้อมูลสมาชิก
create trigger audit_member_profiles_upd after update on public.member_profiles for each row
  when ((old.birthday, old.marketing_consent, old.phone_norm, old.phone_verified_at, old.privacy_accepted_at, old.tier_id)
        is distinct from
        (new.birthday, new.marketing_consent, new.phone_norm, new.phone_verified_at, new.privacy_accepted_at, new.tier_id))
  execute function public.audit_row();
create trigger audit_chat_keywords    after insert or update or delete on public.chat_keywords for each row execute function public.audit_row();

-- =====================================================================
-- ฟังก์ชันภายใน (revoke จากทุก role ด้านล่าง)
-- =====================================================================
create or replace function public._norm_phone(p text) returns text
language sql immutable as $$
  select case
    when d = '' then null
    when d ~ '^66[0-9]{9}$' then '0' || substr(d, 3)
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) s
$$;

create or replace function public._base_tier() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.membership_tiers where active order by sort_order limit 1
$$;

create or replace function public._tier_for_spend(p_spend bigint) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.membership_tiers
      where active and min_rolling_spend_satang is not null and min_rolling_spend_satang <= p_spend
      order by sort_order desc limit 1),
    public._base_tier())
$$;

-- ยอดซื้อสุทธิย้อนหลัง = Σ(ยอดสุทธิของออเดอร์ที่เป็นของสมาชิก − คืนเงิน) ภายใน N เดือน
create or replace function public._rolling_spend(p_customer uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(o.total_satang - coalesce(r.refunded, 0)), 0)::bigint
    from public.member_order_links l
    join public.orders o on o.id = l.order_id
    left join lateral (select sum(amount_satang) as refunded from public.refunds where order_id = o.id) r on true
   where l.customer_id = p_customer
     and o.created_at >= now() - make_interval(months => (select tier_rolling_months from public.loyalty_settings))
$$;

create or replace function public._event(p_customer uuid, p_kind text, p_dedupe text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.member_events(customer_id, kind, dedupe_key, detail)
  values (p_customer, p_kind, p_dedupe, coalesce(p_detail, '{}'::jsonb))
  on conflict (customer_id, kind, dedupe_key) do nothing
$$;

-- เข้าคิวแจ้งเตือน: ไม่มี LINE ที่ผูกอยู่ / ไม่ได้รับความยินยอมการตลาด / ติดเพดานความถี่ → บันทึกเป็น skipped (มีหลักฐาน)
create or replace function public._notify(p_customer uuid, p_category text, p_event text, p_dedupe text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text := 'pending';
  v_reason text;
  v_prof public.member_profiles;
  v_cap integer;
begin
  select * into v_prof from public.member_profiles where customer_id = p_customer;
  if not exists (select 1 from public.customer_line_links where customer_id = p_customer and unlinked_at is null) then
    v_status := 'skipped'; v_reason := 'NO_LINE';
  elsif p_category = 'marketing' then
    if v_prof.customer_id is null or not v_prof.marketing_consent then
      v_status := 'skipped'; v_reason := 'NO_MARKETING_CONSENT';
    else
      select marketing_cap_days into v_cap from public.loyalty_settings;
      if v_cap > 0 and exists (
        select 1 from public.notification_outbox
         where customer_id = p_customer and category = 'marketing' and status in ('pending','sending','sent')
           and created_at > now() - make_interval(days => v_cap)) then
        v_status := 'skipped'; v_reason := 'FREQUENCY_CAP';
      end if;
    end if;
  end if;
  insert into public.notification_outbox(customer_id, category, event_type, dedupe_key, payload, status, skip_reason)
  values (p_customer, p_category, p_event, p_dedupe, coalesce(p_payload, '{}'::jsonb), v_status, v_reason)
  on conflict (dedupe_key) do nothing;
end $$;

-- โพสต์ ledger: ล็อกแถวโปรไฟล์ → ตรวจ idempotency → ตรวจยอดไม่ติดลบ → เขียน ledger + ปรับยอด ใน transaction เดียว
-- คืน id ของแถวใหม่; คืน NULL ถ้า key ซ้ำ (เคยทำแล้ว)
create or replace function public._ledger_post(
  p_customer uuid, p_currency text, p_kind text, p_amount integer, p_key text,
  p_order uuid default null, p_refund uuid default null, p_note text default null,
  p_emp uuid default null, p_coupon uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_prof public.member_profiles;
  v_bal integer;
  v_new integer;
  v_id uuid;
begin
  if p_key is null or length(p_key) = 0 then
    raise exception 'INVALID_INPUT: idempotency key is required';
  end if;
  select * into v_prof from public.member_profiles where customer_id = p_customer for update;
  if not found then
    raise exception 'MEMBER_NOT_FOUND';
  end if;
  if exists (select 1 from public.member_ledger where idempotency_key = p_key) then
    return null;
  end if;
  v_bal := case when p_currency = 'points' then v_prof.points_balance else v_prof.stamps_balance end;
  v_new := v_bal + p_amount;
  if v_new < 0 then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;
  begin
    insert into public.member_ledger(customer_id, currency, kind, amount, balance_after, order_id, refund_id,
                                     coupon_id, idempotency_key, note, created_by)
    values (p_customer, p_currency, p_kind, p_amount, v_new, p_order, p_refund, p_coupon, p_key, p_note, p_emp)
    returning id into v_id;
  exception when unique_violation then
    return null;
  end;
  if p_currency = 'points' then
    update public.member_profiles set points_balance = v_new where customer_id = p_customer;
  else
    update public.member_profiles
       set stamps_balance = v_new,
           stamps_lifetime = stamps_lifetime + case when p_amount > 0 and p_kind in ('EARN','CAMPAIGN_BONUS') then p_amount else 0 end
     where customer_id = p_customer;
  end if;
  return v_id;
end $$;

create or replace function public._member_ensure_profile(p_customer uuid, p_via text, p_phone text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  insert into public.member_profiles(customer_id, member_no, joined_via, tier_id, phone_norm)
  values (p_customer, 'BB-' || lpad(nextval('public.member_no_seq')::text, 5, '0'), p_via,
          public._base_tier(), public._norm_phone(p_phone))
  on conflict (customer_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public._event(p_customer, 'registered', 'registered', jsonb_build_object('via', p_via));
  end if;
  return v_n > 0;
end $$;

-- Tier: เลื่อนขึ้นทันทีเมื่อถึงเกณฑ์; ลดลงเฉพาะเมื่อเจ้าของเปิด tier_downgrade_enabled
create or replace function public._member_recompute_tier(p_customer uuid, p_reason text, p_order uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_prof public.member_profiles;
  v_set public.loyalty_settings;
  v_spend bigint;
  v_target uuid;
  v_cur_sort integer;
  v_tgt_sort integer;
  v_hist uuid;
  v_name text;
begin
  select * into v_set from public.loyalty_settings;
  select * into v_prof from public.member_profiles where customer_id = p_customer for update;
  if not found then return; end if;
  v_spend := public._rolling_spend(p_customer);
  v_target := public._tier_for_spend(v_spend);
  if v_target is not distinct from v_prof.tier_id then return; end if;
  select sort_order into v_cur_sort from public.membership_tiers where id = v_prof.tier_id;
  select sort_order, name into v_tgt_sort, v_name from public.membership_tiers where id = v_target;
  if v_tgt_sort > coalesce(v_cur_sort, 0) or v_set.tier_downgrade_enabled then
    update public.member_profiles set tier_id = v_target where customer_id = p_customer;
    insert into public.member_tier_history(customer_id, from_tier_id, to_tier_id, rolling_spend_satang, reason, order_id)
    values (p_customer, v_prof.tier_id, v_target, v_spend, p_reason, p_order) returning id into v_hist;
    perform public._event(p_customer, 'tier_changed', v_hist::text,
                          jsonb_build_object('to', v_name, 'direction', case when v_tgt_sort > coalesce(v_cur_sort, 0) then 'up' else 'down' end));
    if v_tgt_sort > coalesce(v_cur_sort, 0) then
      perform public._notify(p_customer, 'transactional', 'tier_upgraded', 'tier:' || v_hist::text,
                             jsonb_build_object('tier_name', v_name));
    end if;
  end if;
end $$;

-- ออกคูปอง: key ซ้ำ = ไม่ออกซ้ำ (คืน NULL); โค้ดชนกันลองใหม่ได้สูงสุด 5 ครั้ง
create or replace function public._issue_coupon(
  p_customer uuid, p_template uuid, p_source text, p_title text, p_desc text,
  p_discount uuid, p_expires timestamptz, p_dedupe text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_try integer := 0;
begin
  if p_dedupe is not null and exists (select 1 from public.member_coupons where customer_id = p_customer and dedupe_key = p_dedupe) then
    return null;
  end if;
  loop
    v_try := v_try + 1;
    begin
      insert into public.member_coupons(code, customer_id, template_id, source, title, description, discount_id, expires_at, dedupe_key)
      values (upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)), p_customer, p_template, p_source,
              p_title, p_desc, p_discount, p_expires, p_dedupe)
      returning id into v_id;
      exit;
    exception when unique_violation then
      if p_dedupe is not null and exists (select 1 from public.member_coupons where customer_id = p_customer and dedupe_key = p_dedupe) then
        return null;
      end if;
      if v_try >= 5 then
        raise exception 'COUPON_CODE_FAILED';
      end if;
    end;
  end loop;
  perform public._event(p_customer, 'coupon_issued', v_id::text, jsonb_build_object('title', p_title, 'source', p_source));
  perform public._notify(
    p_customer,
    case when p_source in ('birthday','holiday','promotion') then 'marketing' else 'transactional' end,
    case when p_source = 'birthday' then 'birthday' else 'coupon_issued' end,
    'coupon:' || v_id::text,
    jsonb_build_object('title', p_title, 'expires_at', p_expires, 'source', p_source));
  return v_id;
end $$;

create or replace function public._issue_from_template(p_customer uuid, p_template uuid, p_dedupe text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.coupon_templates;
begin
  select * into t from public.coupon_templates where id = p_template and active;
  if not found then return null; end if;
  return public._issue_coupon(
    p_customer, t.id, t.source, t.title, t.description, t.discount_id,
    coalesce(t.expire_at, now() + make_interval(days => t.expire_days)), p_dedupe);
end $$;

-- ประเมินแต้ม/แสตมป์ที่จะได้ (ใช้ทั้งตอนประมวลผลจริงและตอนแสดงตัวอย่างที่ POS → สูตรเดียวกัน)
create or replace function public._earn_amounts(p_net integer, p_gross integer, p_stamp_qty integer)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_set public.loyalty_settings;
  v_basis integer;
  v_pts integer := 0;
  v_stamps integer := 0;
begin
  select * into v_set from public.loyalty_settings;
  v_basis := case when v_set.earn_basis = 'gross_before_discount' then p_gross else p_net end;
  if v_set.points_enabled and v_set.satang_per_point is not null and v_basis > 0 then
    v_pts := v_basis / v_set.satang_per_point;
  end if;
  if v_set.stamps_enabled then
    v_stamps := coalesce(p_stamp_qty, 0);
  end if;
  return jsonb_build_object('basis_satang', v_basis, 'points', v_pts, 'stamps', v_stamps);
end $$;

create or replace function public._stamp_qty_of_order(p_order uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(oi.quantity), 0)::integer
    from public.order_items oi
   where oi.order_id = p_order
     and public.resolve_station(oi.product_id, oi.category_name) = (select stamp_station from public.loyalty_settings)
$$;

-- หัวใจ: ประมวลผลออเดอร์ที่ชำระแล้วให้สมาชิก (idempotent ด้วย member_order_links.order_id)
create or replace function public._member_process_order(p_order uuid, p_customer uuid, p_via text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_set public.loyalty_settings;
  v_order public.orders;
  v_prof public.member_profiles;
  v_earn jsonb;
  v_pts integer;
  v_stamps integer;
  v_n integer;
  v_first boolean;
  v_led uuid;
  v_i integer := 0;
  v_rewards integer := 0;
  v_prod record;
begin
  select * into v_set from public.loyalty_settings;
  if not v_set.membership_enabled then
    return jsonb_build_object('skipped', 'DISABLED');
  end if;
  select * into v_order from public.orders where id = p_order;
  if not found or not exists (select 1 from public.payments where order_id = p_order) then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_order.payment_status = 'refunded' then
    return jsonb_build_object('skipped', 'REFUNDED');
  end if;
  select * into v_prof from public.member_profiles where customer_id = p_customer for update;
  if not found then
    return jsonb_build_object('skipped', 'NOT_MEMBER');
  end if;
  if not exists (select 1 from public.customers where id = p_customer and active) then
    return jsonb_build_object('skipped', 'CUSTOMER_INACTIVE');
  end if;

  v_earn := public._earn_amounts(v_order.total_satang, v_order.subtotal_satang, public._stamp_qty_of_order(p_order));
  v_pts := (v_earn->>'points')::integer;
  v_stamps := (v_earn->>'stamps')::integer;

  insert into public.member_order_links(order_id, customer_id, via, basis_satang, points_earned, stamps_earned)
  values (p_order, p_customer, p_via, v_order.total_satang, v_pts, v_stamps)
  on conflict (order_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('skipped', 'ALREADY_PROCESSED');
  end if;

  if v_pts > 0 then
    perform public._ledger_post(p_customer, 'points', 'EARN', v_pts, 'order:' || p_order || ':points', p_order);
  end if;
  if v_stamps > 0 then
    perform public._ledger_post(p_customer, 'stamps', 'EARN', v_stamps, 'order:' || p_order || ':stamps', p_order);
    -- ครบเกณฑ์แสตมป์ → แลกเป็นคูปองอัตโนมัติ (เหมือน LINE OA เดิม; ข้ามเกณฑ์ได้หลายครั้งในบิลเดียว)
    loop
      select * into v_prof from public.member_profiles where customer_id = p_customer;
      exit when v_prof.stamps_balance < v_set.stamps_per_reward;
      v_i := v_i + 1;
      v_led := public._ledger_post(p_customer, 'stamps', 'REDEEM', -v_set.stamps_per_reward,
                                   'order:' || p_order || ':reward:' || v_i, p_order,
                                   null, 'stamp reward');
      exit when v_led is null;
      perform public._issue_coupon(p_customer, null, 'reward', v_set.stamp_reward_title,
                                   'ได้รับจากการสะสมแสตมป์ครบ ' || v_set.stamps_per_reward || ' ดวง', null,
                                   now() + make_interval(days => v_set.stamp_reward_expire_days),
                                   'stamp-reward:' || v_led::text);
      v_rewards := v_rewards + 1;
    end loop;
  end if;

  select not exists (select 1 from public.member_order_links where customer_id = p_customer and order_id <> p_order)
    into v_first;
  update public.member_profiles set last_purchase_at = greatest(coalesce(last_purchase_at, v_order.created_at), v_order.created_at)
   where customer_id = p_customer;
  if v_first then
    perform public._event(p_customer, 'first_purchase', 'first_purchase', jsonb_build_object('order_id', p_order));
  end if;
  for v_prod in
    select distinct oi.product_id, oi.product_name from public.order_items oi
     where oi.order_id = p_order and oi.product_id is not null
  loop
    perform public._event(p_customer, 'first_try', v_prod.product_id::text, jsonb_build_object('name', v_prod.product_name));
  end loop;

  perform public._member_recompute_tier(p_customer, case when p_via = 'claim' then 'claim' else 'purchase' end, p_order);

  select * into v_prof from public.member_profiles where customer_id = p_customer;
  if v_first or v_pts > 0 or v_stamps > 0 then
    perform public._notify(p_customer, 'transactional',
                           case when v_first then 'first_purchase' else 'points_earned' end,
                           'order:' || p_order,
                           jsonb_build_object('points', v_pts, 'stamps', v_stamps,
                                              'points_balance', v_prof.points_balance,
                                              'stamps_balance', v_prof.stamps_balance,
                                              'rewards', v_rewards));
  end if;
  return jsonb_build_object('processed', true, 'points', v_pts, 'stamps', v_stamps, 'rewards', v_rewards);
end $$;

-- =====================================================================
-- Triggers (ไม่ให้การขาย/คืนเงินล้ม)
-- =====================================================================
create or replace function public.payments_member_process() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_c uuid;
begin
  begin
    select customer_id into v_c from public.orders where id = new.order_id;
    if v_c is not null and exists (select 1 from public.member_profiles where customer_id = v_c) then
      perform public._member_process_order(new.order_id, v_c, 'checkout');
    end if;
  exception when others then
    raise warning 'MEMBER_PROCESS_FAILED order=% : %', new.order_id, sqlerrm;
  end;
  return new;
end $$;
create trigger payments_member_process_trg after insert on public.payments
  for each row execute function public.payments_member_process();

-- คืนเงิน: ย้อนแต้มตามสัดส่วนที่คืน (ปัดลง; เก็บส่วนที่ยังค้างไว้ย้อนในการคืนครั้งถัดไป), ย้อนแสตมป์เมื่อคืนเต็มจำนวน, คิด Tier ใหม่
-- คูปองที่ออกไปแล้วไม่ถูกเรียกคืน (คูปองไม่ย้อนสถานะ)
create or replace function public.refunds_member_reverse() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  l public.member_order_links;
  o public.orders;
  v_cum bigint;
  v_target integer;
  v_done integer;
  v_delta integer;
  v_bal integer;
  v_take integer;
  v_st_done integer;
  v_st_take integer;
begin
  begin
    select * into l from public.member_order_links where order_id = new.order_id;
    if not found then return new; end if;
    select * into o from public.orders where id = new.order_id;
    select coalesce(sum(amount_satang), 0) into v_cum from public.refunds where order_id = new.order_id;

    if l.points_earned > 0 then
      v_target := floor(l.points_earned::numeric * least(v_cum, o.total_satang) / o.total_satang)::integer;
      select coalesce(-sum(amount), 0) into v_done from public.member_ledger
       where order_id = new.order_id and currency = 'points' and kind = 'REFUND_REVERSAL';
      v_delta := v_target - v_done;
      if v_delta > 0 then
        select points_balance into v_bal from public.member_profiles where customer_id = l.customer_id;
        v_take := least(v_delta, coalesce(v_bal, 0));
        if v_take > 0 then
          perform public._ledger_post(l.customer_id, 'points', 'REFUND_REVERSAL', -v_take, 'refund:' || new.id || ':points',
                                      new.order_id, new.id,
                                      case when v_take < v_delta then 'SHORTFALL ' || (v_delta - v_take) end);
        end if;
      end if;
    end if;

    if l.stamps_earned > 0 and v_cum >= o.total_satang then
      select coalesce(-sum(amount), 0) into v_st_done from public.member_ledger
       where order_id = new.order_id and currency = 'stamps' and kind = 'REFUND_REVERSAL';
      if v_st_done < l.stamps_earned then
        select stamps_balance into v_bal from public.member_profiles where customer_id = l.customer_id;
        v_st_take := least(l.stamps_earned - v_st_done, coalesce(v_bal, 0));
        if v_st_take > 0 then
          perform public._ledger_post(l.customer_id, 'stamps', 'REFUND_REVERSAL', -v_st_take, 'refund:' || new.id || ':stamps',
                                      new.order_id, new.id,
                                      case when v_st_take < l.stamps_earned - v_st_done then 'SHORTFALL' end);
        end if;
      end if;
    end if;

    perform public._member_recompute_tier(l.customer_id, 'refund', new.order_id);
  exception when others then
    raise warning 'MEMBER_REFUND_REVERSE_FAILED refund=% : %', new.id, sqlerrm;
  end;
  return new;
end $$;
create trigger refunds_member_reverse_trg after insert on public.refunds
  for each row execute function public.refunds_member_reverse();

-- คิวพร้อมรับ → แจ้งสมาชิก (ไม่ใส่ token ของคิวใน payload)
create or replace function public.queue_ready_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_c uuid;
begin
  if new.status = 'ready' and old.status is distinct from 'ready' then
    begin
      select customer_id into v_c from public.member_order_links where order_id = new.order_id;
      if v_c is not null then
        perform public._notify(v_c, 'transactional', 'queue_ready', 'queue-ready:' || new.id::text,
                               jsonb_build_object('queue_no', new.queue_no));
      end if;
    exception when others then
      raise warning 'QUEUE_NOTIFY_FAILED queue=% : %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;
create trigger order_queues_ready_notify_trg after update of status on public.order_queues
  for each row execute function public.queue_ready_notify();

-- =====================================================================
-- ฟังก์ชันอ่านสรุปสมาชิก (ภายใน)
-- =====================================================================
create or replace function public._member_card(p_customer uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'customer_id', c.id, 'member_no', p.member_no, 'name', c.name, 'phone', c.phone, 'birthday', p.birthday,
    'tier_code', t.code, 'tier_name', t.name, 'points', p.points_balance, 'stamps', p.stamps_balance,
    'stamps_lifetime', p.stamps_lifetime, 'joined_at', p.joined_at, 'last_purchase_at', p.last_purchase_at,
    'marketing_consent', p.marketing_consent, 'privacy_accepted', p.privacy_accepted_at is not null,
    'active', c.active,
    'has_line', exists (select 1 from public.customer_line_links k where k.customer_id = c.id and k.unlinked_at is null))
  from public.member_profiles p
  join public.customers c on c.id = p.customer_id
  left join public.membership_tiers t on t.id = p.tier_id
  where p.customer_id = p_customer
$$;

create or replace function public._tier_progress(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_spend bigint;
  v_cur public.membership_tiers;
  v_next public.membership_tiers;
  v_months integer;
begin
  select tier_rolling_months into v_months from public.loyalty_settings;
  v_spend := public._rolling_spend(p_customer);
  select t.* into v_cur from public.membership_tiers t join public.member_profiles p on p.tier_id = t.id where p.customer_id = p_customer;
  select * into v_next from public.membership_tiers
   where active and min_rolling_spend_satang is not null and sort_order > coalesce(v_cur.sort_order, 0)
   order by sort_order limit 1;
  return jsonb_build_object(
    'rolling_spend_satang', v_spend, 'months', v_months,
    'current', case when v_cur.id is null then null else jsonb_build_object('code', v_cur.code, 'name', v_cur.name) end,
    'next', case when v_next.id is null then null else jsonb_build_object(
              'code', v_next.code, 'name', v_next.name, 'min_satang', v_next.min_rolling_spend_satang,
              'remaining_satang', greatest(v_next.min_rolling_spend_satang - v_spend, 0)) end);
end $$;

-- =====================================================================
-- ฟังก์ชันสำหรับ POS (พนักงานล็อกอิน; ตรวจสิทธิ์ด้วย require_role)
-- =====================================================================
create or replace function public.pos_find_member(p_query text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_digits text := regexp_replace(v_q, '[^0-9]', '', 'g');
begin
  perform public.require_role(null);
  if length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(public._member_card(x.customer_id) order by x.sort_name)
    from (
      select p.customer_id, c.name as sort_name
        from public.member_profiles p
        join public.customers c on c.id = p.customer_id
       where c.active and (
             upper(p.member_no) = upper(v_q)
          or (length(v_digits) >= 4 and (p.phone_norm like '%' || v_digits or public._norm_phone(c.phone) like '%' || v_digits))
          or c.name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
       order by c.name limit 10
    ) x), '[]'::jsonb);
end $$;

create or replace function public.pos_member_by_qr_ref(p_qr_ref text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_c uuid;
begin
  perform public.require_role(null);
  select p.customer_id into v_c from public.member_profiles p join public.customers c on c.id = p.customer_id
   where p.qr_ref = p_qr_ref and c.active;
  if not found then
    return null;
  end if;
  return public._member_card(v_c);
end $$;

-- สรุปสมาชิกสำหรับหน้าชำระเงิน: ตัวอย่างแต้มที่จะได้ + ความคืบหน้า Tier + คูปองที่ใช้ได้
create or replace function public.pos_member_summary(p_customer uuid, p_items jsonb, p_net_satang integer, p_gross_satang integer)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_set public.loyalty_settings;
  v_prof public.member_profiles;
  v_qty integer := 0;
  v_earn jsonb;
  v_tier_sort integer;
  v_coupons jsonb;
begin
  perform public.require_role(null);
  select * into v_set from public.loyalty_settings;
  select * into v_prof from public.member_profiles where customer_id = p_customer;
  if not found then
    return null;
  end if;
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    select coalesce(sum((i->>'quantity')::integer), 0) into v_qty
      from jsonb_array_elements(p_items) i
     where public.resolve_station((i->>'product_id')::uuid, null) = v_set.stamp_station;
  end if;
  v_earn := case when v_set.membership_enabled
                 then public._earn_amounts(coalesce(p_net_satang, 0), coalesce(p_gross_satang, 0), v_qty)
                 else jsonb_build_object('basis_satang', 0, 'points', 0, 'stamps', 0) end;
  select sort_order into v_tier_sort from public.membership_tiers where id = v_prof.tier_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', k.id, 'code', k.code, 'title', k.title, 'expires_at', k.expires_at,
      'discount', case when d.id is null then null else jsonb_build_object('name', d.name, 'kind', d.kind, 'value', d.value) end,
      'min_spend_satang', t.min_spend_satang,
      'usable', (t.min_spend_satang is null or coalesce(p_gross_satang, 0) >= t.min_spend_satang)
                and (t.min_tier_id is null or coalesce(v_tier_sort, 0) >=
                     (select sort_order from public.membership_tiers where id = t.min_tier_id))
                and (d.id is null or d.active)
    ) order by k.expires_at), '[]'::jsonb) into v_coupons
    from public.member_coupons k
    left join public.coupon_templates t on t.id = k.template_id
    left join public.discounts d on d.id = k.discount_id
   where k.customer_id = p_customer and k.status = 'unused' and k.expires_at > now();

  return jsonb_build_object(
    'member', public._member_card(p_customer),
    'enabled', v_set.membership_enabled,
    'preview', v_earn,
    'tier', public._tier_progress(p_customer),
    'stamps', jsonb_build_object('enabled', v_set.stamps_enabled, 'balance', v_prof.stamps_balance,
                                 'per_reward', v_set.stamps_per_reward),
    'points_enabled', v_set.points_enabled and v_set.satang_per_point is not null,
    'coupons', v_coupons);
end $$;

create or replace function public._register_member(
  p_name text, p_phone text, p_birthday date, p_privacy boolean, p_marketing boolean,
  p_via text, p_line_user_id text, p_line_name text, p_line_picture text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public._norm_phone(p_phone);
  v_cust uuid;
  v_set public.loyalty_settings;
begin
  if not coalesce(p_privacy, false) then
    raise exception 'CONSENT_REQUIRED';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 or length(p_name) > 100 then
    raise exception 'INVALID_INPUT: name';
  end if;
  if v_phone is null or v_phone !~ '^0[0-9]{8,9}$' then
    raise exception 'INVALID_PHONE';
  end if;
  if p_birthday is not null and (p_birthday > public.bkk_today() or p_birthday < date '1900-01-01') then
    raise exception 'INVALID_BIRTHDAY';
  end if;
  if exists (select 1 from public.member_profiles where phone_norm = v_phone) then
    raise exception 'PHONE_ALREADY_MEMBER';
  end if;
  -- มีลูกค้าเดิมใน POS ที่เบอร์ตรงกัน → ห้ามผูกอัตโนมัติจากเบอร์ (เสี่ยงสวมสิทธิ์) ให้ผูกผ่าน QR ที่เคาน์เตอร์
  if exists (select 1 from public.customers c where c.active and public._norm_phone(c.phone) = v_phone) then
    raise exception 'PHONE_EXISTS_ASK_STAFF';
  end if;
  if p_line_user_id is not null and exists (
       select 1 from public.customer_line_links where line_user_id = p_line_user_id and unlinked_at is null) then
    raise exception 'LINE_ALREADY_LINKED';
  end if;

  insert into public.customers(name, phone) values (btrim(p_name), v_phone) returning id into v_cust;
  perform public._member_ensure_profile(v_cust, p_via, v_phone);
  update public.member_profiles
     set birthday = p_birthday, privacy_accepted_at = now(),
         marketing_consent = coalesce(p_marketing, false),
         marketing_consent_at = case when coalesce(p_marketing, false) then now() end
   where customer_id = v_cust;
  if p_line_user_id is not null then
    insert into public.customer_line_links(customer_id, line_user_id, display_name, picture_url)
    values (v_cust, p_line_user_id, left(p_line_name, 160), p_line_picture);
    perform public._event(v_cust, 'line_linked', 'line:' || p_line_user_id, '{}'::jsonb);
  end if;

  select * into v_set from public.loyalty_settings;
  if v_set.welcome_coupon_template_id is not null then
    perform public._issue_from_template(v_cust, v_set.welcome_coupon_template_id, 'welcome');
  end if;
  perform public._notify(v_cust, 'transactional', 'member_registered', 'registered:' || v_cust::text,
                         jsonb_build_object('name', btrim(p_name)));
  return v_cust;
end $$;

create or replace function public.pos_register_member(
  p_name text, p_phone text, p_birthday date, p_privacy boolean, p_marketing boolean, p_customer_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_cust uuid;
  v_phone text := public._norm_phone(p_phone);
begin
  v_emp := public.require_role(null);
  if not coalesce(p_privacy, false) then
    raise exception 'CONSENT_REQUIRED';
  end if;
  if p_customer_id is null then
    v_cust := public._register_member(p_name, p_phone, p_birthday, p_privacy, p_marketing, 'pos', null, null, null);
  else
    -- ลูกค้าเดิมใน POS → ยกระดับเป็นสมาชิก (ใช้ชื่อ/เบอร์เดิมถ้าไม่ส่งมา)
    select id into v_cust from public.customers where id = p_customer_id and active;
    if not found then
      raise exception 'CUSTOMER_NOT_FOUND';
    end if;
    if exists (select 1 from public.member_profiles where customer_id = v_cust) then
      raise exception 'ALREADY_MEMBER';
    end if;
    if v_phone is not null and exists (select 1 from public.member_profiles where phone_norm = v_phone) then
      raise exception 'PHONE_ALREADY_MEMBER';
    end if;
    perform public._member_ensure_profile(v_cust, 'pos', coalesce(v_phone, (select phone from public.customers where id = v_cust)));
    update public.member_profiles
       set birthday = p_birthday, privacy_accepted_at = now(),
           marketing_consent = coalesce(p_marketing, false),
           marketing_consent_at = case when coalesce(p_marketing, false) then now() end
     where customer_id = v_cust;
    if v_phone is not null then
      update public.customers set phone = v_phone where id = v_cust;
    end if;
  end if;
  update public.member_profiles set phone_verified_at = now() where customer_id = v_cust and phone_norm is not null;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'member_register', 'member_profiles', v_cust::text, jsonb_build_object('via', 'pos'));
  return public._member_card(v_cust);
end $$;

create or replace function public.pos_order_membership(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l public.member_order_links;
  o public.orders;
  v_set public.loyalty_settings;
begin
  perform public.require_role(null);
  select * into o from public.orders where id = p_order;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  select * into v_set from public.loyalty_settings;
  select * into l from public.member_order_links where order_id = p_order;
  if found then
    return jsonb_build_object('linked', true, 'points_earned', l.points_earned, 'stamps_earned', l.stamps_earned,
                              'member', public._member_card(l.customer_id));
  end if;
  return jsonb_build_object(
    'linked', false,
    'claimable', v_set.membership_enabled and o.customer_id is null and o.payment_status = 'paid'
                 and o.created_at > now() - make_interval(hours => v_set.claim_order_window_hours));
end $$;

create or replace function public.pos_create_claim(p_token_hash text, p_purpose text, p_customer uuid default null, p_order uuid default null)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_set public.loyalty_settings;
  o public.orders;
  v_exp timestamptz;
begin
  v_emp := public.require_role(null);
  select * into v_set from public.loyalty_settings;
  if not v_set.membership_enabled then
    raise exception 'MEMBERSHIP_DISABLED';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_INPUT: token';
  end if;
  if p_purpose = 'claim' then
    select * into o from public.orders where id = p_order;
    if not found then raise exception 'ORDER_NOT_FOUND'; end if;
    if o.customer_id is not null or exists (select 1 from public.member_order_links where order_id = p_order) then
      raise exception 'ORDER_HAS_MEMBER';
    end if;
    if o.payment_status <> 'paid' then raise exception 'ORDER_NOT_CLAIMABLE'; end if;
    if o.created_at <= now() - make_interval(hours => v_set.claim_order_window_hours) then
      raise exception 'CLAIM_WINDOW_PASSED';
    end if;
    p_customer := null;
  elsif p_purpose = 'link' then
    if not exists (select 1 from public.member_profiles where customer_id = p_customer) then
      raise exception 'MEMBER_NOT_FOUND';
    end if;
    if exists (select 1 from public.customer_line_links where customer_id = p_customer and unlinked_at is null) then
      raise exception 'ALREADY_LINKED';
    end if;
    p_order := null;
  elsif p_purpose = 'join' then
    p_customer := null; p_order := null;
  else
    raise exception 'INVALID_INPUT: purpose';
  end if;
  v_exp := now() + make_interval(mins => v_set.claim_qr_minutes);
  insert into public.membership_claims(token_hash, purpose, customer_id, order_id, expires_at, created_by)
  values (p_token_hash, p_purpose, p_customer, p_order, v_exp, v_emp);
  return v_exp;
end $$;

-- ชำระเงินพร้อมใช้คูปองสมาชิก: ห่อ checkout_order เดิม (ไม่แก้ฟังก์ชันการเงินเดิม) ใน transaction เดียว
create or replace function public.checkout_member_order(
  p_idempotency_key uuid, p_shift_id uuid, p_items jsonb, p_discount_id uuid, p_method text,
  p_received_satang integer, p_reference text, p_customer_id uuid, p_note text, p_member_coupon_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_existing uuid;
  k public.member_coupons;
  t public.coupon_templates;
  v_order uuid;
  v_sub integer;
  v_ocust uuid;
  v_cur_sort integer;
  v_min_sort integer;
begin
  v_emp := public.require_role(null);
  select order_id into v_existing from public.payments where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;
  if p_member_coupon_id is null then
    return public.checkout_order(p_idempotency_key, p_shift_id, p_items, p_discount_id, p_method,
                                 p_received_satang, p_reference, p_customer_id, p_note);
  end if;
  if p_customer_id is null then
    raise exception 'COUPON_REQUIRES_MEMBER';
  end if;
  if not exists (select 1 from public.settings where customers_enabled) then
    raise exception 'CUSTOMERS_DISABLED';
  end if;

  select * into k from public.member_coupons where id = p_member_coupon_id for update;
  if not found then raise exception 'COUPON_NOT_FOUND'; end if;
  if k.customer_id <> p_customer_id then raise exception 'COUPON_NOT_OWNED'; end if;
  if k.status = 'used' then raise exception 'COUPON_ALREADY_USED'; end if;
  if k.status = 'cancelled' then raise exception 'COUPON_CANCELLED'; end if;
  if k.status = 'expired' or k.expires_at <= now() then raise exception 'COUPON_EXPIRED'; end if;
  if k.discount_id is not null and p_discount_id is not null then
    raise exception 'DISCOUNT_CONFLICT';
  end if;

  v_order := public.checkout_order(p_idempotency_key, p_shift_id, p_items, coalesce(k.discount_id, p_discount_id),
                                   p_method, p_received_satang, p_reference, p_customer_id, p_note);
  select subtotal_satang, customer_id into v_sub, v_ocust from public.orders where id = v_order;
  if v_ocust is distinct from p_customer_id then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;
  if k.template_id is not null then
    select * into t from public.coupon_templates where id = k.template_id;
    if found then
      if t.min_spend_satang is not null and v_sub < t.min_spend_satang then
        raise exception 'COUPON_MIN_SPEND';
      end if;
      if t.min_tier_id is not null then
        select tt.sort_order into v_cur_sort from public.member_profiles p join public.membership_tiers tt on tt.id = p.tier_id
         where p.customer_id = p_customer_id;
        select sort_order into v_min_sort from public.membership_tiers where id = t.min_tier_id;
        if coalesce(v_cur_sort, 0) < v_min_sort then
          raise exception 'COUPON_TIER_NOT_ELIGIBLE';
        end if;
      end if;
    end if;
  end if;
  update public.member_coupons
     set status = 'used', used_at = now(), used_by = v_emp, used_order_id = v_order
   where id = k.id;
  perform public._event(p_customer_id, 'coupon_used', k.id::text, jsonb_build_object('title', k.title, 'order_id', v_order));
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'coupon_redeem', 'member_coupons', k.id::text, jsonb_build_object('order_id', v_order));
  return v_order;
end $$;

-- ใช้คูปองที่เคาน์เตอร์โดยไม่ผูกกับออเดอร์ (เช่น เครื่องดื่มฟรีที่พนักงานมอบเอง — พฤติกรรมเดิมของ LINE OA)
create or replace function public.redeem_member_coupon(p_coupon_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  k public.member_coupons;
begin
  v_emp := public.require_role(null);
  select * into k from public.member_coupons where id = p_coupon_id for update;
  if not found then raise exception 'COUPON_NOT_FOUND'; end if;
  if k.status = 'used' then raise exception 'COUPON_ALREADY_USED'; end if;
  if k.status = 'cancelled' then raise exception 'COUPON_CANCELLED'; end if;
  if k.status = 'expired' or k.expires_at <= now() then raise exception 'COUPON_EXPIRED'; end if;
  if k.discount_id is not null then raise exception 'COUPON_NEEDS_CHECKOUT'; end if;
  update public.member_coupons set status = 'used', used_at = now(), used_by = v_emp, note = nullif(btrim(coalesce(p_note, '')), '')
   where id = k.id;
  perform public._event(k.customer_id, 'coupon_used', k.id::text, jsonb_build_object('title', k.title));
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'coupon_redeem', 'member_coupons', k.id::text, jsonb_build_object('manual', true));
  return jsonb_build_object('id', k.id, 'title', k.title);
end $$;

create or replace function public.cancel_member_coupon(p_coupon_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; k public.member_coupons;
begin
  v_emp := public.require_role(array['owner','manager']);
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'REASON_REQUIRED'; end if;
  select * into k from public.member_coupons where id = p_coupon_id for update;
  if not found then raise exception 'COUPON_NOT_FOUND'; end if;
  if k.status <> 'unused' then raise exception 'COUPON_STATUS_FINAL'; end if;
  update public.member_coupons set status = 'cancelled', note = btrim(p_reason) where id = k.id;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'coupon_cancel', 'member_coupons', k.id::text, jsonb_build_object('reason', btrim(p_reason)));
end $$;

create or replace function public.issue_manual_coupon(p_customer uuid, p_template uuid, p_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_id uuid;
begin
  v_emp := public.require_role(array['owner','manager']);
  if not exists (select 1 from public.member_profiles where customer_id = p_customer) then
    raise exception 'MEMBER_NOT_FOUND';
  end if;
  if not exists (select 1 from public.coupon_templates where id = p_template and active) then
    raise exception 'TEMPLATE_NOT_FOUND';
  end if;
  if p_key is null or length(btrim(p_key)) = 0 then raise exception 'INVALID_INPUT: key'; end if;
  v_id := public._issue_from_template(p_customer, p_template, 'manual:' || p_key);
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'coupon_issue', 'member_coupons', coalesce(v_id::text, 'duplicate'), jsonb_build_object('customer_id', p_customer, 'template_id', p_template));
  return v_id;
end $$;

create or replace function public.member_adjust_points(p_customer uuid, p_currency text, p_amount integer, p_reason text, p_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_id uuid;
begin
  v_emp := public.require_role(array['owner','manager']);
  if p_currency not in ('points','stamps') then raise exception 'INVALID_INPUT: currency'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 then raise exception 'INVALID_AMOUNT'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'REASON_REQUIRED'; end if;
  if p_key is null or length(btrim(p_key)) = 0 then raise exception 'INVALID_INPUT: key'; end if;
  v_id := public._ledger_post(p_customer, p_currency, 'ADMIN_ADJUSTMENT', p_amount, 'adjust:' || p_key,
                              null, null, btrim(p_reason), v_emp);
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'member_adjust', 'member_profiles', p_customer::text,
          jsonb_build_object('currency', p_currency, 'amount', p_amount, 'reason', btrim(p_reason), 'duplicate', v_id is null));
  return public._member_card(p_customer);
end $$;

create or replace function public.pos_unlink_line(p_customer uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_n integer;
begin
  v_emp := public.require_role(array['owner','manager']);
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'REASON_REQUIRED'; end if;
  update public.customer_line_links set unlinked_at = now(), unlink_reason = btrim(p_reason)
   where customer_id = p_customer and unlinked_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'NOT_LINKED'; end if;
  perform public._event(p_customer, 'line_unlinked', gen_random_uuid()::text, jsonb_build_object('by', 'staff'));
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'line_unlink', 'customer_line_links', p_customer::text, jsonb_build_object('reason', btrim(p_reason)));
end $$;

-- เพิกถอน Member QR เดิม (หมุน qr_ref)
create or replace function public.member_rotate_qr(p_customer uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  v_emp := public.require_role(array['owner','manager']);
  update public.member_profiles set qr_ref = replace(gen_random_uuid()::text, '-', '') where customer_id = p_customer;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (v_emp, 'member_qr_rotate', 'member_profiles', p_customer::text, '{}'::jsonb);
end $$;

create or replace function public.pos_member_detail(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_role(array['owner','manager']);
  if not exists (select 1 from public.member_profiles where customer_id = p_customer) then
    raise exception 'MEMBER_NOT_FOUND';
  end if;
  return jsonb_build_object(
    'member', public._member_card(p_customer),
    'tier', public._tier_progress(p_customer),
    'ledger', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select currency, kind, amount, balance_after, note, created_at, order_id from public.member_ledger
         where customer_id = p_customer order by created_at desc limit 50) x), '[]'::jsonb),
    'coupons', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select id, code, title, source, status, issued_at, expires_at, used_at from public.member_coupons
         where customer_id = p_customer order by issued_at desc limit 50) x), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select o.id, o.order_no, o.created_at, o.total_satang, o.payment_status, l.points_earned, l.stamps_earned, l.via
          from public.member_order_links l join public.orders o on o.id = l.order_id
         where l.customer_id = p_customer order by o.created_at desc limit 30) x), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select kind, detail, occurred_at from public.member_events
         where customer_id = p_customer order by occurred_at desc limit 50) x), '[]'::jsonb));
end $$;

create or replace function public.members_overview(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_res jsonb;
begin
  perform public.require_role(array['owner','manager']);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'INVALID_RANGE';
  end if;
  v_from := (p_from::timestamp) at time zone 'Asia/Bangkok';
  v_to   := ((p_to + 1)::timestamp) at time zone 'Asia/Bangkok';
  select jsonb_build_object(
    'total_members', (select count(*) from public.member_profiles),
    'linked_members', (select count(*) from public.customer_line_links where unlinked_at is null),
    'new_members', (select count(*) from public.member_profiles where joined_at >= v_from and joined_at < v_to),
    -- สมาชิกที่ "มีการซื้อจริง" ในช่วงที่เลือก
    'active_members', (select count(distinct l.customer_id) from public.member_order_links l join public.orders o on o.id = l.order_id
                        where o.created_at >= v_from and o.created_at < v_to and o.payment_status <> 'refunded'),
    -- ลูกค้าซื้อซ้ำ = สมาชิกที่มี ≥ 2 ออเดอร์ (ไม่ถูกคืนเต็มจำนวน) ในช่วงที่เลือก
    'repeat_members', (select count(*) from (
        select l.customer_id from public.member_order_links l join public.orders o on o.id = l.order_id
         where o.created_at >= v_from and o.created_at < v_to and o.payment_status <> 'refunded'
         group by l.customer_id having count(*) >= 2) r),
    'member_orders', (select count(*) from public.member_order_links l join public.orders o on o.id = l.order_id
                       where o.created_at >= v_from and o.created_at < v_to and o.payment_status <> 'refunded'),
    'member_sales_satang', (select coalesce(sum(o.total_satang), 0) from public.member_order_links l join public.orders o on o.id = l.order_id
                             where o.created_at >= v_from and o.created_at < v_to and o.payment_status <> 'refunded'),
    'nonmember_orders', (select count(*) from public.orders o
                          where o.created_at >= v_from and o.created_at < v_to and o.payment_status <> 'refunded'
                            and not exists (select 1 from public.member_order_links l where l.order_id = o.id)),
    'nonmember_sales_satang', (select coalesce(sum(o.total_satang), 0) from public.orders o
                                where o.created_at >= v_from and o.created_at < v_to and o.payment_status <> 'refunded'
                                  and not exists (select 1 from public.member_order_links l where l.order_id = o.id)),
    'tier_distribution', coalesce((select jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name,
                                     'members', (select count(*) from public.member_profiles p where p.tier_id = t.id)) order by t.sort_order)
                                   from public.membership_tiers t), '[]'::jsonb),
    'tier_upgrades', (select count(*) from public.member_tier_history h join public.membership_tiers a on a.id = h.to_tier_id
                       left join public.membership_tiers b on b.id = h.from_tier_id
                       where h.created_at >= v_from and h.created_at < v_to and a.sort_order > coalesce(b.sort_order, 0)),
    'points_issued', (select coalesce(sum(amount), 0) from public.member_ledger where currency = 'points' and amount > 0 and created_at >= v_from and created_at < v_to),
    'points_redeemed', (select coalesce(-sum(amount), 0) from public.member_ledger where currency = 'points' and kind = 'REDEEM' and created_at >= v_from and created_at < v_to),
    'points_outstanding', (select coalesce(sum(points_balance), 0) from public.member_profiles),
    'coupons_issued', (select count(*) from public.member_coupons where issued_at >= v_from and issued_at < v_to),
    'coupons_used', (select count(*) from public.member_coupons where status = 'used' and used_at >= v_from and used_at < v_to),
    'notifications', coalesce((select jsonb_object_agg(status, n) from (
        select status, count(*) n from public.notification_outbox where created_at >= v_from and created_at < v_to group by status) s), '{}'::jsonb)
  ) into v_res;
  return v_res;
end $$;

-- ซ่อมออเดอร์ที่ชำระแล้วแต่ยังไม่ได้ประมวลผลสมาชิก (เช่น เปิดระบบสมาชิกทีหลัง/trigger พลาด); เฉพาะออเดอร์ 'paid' ในช่วง N วัน
create or replace function public.membership_reconcile_internal(p_days integer) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; v_n integer := 0; v_res jsonb;
begin
  for r in
    select o.id, o.customer_id from public.orders o
     where o.customer_id is not null and o.payment_status = 'paid'
       and o.created_at > now() - make_interval(days => greatest(p_days, 1))
       and exists (select 1 from public.member_profiles p where p.customer_id = o.customer_id)
       and not exists (select 1 from public.member_order_links l where l.order_id = o.id)
     order by o.created_at
  loop
    v_res := public._member_process_order(r.id, r.customer_id, 'reconcile');
    if coalesce((v_res->>'processed')::boolean, false) then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

create or replace function public.membership_reconcile(p_days integer default 7) returns integer
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role(array['owner','manager']);
  return public.membership_reconcile_internal(p_days);
end $$;

-- =====================================================================
-- ฟังก์ชันสำหรับเซิร์ฟเวอร์ LIFF/LINE (service_role เท่านั้น — เซิร์ฟเวอร์ตรวจ LINE ID token ให้แล้ว)
-- =====================================================================
create or replace function public._customer_of_line(p_line_user_id text) returns uuid
language sql stable security definer set search_path = public as $$
  select l.customer_id from public.customer_line_links l
   join public.customers c on c.id = l.customer_id
   where l.line_user_id = p_line_user_id and l.unlinked_at is null and c.active
$$;

create or replace function public.liff_get_member(p_line_user_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_c uuid := public._customer_of_line(p_line_user_id);
  v_set public.loyalty_settings;
begin
  select * into v_set from public.loyalty_settings;
  if v_c is null then
    return jsonb_build_object('linked', false, 'membership_enabled', v_set.membership_enabled);
  end if;
  return jsonb_build_object(
    'linked', true,
    'membership_enabled', v_set.membership_enabled,
    'member', public._member_card(v_c) - 'customer_id' - 'active',
    'tier', public._tier_progress(v_c),
    'settings', jsonb_build_object('points_enabled', v_set.points_enabled and v_set.satang_per_point is not null,
                                   'stamps_enabled', v_set.stamps_enabled, 'stamps_per_reward', v_set.stamps_per_reward),
    'coupons_available', (select count(*) from public.member_coupons where customer_id = v_c and status = 'unused' and expires_at > now()));
end $$;

create or replace function public.liff_member_qr_ref(p_line_user_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public._customer_of_line(p_line_user_id); v jsonb;
begin
  if v_c is null then raise exception 'MEMBER_NOT_FOUND'; end if;
  select jsonb_build_object('qr_ref', qr_ref, 'member_no', member_no) into v from public.member_profiles where customer_id = v_c;
  return v;
end $$;

create or replace function public.liff_section(p_line_user_id text, p_section text, p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_c uuid := public._customer_of_line(p_line_user_id);
  v_lim integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_tier_sort integer;
begin
  if v_c is null then raise exception 'MEMBER_NOT_FOUND'; end if;
  if p_section = 'points' or p_section = 'stamps' then
    return coalesce((select jsonb_agg(to_jsonb(x)) from (
      select kind, amount, balance_after, created_at from public.member_ledger
       where customer_id = v_c and currency = p_section order by created_at desc limit v_lim) x), '[]'::jsonb);
  elsif p_section = 'coupons' then
    return coalesce((select jsonb_agg(to_jsonb(x)) from (
      select code, title, description, source,
             case when status = 'unused' and expires_at <= now() then 'expired' else status end as status,
             issued_at, expires_at, used_at,
             (select jsonb_build_object('name', d.name, 'kind', d.kind, 'value', d.value) from public.discounts d where d.id = k.discount_id) as discount
        from public.member_coupons k where customer_id = v_c order by (status = 'unused' and expires_at > now()) desc, expires_at desc limit v_lim) x), '[]'::jsonb);
  elsif p_section = 'rewards' then
    select tt.sort_order into v_tier_sort from public.member_profiles p join public.membership_tiers tt on tt.id = p.tier_id where p.customer_id = v_c;
    return coalesce((select jsonb_agg(to_jsonb(x)) from (
      select t.id, t.title, t.description, t.point_cost, t.min_spend_satang,
             (select name from public.membership_tiers where id = t.min_tier_id) as min_tier_name,
             (t.min_tier_id is null or coalesce(v_tier_sort, 0) >= (select sort_order from public.membership_tiers where id = t.min_tier_id)) as tier_ok
        from public.coupon_templates t
       where t.active and t.point_cost is not null
         and (t.claim_start_at is null or t.claim_start_at <= now())
         and (t.claim_end_at is null or t.claim_end_at >= now())
         and (t.quantity_limit is null or (select count(*) from public.member_coupons k where k.template_id = t.id) < t.quantity_limit)
       order by t.point_cost, t.title) x), '[]'::jsonb);
  elsif p_section = 'orders' then
    return coalesce((select jsonb_agg(to_jsonb(x)) from (
      select o.order_no, o.created_at, o.total_satang, o.payment_status, l.points_earned, l.stamps_earned,
             (select coalesce(jsonb_agg(jsonb_build_object('name', oi.product_name, 'quantity', oi.quantity) order by oi.product_name), '[]'::jsonb)
                from public.order_items oi where oi.order_id = o.id) as items
        from public.member_order_links l join public.orders o on o.id = l.order_id
       where l.customer_id = v_c order by o.created_at desc limit v_lim) x), '[]'::jsonb);
  elsif p_section = 'collection' then
    return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(x) order by x.category_sort, x.sort_order, x.name) from (
      select p.id as product_id, p.name, p.emoji, p.sort_order, c.sort_order as category_sort, c.name as category,
             (a.product_id is not null) as tried, a.first_try_at, a.times
        from public.products p
        join public.categories c on c.id = p.category_id
        left join (
          select oi.product_id, min(o.created_at) as first_try_at, sum(oi.quantity)::integer as times
            from public.member_order_links l join public.orders o on o.id = l.order_id and o.payment_status <> 'refunded'
            join public.order_items oi on oi.order_id = o.id
           where l.customer_id = v_c and oi.product_id is not null group by oi.product_id) a on a.product_id = p.id
       where p.is_active) x), '[]'::jsonb));
  elsif p_section = 'journey' then
    return coalesce((select jsonb_agg(to_jsonb(x)) from (
      select kind, detail, occurred_at from public.member_events where customer_id = v_c order by occurred_at desc limit v_lim) x), '[]'::jsonb);
  elsif p_section = 'tiers' then
    return jsonb_build_object('tiers', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name,
              'min_satang', min_rolling_spend_satang, 'benefits', benefits) order by sort_order)
              from public.membership_tiers where active), '[]'::jsonb), 'progress', public._tier_progress(v_c));
  end if;
  raise exception 'INVALID_INPUT: section';
end $$;

-- สมัครสมาชิกผ่าน LIFF (idempotent: LINE นี้ผูกอยู่แล้ว → คืนข้อมูลเดิม)
create or replace function public.liff_register(
  p_line_user_id text, p_line_name text, p_line_picture text, p_name text, p_phone text,
  p_birthday date, p_privacy boolean, p_marketing boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c uuid;
begin
  if not (select membership_enabled from public.loyalty_settings) then
    raise exception 'MEMBERSHIP_DISABLED';
  end if;
  v_c := public._customer_of_line(p_line_user_id);
  if v_c is null then
    v_c := public._register_member(p_name, p_phone, p_birthday, p_privacy, p_marketing, 'liff', p_line_user_id, p_line_name, p_line_picture);
  end if;
  return public.liff_get_member(p_line_user_id);
end $$;

create or replace function public.liff_update_profile(
  p_line_user_id text, p_name text, p_birthday date, p_marketing boolean, p_accept_privacy boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_c uuid := public._customer_of_line(p_line_user_id);
  v_prof public.member_profiles;
begin
  if v_c is null then raise exception 'MEMBER_NOT_FOUND'; end if;
  select * into v_prof from public.member_profiles where customer_id = v_c for update;
  if p_name is not null then
    if length(btrim(p_name)) = 0 or length(p_name) > 100 then raise exception 'INVALID_INPUT: name'; end if;
    update public.customers set name = btrim(p_name) where id = v_c;
  end if;
  if p_birthday is not null then
    if p_birthday > public.bkk_today() or p_birthday < date '1900-01-01' then raise exception 'INVALID_BIRTHDAY'; end if;
    -- วันเกิดแก้ได้เฉพาะเมื่อยังไม่เคยตั้ง (กันการแก้เพื่อรับสิทธิ์วันเกิดซ้ำ); ให้พนักงานแก้ที่เคาน์เตอร์
    if v_prof.birthday is not null and v_prof.birthday <> p_birthday then raise exception 'BIRTHDAY_LOCKED'; end if;
    update public.member_profiles set birthday = p_birthday where customer_id = v_c;
  end if;
  if coalesce(p_accept_privacy, false) and v_prof.privacy_accepted_at is null then
    update public.member_profiles set privacy_accepted_at = now() where customer_id = v_c;
  end if;
  if p_marketing is not null and p_marketing is distinct from v_prof.marketing_consent then
    update public.member_profiles set marketing_consent = p_marketing, marketing_consent_at = now() where customer_id = v_c;
  end if;
  return public.liff_get_member(p_line_user_id);
end $$;

create or replace function public.liff_unlink(p_line_user_id text) returns void
language plpgsql security definer set search_path = public as $$
declare v_c uuid := public._customer_of_line(p_line_user_id);
begin
  if v_c is null then raise exception 'MEMBER_NOT_FOUND'; end if;
  update public.customer_line_links set unlinked_at = now(), unlink_reason = 'user'
   where customer_id = v_c and unlinked_at is null;
  perform public._event(v_c, 'line_unlinked', gen_random_uuid()::text, jsonb_build_object('by', 'member'));
end $$;

-- แลกแต้มเป็นคูปอง (Point Exchange): ล็อกโปรไฟล์ → ตรวจเงื่อนไข → หักแต้ม → ออกคูปอง ใน transaction เดียว
create or replace function public.liff_claim_reward(p_line_user_id text, p_template uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_c uuid := public._customer_of_line(p_line_user_id);
  t public.coupon_templates;
  v_set public.loyalty_settings;
  v_prof public.member_profiles;
  v_led uuid;
  v_coupon uuid;
  v_cur_sort integer;
  v_min_sort integer;
  v_exists uuid;
begin
  if v_c is null then raise exception 'MEMBER_NOT_FOUND'; end if;
  if p_key is null or length(btrim(p_key)) < 8 or length(p_key) > 100 then raise exception 'INVALID_INPUT: key'; end if;
  select * into v_set from public.loyalty_settings;
  if not v_set.membership_enabled or not v_set.points_enabled then raise exception 'POINTS_DISABLED'; end if;

  -- ส่งซ้ำด้วย key เดิม → คืนผลเดิม
  select id into v_exists from public.member_coupons where customer_id = v_c and dedupe_key = 'claim:' || p_key;
  if found then
    return jsonb_build_object('coupon_id', v_exists, 'duplicate', true);
  end if;

  select * into t from public.coupon_templates where id = p_template for update;      -- ล็อกกัน quantity_limit ทะลุ
  if not found or not t.active or t.point_cost is null then raise exception 'TEMPLATE_NOT_FOUND'; end if;
  if t.claim_start_at is not null and now() < t.claim_start_at then raise exception 'CLAIM_NOT_STARTED'; end if;
  if t.claim_end_at is not null and now() > t.claim_end_at then raise exception 'CLAIM_ENDED'; end if;
  if t.quantity_limit is not null and (select count(*) from public.member_coupons where template_id = t.id) >= t.quantity_limit then
    raise exception 'QUANTITY_EXCEEDED';
  end if;
  select * into v_prof from public.member_profiles where customer_id = v_c for update;
  if t.min_tier_id is not null then
    select sort_order into v_cur_sort from public.membership_tiers where id = v_prof.tier_id;
    select sort_order into v_min_sort from public.membership_tiers where id = t.min_tier_id;
    if coalesce(v_cur_sort, 0) < v_min_sort then raise exception 'COUPON_TIER_NOT_ELIGIBLE'; end if;
  end if;
  if v_prof.points_balance < t.point_cost then raise exception 'INSUFFICIENT_POINTS'; end if;

  v_led := public._ledger_post(v_c, 'points', 'REDEEM', -t.point_cost, 'claim:' || p_key, null, null, t.title);
  if v_led is null then
    raise exception 'DUPLICATE_REQUEST';
  end if;
  v_coupon := public._issue_coupon(v_c, t.id, t.source, t.title, t.description, t.discount_id,
                                   coalesce(t.expire_at, now() + make_interval(days => t.expire_days)), 'claim:' || p_key);
  perform public._event(v_c, 'reward_redeemed', v_led::text, jsonb_build_object('title', t.title, 'points', t.point_cost));
  perform public._notify(v_c, 'transactional', 'points_redeemed', 'redeem:' || v_led::text,
                         jsonb_build_object('title', t.title, 'points', t.point_cost));
  return jsonb_build_object('coupon_id', v_coupon, 'duplicate', false);
end $$;

-- Claim QR: สมัคร (join) / ผูก LINE กับลูกค้าเดิม (link) / รับแต้มย้อนหลังของออเดอร์ (claim)
-- ถ้ายังไม่เป็นสมาชิกและไม่ส่งข้อมูลสมัคร → REGISTRATION_REQUIRED (ไม่ใช้ token; LIFF แสดงฟอร์มแล้วเรียกซ้ำ)
create or replace function public.claim_consume(
  p_token_hash text, p_line_user_id text, p_line_name text, p_line_picture text,
  p_name text, p_phone text, p_birthday date, p_privacy boolean, p_marketing boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cl public.membership_claims;
  v_set public.loyalty_settings;
  v_c uuid;
  o public.orders;
  v_res jsonb := '{}'::jsonb;
  v_registered boolean := false;
begin
  select * into v_set from public.loyalty_settings;
  if not v_set.membership_enabled then raise exception 'MEMBERSHIP_DISABLED'; end if;
  select * into cl from public.membership_claims where token_hash = p_token_hash for update;
  if not found then raise exception 'CLAIM_INVALID'; end if;
  if cl.used_at is not null then raise exception 'CLAIM_USED'; end if;
  if cl.expires_at <= now() then raise exception 'CLAIM_EXPIRED'; end if;

  v_c := public._customer_of_line(p_line_user_id);

  if cl.purpose = 'link' then
    if v_c is not null and v_c <> cl.customer_id then raise exception 'LINE_ALREADY_LINKED'; end if;
    if v_c is null then
      if exists (select 1 from public.customer_line_links where customer_id = cl.customer_id and unlinked_at is null) then
        raise exception 'ALREADY_LINKED';
      end if;
      insert into public.customer_line_links(customer_id, line_user_id, display_name, picture_url)
      values (cl.customer_id, p_line_user_id, left(p_line_name, 160), p_line_picture);
      perform public._event(cl.customer_id, 'line_linked', 'line:' || p_line_user_id, '{}'::jsonb);
      update public.member_profiles set phone_verified_at = coalesce(phone_verified_at, now()) where customer_id = cl.customer_id;
    end if;
    v_c := cl.customer_id;
  else
    if v_c is null then
      if p_name is null then raise exception 'REGISTRATION_REQUIRED'; end if;
      v_c := public._register_member(p_name, p_phone, p_birthday, p_privacy, p_marketing,
                                     case when cl.purpose = 'claim' then 'claim' else 'liff' end,
                                     p_line_user_id, p_line_name, p_line_picture);
      v_registered := true;
    end if;
    if cl.purpose = 'claim' then
      select * into o from public.orders where id = cl.order_id;
      if o.customer_id is not null or exists (select 1 from public.member_order_links where order_id = cl.order_id) then
        raise exception 'ORDER_HAS_MEMBER';
      end if;
      if o.payment_status <> 'paid' then raise exception 'ORDER_NOT_CLAIMABLE'; end if;
      if o.created_at <= now() - make_interval(hours => v_set.claim_order_window_hours) then
        raise exception 'CLAIM_WINDOW_PASSED';
      end if;
      v_res := public._member_process_order(cl.order_id, v_c, 'claim');
    end if;
  end if;
  update public.membership_claims set used_at = now(), used_by_line = p_line_user_id where id = cl.id;
  return jsonb_build_object('purpose', cl.purpose, 'registered', v_registered, 'result', v_res,
                            'member', public.liff_get_member(p_line_user_id));
end $$;

-- ---------------------------------------------------------------------
-- Outbox: ดึงงานส่ง / บันทึกผล (เรียกจากเซิร์ฟเวอร์ที่มี LINE token)
-- ---------------------------------------------------------------------
create or replace function public.outbox_claim(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_rows jsonb;
begin
  update public.notification_outbox set status = 'pending'
   where status = 'sending' and updated_at < now() - interval '10 minutes';     -- คืนงานที่ค้างจากเครื่องที่ล้ม
  update public.notification_outbox o
     set status = 'skipped', skip_reason = 'NO_LINE'
   where o.status = 'pending' and o.next_attempt_at <= now()
     and not exists (select 1 from public.customer_line_links k where k.customer_id = o.customer_id and k.unlinked_at is null);
  with c as (
    select id from public.notification_outbox
     where status = 'pending' and next_attempt_at <= now()
     order by category desc, created_at          -- transactional ก่อน marketing
     for update skip locked
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
  ), u as (
    update public.notification_outbox o set status = 'sending', attempts = o.attempts + 1
      from c where o.id = c.id returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', u.id, 'category', u.category, 'event_type', u.event_type, 'payload', u.payload, 'attempts', u.attempts,
           'line_user_id', (select k.line_user_id from public.customer_line_links k where k.customer_id = u.customer_id and k.unlinked_at is null),
           'member_name', (select c2.name from public.customers c2 where c2.id = u.customer_id))), '[]'::jsonb)
    into v_rows from u;
  return v_rows;
end $$;

create or replace function public.outbox_complete(p_id uuid, p_ok boolean, p_error text default null, p_retryable boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
declare o public.notification_outbox;
begin
  select * into o from public.notification_outbox where id = p_id for update;
  if not found then return; end if;
  if p_ok then
    update public.notification_outbox set status = 'sent', sent_at = now(), last_error = null where id = p_id;
  elsif p_retryable and o.attempts < 5 then
    update public.notification_outbox
       set status = 'pending', last_error = left(p_error, 300),
           next_attempt_at = now() + make_interval(mins => (power(2, o.attempts))::integer)
     where id = p_id;
  else
    update public.notification_outbox set status = 'failed', last_error = left(p_error, 300) where id = p_id;
  end if;
end $$;

-- งานตามเวลา (เรียกจาก cron): ตั้งคูปองหมดอายุ, วันเกิด, Come Back, เตือนคูปองใกล้หมดอายุ
create or replace function public.membership_enqueue_scheduled() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_set public.loyalty_settings;
  v_today date := public.bkk_today();
  r record;
  v_expired integer; v_birthday integer := 0; v_comeback integer := 0; v_expiring integer := 0; v_recon integer;
begin
  select * into v_set from public.loyalty_settings;
  if not v_set.membership_enabled then
    return jsonb_build_object('skipped', 'DISABLED');
  end if;
  update public.member_coupons set status = 'expired' where status = 'unused' and expires_at <= now();
  get diagnostics v_expired = row_count;
  v_recon := public.membership_reconcile_internal(3);

  if v_set.birthday_coupon_template_id is not null then
    for r in
      select p.customer_id from public.member_profiles p join public.customers c on c.id = p.customer_id
       where c.active and p.birthday is not null
         and extract(month from p.birthday) = extract(month from v_today)
         and extract(day from p.birthday) = extract(day from v_today)
    loop
      if public._issue_from_template(r.customer_id, v_set.birthday_coupon_template_id, 'birthday:' || extract(year from v_today)::text) is not null then
        v_birthday := v_birthday + 1;
        perform public._event(r.customer_id, 'birthday_reward', extract(year from v_today)::text, '{}'::jsonb);
      end if;
    end loop;
  end if;

  if v_set.comeback_days is not null then
    for r in
      select p.customer_id, p.last_purchase_at from public.member_profiles p join public.customers c on c.id = p.customer_id
       where c.active and p.marketing_consent and p.last_purchase_at is not null
         and p.last_purchase_at < now() - make_interval(days => v_set.comeback_days)
    loop
      perform public._notify(r.customer_id, 'marketing', 'comeback',
                             'comeback:' || r.customer_id || ':' || (r.last_purchase_at at time zone 'Asia/Bangkok')::date,
                             jsonb_build_object('days', v_set.comeback_days));
      v_comeback := v_comeback + 1;
    end loop;
  end if;

  for r in
    select k.id, k.customer_id, k.title, k.expires_at from public.member_coupons k
     where k.status = 'unused' and k.expires_at > now() and k.expires_at <= now() + interval '3 days'
  loop
    perform public._notify(r.customer_id, 'marketing', 'coupon_expiring', 'coupon-exp:' || r.id,
                           jsonb_build_object('title', r.title, 'expires_at', r.expires_at));
    v_expiring := v_expiring + 1;
  end loop;

  return jsonb_build_object('expired', v_expired, 'reconciled', v_recon, 'birthday', v_birthday,
                            'comeback_candidates', v_comeback, 'expiring_candidates', v_expiring);
end $$;

-- ---------------------------------------------------------------------
-- นำเข้าสมาชิก/คูปองจาก LINE OA เดิม (service_role; ไม่รันอัตโนมัติ — ดู docs/MEMBERSHIP.md)
-- ---------------------------------------------------------------------
create or replace function public.import_line_oa_member(
  p_legacy_uid text, p_line_user_id text, p_name text, p_phone text, p_birthday date,
  p_current_stamps integer, p_total_stamps integer, p_joined_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_c uuid;
  v_phone text := public._norm_phone(p_phone);
begin
  select customer_id into v_c from public.member_profiles where legacy_member_uid = p_legacy_uid;
  if found then
    return v_c;                                         -- นำเข้าซ้ำได้ ไม่สร้างซ้ำ
  end if;
  if v_phone is not null and (v_phone !~ '^0[0-9]{8,9}$' or exists (select 1 from public.member_profiles where phone_norm = v_phone)) then
    v_phone := null;                                    -- เบอร์ไม่ถูกต้อง/ซ้ำ: นำเข้าโดยไม่ใส่เบอร์ (ให้สมาชิกกรอกใหม่)
  end if;
  insert into public.customers(name, phone) values (coalesce(nullif(btrim(p_name), ''), 'สมาชิก'), v_phone) returning id into v_c;
  perform public._member_ensure_profile(v_c, 'import', v_phone);
  update public.member_profiles
     set legacy_member_uid = p_legacy_uid, birthday = p_birthday, joined_at = coalesce(p_joined_at, joined_at)
   where customer_id = v_c;
  if coalesce(p_current_stamps, 0) > 0 then
    perform public._ledger_post(v_c, 'stamps', 'ADMIN_ADJUSTMENT', p_current_stamps, 'import:' || p_legacy_uid || ':stamps',
                                null, null, 'import from LINE OA');
  end if;
  update public.member_profiles set stamps_lifetime = greatest(coalesce(p_total_stamps, 0), stamps_lifetime) where customer_id = v_c;
  if p_line_user_id is not null and p_line_user_id <> '' then
    insert into public.customer_line_links(customer_id, line_user_id) values (v_c, p_line_user_id)
    on conflict do nothing;
  end if;
  return v_c;
end $$;

create or replace function public.import_line_oa_coupon(
  p_legacy_uid text, p_code text, p_source text, p_title text, p_description text,
  p_status text, p_issued_at timestamptz, p_expires_at timestamptz, p_used_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_id uuid;
begin
  select customer_id into v_c from public.member_profiles where legacy_member_uid = p_legacy_uid;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  if p_status not in ('unused','used','expired','cancelled') then raise exception 'INVALID_INPUT: status'; end if;
  if p_status = 'used' and p_used_at is null then raise exception 'INVALID_INPUT: used_at'; end if;
  select id into v_id from public.member_coupons where customer_id = v_c and dedupe_key = 'import:' || p_code;
  if found then return v_id; end if;
  insert into public.member_coupons(code, customer_id, source, title, description, status, issued_at, expires_at,
                                    used_at, note, dedupe_key)
  values (case when p_code ~ '^[A-Z0-9]{12}$' then p_code else upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)) end,
          v_c, coalesce(p_source, 'manual'), p_title, p_description, p_status,
          coalesce(p_issued_at, now()), p_expires_at, case when p_status = 'used' then p_used_at end,
          'imported from LINE OA', 'import:' || p_code)
  returning id into v_id;
  return v_id;
end $$;

-- =====================================================================
-- RLS + สิทธิ์
-- =====================================================================
alter table public.loyalty_settings    enable row level security;
alter table public.membership_tiers    enable row level security;
alter table public.coupon_templates    enable row level security;
alter table public.member_profiles     enable row level security;
alter table public.customer_line_links enable row level security;
alter table public.member_ledger       enable row level security;
alter table public.member_order_links  enable row level security;
alter table public.member_events       enable row level security;
alter table public.member_tier_history enable row level security;
alter table public.member_coupons      enable row level security;
alter table public.membership_claims   enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.chat_keywords       enable row level security;

create policy loyalty_settings_select on public.loyalty_settings for select to authenticated
  using (public.auth_employee_id() is not null);
create policy loyalty_settings_update on public.loyalty_settings for update to authenticated
  using (public.has_role(array['owner'])) with check (public.has_role(array['owner']));
create policy membership_tiers_select on public.membership_tiers for select to authenticated
  using (public.auth_employee_id() is not null);
create policy membership_tiers_update on public.membership_tiers for update to authenticated
  using (public.has_role(array['owner'])) with check (public.has_role(array['owner']));
create policy coupon_templates_select on public.coupon_templates for select to authenticated
  using (public.auth_employee_id() is not null);
create policy coupon_templates_insert on public.coupon_templates for insert to authenticated
  with check (public.has_role(array['owner','manager']));
create policy coupon_templates_update on public.coupon_templates for update to authenticated
  using (public.has_role(array['owner','manager'])) with check (public.has_role(array['owner','manager']));
create policy chat_keywords_select on public.chat_keywords for select to authenticated
  using (public.has_role(array['owner','manager']));
create policy chat_keywords_insert on public.chat_keywords for insert to authenticated
  with check (public.has_role(array['owner','manager']));
create policy chat_keywords_update on public.chat_keywords for update to authenticated
  using (public.has_role(array['owner','manager'])) with check (public.has_role(array['owner','manager']));
create policy chat_keywords_delete on public.chat_keywords for delete to authenticated
  using (public.has_role(array['owner','manager']));

-- ข้อมูลสมาชิก: ผู้จัดการขึ้นไปอ่านตรงได้; แคชเชียร์ผ่านฟังก์ชัน pos_* เท่านั้น; membership_claims ไม่มี policy (ฟังก์ชันเท่านั้น)
create policy member_profiles_select on public.member_profiles for select to authenticated using (public.has_role(array['owner','manager']));
create policy customer_line_links_select on public.customer_line_links for select to authenticated using (public.has_role(array['owner','manager']));
create policy member_ledger_select on public.member_ledger for select to authenticated using (public.has_role(array['owner','manager']));
create policy member_order_links_select on public.member_order_links for select to authenticated using (public.has_role(array['owner','manager']));
create policy member_events_select on public.member_events for select to authenticated using (public.has_role(array['owner','manager']));
create policy member_tier_history_select on public.member_tier_history for select to authenticated using (public.has_role(array['owner','manager']));
create policy member_coupons_select on public.member_coupons for select to authenticated using (public.has_role(array['owner','manager']));
create policy notification_outbox_select on public.notification_outbox for select to authenticated using (public.has_role(array['owner','manager']));

revoke all on public.loyalty_settings, public.membership_tiers, public.coupon_templates, public.member_profiles,
              public.customer_line_links, public.member_ledger, public.member_order_links, public.member_events,
              public.member_tier_history, public.member_coupons, public.membership_claims,
              public.notification_outbox, public.chat_keywords from anon;
revoke all on public.membership_claims from authenticated;
revoke insert, update, delete, truncate on public.member_profiles, public.customer_line_links, public.member_ledger,
              public.member_order_links, public.member_events, public.member_tier_history, public.member_coupons,
              public.notification_outbox from authenticated;
revoke insert, delete, truncate on public.loyalty_settings, public.membership_tiers from authenticated;
revoke delete, truncate on public.coupon_templates from authenticated;
revoke truncate on public.chat_keywords from authenticated;
revoke usage, select on sequence public.member_no_seq from anon, authenticated;

-- ฟังก์ชัน: ปิดทั้งหมดก่อน แล้วเปิดเฉพาะที่จำเป็น
revoke execute on function
  public._norm_phone(text), public._base_tier(), public._tier_for_spend(bigint), public._rolling_spend(uuid),
  public._event(uuid, text, text, jsonb), public._notify(uuid, text, text, text, jsonb),
  public._ledger_post(uuid, text, text, integer, text, uuid, uuid, text, uuid, uuid),
  public._member_ensure_profile(uuid, text, text), public._member_recompute_tier(uuid, text, uuid),
  public._issue_coupon(uuid, uuid, text, text, text, uuid, timestamptz, text),
  public._issue_from_template(uuid, uuid, text), public._earn_amounts(integer, integer, integer),
  public._stamp_qty_of_order(uuid), public._member_process_order(uuid, uuid, text),
  public.payments_member_process(), public.refunds_member_reverse(), public.queue_ready_notify(),
  public.member_coupons_guard(), public._member_card(uuid), public._tier_progress(uuid),
  public._register_member(text, text, date, boolean, boolean, text, text, text, text),
  public._customer_of_line(text), public.membership_reconcile_internal(integer)
  from public, anon, authenticated;

revoke execute on function
  public.pos_find_member(text), public.pos_member_by_qr_ref(text), public.pos_member_summary(uuid, jsonb, integer, integer),
  public.pos_register_member(text, text, date, boolean, boolean, uuid), public.pos_order_membership(uuid),
  public.pos_create_claim(text, text, uuid, uuid),
  public.checkout_member_order(uuid, uuid, jsonb, uuid, text, integer, text, uuid, text, uuid),
  public.redeem_member_coupon(uuid, text), public.cancel_member_coupon(uuid, text), public.issue_manual_coupon(uuid, uuid, text),
  public.member_adjust_points(uuid, text, integer, text, text), public.pos_unlink_line(uuid, text),
  public.member_rotate_qr(uuid), public.pos_member_detail(uuid), public.members_overview(date, date),
  public.membership_reconcile(integer)
  from public, anon;
grant execute on function
  public.pos_find_member(text), public.pos_member_by_qr_ref(text), public.pos_member_summary(uuid, jsonb, integer, integer),
  public.pos_register_member(text, text, date, boolean, boolean, uuid), public.pos_order_membership(uuid),
  public.pos_create_claim(text, text, uuid, uuid),
  public.checkout_member_order(uuid, uuid, jsonb, uuid, text, integer, text, uuid, text, uuid),
  public.redeem_member_coupon(uuid, text), public.cancel_member_coupon(uuid, text), public.issue_manual_coupon(uuid, uuid, text),
  public.member_adjust_points(uuid, text, integer, text, text), public.pos_unlink_line(uuid, text),
  public.member_rotate_qr(uuid), public.pos_member_detail(uuid), public.members_overview(date, date),
  public.membership_reconcile(integer)
  to authenticated;

-- กลุ่ม LIFF/LINE/cron: service_role เท่านั้น
revoke execute on function
  public.liff_get_member(text), public.liff_member_qr_ref(text), public.liff_section(text, text, integer),
  public.liff_register(text, text, text, text, text, date, boolean, boolean),
  public.liff_update_profile(text, text, date, boolean, boolean), public.liff_unlink(text),
  public.liff_claim_reward(text, uuid, text),
  public.claim_consume(text, text, text, text, text, text, date, boolean, boolean),
  public.outbox_claim(integer), public.outbox_complete(uuid, boolean, text, boolean),
  public.membership_enqueue_scheduled(),
  public.import_line_oa_member(text, text, text, text, date, integer, integer, timestamptz),
  public.import_line_oa_coupon(text, text, text, text, text, text, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.liff_get_member(text), public.liff_member_qr_ref(text), public.liff_section(text, text, integer),
  public.liff_register(text, text, text, text, text, date, boolean, boolean),
  public.liff_update_profile(text, text, date, boolean, boolean), public.liff_unlink(text),
  public.liff_claim_reward(text, uuid, text),
  public.claim_consume(text, text, text, text, text, text, date, boolean, boolean),
  public.outbox_claim(integer), public.outbox_complete(uuid, boolean, text, boolean),
  public.membership_enqueue_scheduled(),
  public.import_line_oa_member(text, text, text, text, date, integer, integer, timestamptz),
  public.import_line_oa_coupon(text, text, text, text, text, text, timestamptz, timestamptz, timestamptz)
  to service_role;
