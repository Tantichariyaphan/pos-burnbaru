-- Rollback ของ 0004 (ลบเฉพาะของใหม่ที่ 0004 สร้าง) — ไม่แตะ orders/order_items/payments/refunds/shifts ฯลฯ
-- ⚠️ จะลบประวัติคิว/รอบอบทั้งหมด (ไม่ใช่ข้อมูลการเงิน) — สำรองก่อนถ้าต้องการเก็บไว้
-- รันใน SQL Editor ของ Supabase เมื่อจำเป็นเท่านั้น
begin;
drop trigger if exists payments_create_queue_trg on public.payments;
drop trigger if exists orders_refund_cancels_queue_trg on public.orders;
drop trigger if exists orders_prep_status_syncs_queue_trg on public.orders;

do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['order_queues','item_preparations','production_batches','batch_items'] loop
      begin execute format('alter publication supabase_realtime drop table public.%I', t);
      exception when undefined_object then null; end;
    end loop;
  end if;
end $$;

drop function if exists public.get_public_queue(text);
drop function if exists public.get_cake_load();
drop function if exists public.get_production_snapshot();
drop function if exists public.move_batch_allocation(uuid, uuid, integer);
drop function if exists public.cancel_batch(uuid);
drop function if exists public.complete_batch(uuid);
drop function if exists public.start_batch(uuid);
drop function if exists public._touch_queues_of_batch(uuid);
drop function if exists public.confirm_cake_plan(text);
drop function if exists public._plan_lock();
drop function if exists public.get_cake_plan();
drop function if exists public._cake_plan();
drop function if exists public._cake_demand();
drop function if exists public.reopen_handover(uuid, integer);
drop function if exists public.complete_handover(uuid, integer, boolean);
drop function if exists public.set_station_status(uuid, text, text, integer);
drop function if exists public.repair_missing_queues();
drop function if exists public.ensure_order_queue(uuid);
drop function if exists public._lock_queue(uuid);
drop function if exists public._queue_json(public.order_queues, boolean);
drop function if exists public.orders_prep_status_syncs_queue();
drop function if exists public._complete_queue(uuid, uuid, text);
drop function if exists public.orders_refund_cancels_queue();
drop function if exists public._cancel_queue(uuid);
drop function if exists public.payments_create_queue();
drop function if exists public._create_queue(uuid);
drop function if exists public._recompute_queue(uuid);
drop function if exists public._station_status(uuid, text);

drop table if exists public.batch_items;
drop table if exists public.production_batches;
drop table if exists public.item_preparations;
drop table if exists public.order_queues;
drop table if exists public.queue_counters;
drop table if exists public.product_stations;
drop table if exists public.category_stations;
drop table if exists public.production_settings;
drop function if exists public.resolve_station(uuid, text);
drop function if exists public.batch_items_guard();
drop function if exists public.item_preparations_consistency();
commit;
