-- =====================================================================
-- ทดสอบ 0004: คิว / สถานี / รอบอบ / หน้าลูกค้า / สิทธิ์
-- รันต่อจาก financial.test.sql (ใช้ผู้ใช้, กะที่เปิดอยู่, ราคาสินค้าที่ไฟล์นั้นตั้งไว้)
-- แต่ละหัวข้ออ้างอิงเกณฑ์ข้อที่ตรวจใน context.md (หัวข้อ "Phase 3")
-- =====================================================================

create function t.put(p_name text, p_id uuid) returns void language sql as
$$ insert into t.ids values (p_name, p_id) on conflict (name) do update set id = excluded.id $$;

create function t.call(p_user text, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform t.login(p_user);
  execute p_sql into v;
  perform t.logout();
  return v;
end $$;

create function t.qs(p_order uuid) returns text language sql stable as
$$ select status from public.order_queues where order_id = p_order $$;
create function t.qv(p_order uuid) returns integer language sql stable as
$$ select version from public.order_queues where order_id = p_order $$;
create function t.qno(p_order uuid) returns integer language sql stable as
$$ select queue_no from public.order_queues where order_id = p_order $$;
create function t.station(p_order uuid, p_station text) returns text language sql stable as
$$ select public._station_status((select id from public.order_queues where order_id = p_order), p_station) $$;
create function t.ready_qty(p_order uuid, p_product text) returns integer language sql stable as
$$ select ip.ready_quantity from public.item_preparations ip where ip.order_id = p_order and ip.product_name = p_product $$;
create function t.nqueues() returns bigint language sql stable as $$ select count(*) from public.order_queues $$;

create function t.cakes(p_user text, p_name text, p_qty integer) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := t.checkout(p_user, gen_random_uuid(), jsonb_build_array(t.item(p_name, p_qty)), null, 'cash', 10000000);
  return v;
end $$;

-- =====================================================================
-- Q0. เตรียม: เปิดขาย, ปิดคิวค้างจากชุดทดสอบการเงิน (ผ่านปุ่ม DONE เดิม = ทดสอบการซิงก์ด้วย)
-- =====================================================================
do $$
begin
  perform t.as('owner', 'update public.settings set sales_enabled = true');
  update public.orders set prep_status = 'done' where prep_status = 'preparing';   -- ปุ่ม DONE เดิม
  perform t.n('Q0 ไม่มีคิวค้างหลังปิดงานเดิม',
              (select count(*) from public.order_queues where status in ('queued','preparing','ready')), 0);
  perform t.n('Q0 ค่าเริ่มต้นความจุรอบ = 22', (select batch_capacity from public.production_settings), 22);
  perform t.s('Q0 หมวดเค้ก → สถานี cake',
              (select cs.station from public.category_stations cs join public.categories c on c.id = cs.category_id
                where c.name = 'Basque Burnt Cheesecake'), 'cake');
  perform t.s('Q0 หมวดเครื่องดื่ม → สถานี drink',
              (select cs.station from public.category_stations cs join public.categories c on c.id = cs.category_id
                where c.name = 'Matcha & Tea'), 'drink');
end $$;

-- =====================================================================
-- Q1-Q4  คิวหลังชำระเงิน: ล้มเหลว=ไม่มีคิว, สำเร็จ=1 คิว, ส่งซ้ำ=ไม่ซ้ำ, เลขไม่ซ้ำ, token
-- =====================================================================
do $$
declare
  v_key uuid := gen_random_uuid(); v_o uuid; v_o2 uuid; v_before bigint; v_cnt_before integer; v_a uuid; v_b uuid;
begin
  v_before := t.nqueues();
  select coalesce(last_no, 0) into v_cnt_before from public.queue_counters where business_date = public.bkk_today();

  -- 1) ชำระไม่สำเร็จ (เงินไม่พอ) → ไม่มีคิว และเลขคิวไม่ถูกใช้
  perform t.fails('Q1 เงินไม่พอ → ชำระล้มเหลว', 'cashier',
    format('select t.try_checkout(jsonb_build_array(t.item(%L, 1)), null, %L, 100)', 'Original', 'cash'), 'INSUFFICIENT_PAYMENT');
  perform t.n('Q1 ชำระล้มเหลว → ไม่มีคิวเพิ่ม', t.nqueues(), v_before);
  perform t.n('Q1 ชำระล้มเหลว → ตัวนับคิวไม่เดิน',
              coalesce((select last_no from public.queue_counters where business_date = public.bkk_today()), 0), v_cnt_before);

  -- 2) ชำระสำเร็จ (เค้ก 2 + เครื่องดื่ม 1) → 1 คิว, แยกสถานี
  v_o := t.checkout('cashier', v_key, jsonb_build_array(t.item('Original', 2), t.item('Apple Tea', 1, 'Matcha & Tea')), null, 'cash', 50000);
  perform t.put('oA', v_o);
  perform t.n('Q2 ชำระสำเร็จ → มี 1 คิวใหม่', t.nqueues(), v_before + 1);
  perform t.n('Q2 ออเดอร์มีคิวเดียว', (select count(*) from public.order_queues where order_id = v_o), 1);
  perform t.s('Q2 สถานะเริ่มต้น queued', t.qs(v_o), 'queued');
  perform t.n('Q2 เลขคิว = ตัวนับ+1', t.qno(v_o), v_cnt_before + 1);
  perform t.s('Q2 เค้ก → สถานี cake',
    (select station from public.item_preparations where order_id = v_o and product_name = 'Original'), 'cake');
  perform t.s('Q2 เครื่องดื่ม → สถานี drink',
    (select station from public.item_preparations where order_id = v_o and product_name = 'Apple Tea'), 'drink');
  perform t.n('Q2 จำนวนเค้ก = 2',
    (select quantity from public.item_preparations where order_id = v_o and station = 'cake'), 2);
  perform t.n('Q2 token ยาว 64 hex', (select count(*) from public.order_queues where order_id = v_o and public_token ~ '^[0-9a-f]{64}$'), 1);

  -- 3) ส่ง key เดิมซ้ำ (retry/กดซ้ำ) → ออเดอร์เดิม ไม่มีคิวเพิ่ม
  v_o2 := t.checkout('cashier', v_key, jsonb_build_array(t.item('Original', 2), t.item('Apple Tea', 1, 'Matcha & Tea')), null, 'cash', 50000);
  perform t.s('Q3 ส่ง key เดิม → ออเดอร์เดิม', v_o2::text, v_o::text);
  perform t.n('Q3 ส่ง key เดิม → ยังมีคิวเพิ่มแค่ 1', t.nqueues(), v_before + 1);
  perform t.n('Q3 ensure_order_queue ซ้ำ ไม่สร้างใหม่',
    (select (t.call('cashier', format('select public.ensure_order_queue(%L)', v_o))->>'queue_no')::int), t.qno(v_o));
  perform t.n('Q3 ensure ซ้ำแล้วยังมี 1 คิว', (select count(*) from public.order_queues where order_id = v_o), 1);
  perform t.n('Q3 ensure ซ้ำแล้วมี 2 รายการงาน', (select count(*) from public.item_preparations where order_id = v_o), 2);

  -- 4) เลขคิวต่อเนื่อง ไม่ซ้ำ
  v_a := t.cakes('cashier', 'Original', 1); v_b := t.cakes('cashier', 'Original', 1);
  perform t.n('Q4 เลขคิวถัดไปเพิ่มทีละ 1', t.qno(v_b) - t.qno(v_a), 1);
  perform t.n('Q4 เลขคิวในวันเดียวกันไม่ซ้ำ',
    (select count(*) - count(distinct queue_no) from public.order_queues where business_date = public.bkk_today()), 0);
  perform t.n('Q4 token ไม่ซ้ำกัน', (select count(*) - count(distinct public_token) from public.order_queues), 0);
  perform t.put('oB1', v_a); perform t.put('oB2', v_b);
end $$;

-- =====================================================================
-- Q5-Q9  สถานี: ทีละสถานี, รวมเป็น ready เมื่อครบ, ส่งมอบชัดเจน, กดซ้ำ, stale
-- =====================================================================
do $$
declare
  v_o uuid := t.id('oA'); r jsonb; v_ver integer;
begin
  -- ยังไม่เริ่ม
  perform t.s('Q5 เริ่มต้น cake=queued', t.station(v_o, 'cake'), 'queued');
  -- เครื่องดื่มเริ่มทำ → คิว preparing
  r := t.call('cashier', format('select public.set_station_status(%L, %L, %L)', v_o, 'drink', 'preparing'));
  perform t.s('Q5 drink preparing → คิว preparing', t.qs(v_o), 'preparing');
  perform t.s('Q5 ผลลัพธ์ changed=true', r->>'changed', 'true');

  -- เค้กกดเริ่มเองไม่ได้ (ต้องผ่านรอบอบ)
  perform t.fails('Q5 เค้กเริ่มผ่านสถานีไม่ได้ ต้องใช้รอบอบ', 'cashier',
    format('select public.set_station_status(%L, %L, %L)', v_o, 'cake', 'preparing'), 'USE_BATCH');

  -- เครื่องดื่มพร้อม แต่เค้กยังไม่พร้อม → ทั้งออเดอร์ยังไม่ ready (เกณฑ์ข้อ 6)
  perform t.as('cashier', format('select public.set_station_status(%L, %L, %L)', v_o, 'drink', 'ready'));
  perform t.s('Q6 drink ready แต่ cake ยัง queued → คิวยัง preparing', t.qs(v_o), 'preparing');
  perform t.s('Q6 drink = ready', t.station(v_o, 'drink'), 'ready');
  perform t.fails('Q6 ยังไม่ ready ส่งมอบไม่ได้ (ไม่ force)', 'cashier',
    format('select public.complete_handover(%L)', v_o), 'NOT_READY');

  -- กดซ้ำ (double-tap): ครั้งที่สอง changed=false ไม่เพิ่ม version (เกณฑ์ข้อ 9)
  v_ver := t.qv(v_o);
  r := t.call('cashier', format('select public.set_station_status(%L, %L, %L, %s)', v_o, 'drink', 'ready', v_ver));
  perform t.s('Q9 กดซ้ำ → changed=false', r->>'changed', 'false');
  perform t.n('Q9 กดซ้ำ → version ไม่เพิ่ม', t.qv(v_o), v_ver);
  -- stale: ส่ง version เก่าไปเปลี่ยนเป็นเป้าหมายใหม่ → ปฏิเสธ
  perform t.fails('Q9 version เก่า → STALE_STATE', 'cashier',
    format('select public.set_station_status(%L, %L, %L, %s)', v_o, 'drink', 'preparing', v_ver - 1), 'STALE_STATE');
  perform t.s('Q9 stale ไม่เปลี่ยนสถานะ', t.station(v_o, 'drink'), 'ready');

  -- เค้กพร้อม (ไม่ผ่านรอบ) → ทุกสถานีพร้อม → ready (เกณฑ์ข้อ 7)
  perform t.as('cashier', format('select public.set_station_status(%L, %L, %L)', v_o, 'cake', 'ready'));
  perform t.s('Q7 ทุกสถานี ready → คิว ready', t.qs(v_o), 'ready');
  perform t.s('Q7 ออเดอร์ยังไม่ done (ต้องส่งมอบชัดเจน)', (select prep_status from public.orders where id = v_o), 'preparing');

  -- ส่งมอบชัดเจน → completed (เกณฑ์ข้อ 8) และซิงก์ orders.prep_status
  r := t.call('cashier', format('select public.complete_handover(%L)', v_o));
  perform t.s('Q8 ส่งมอบ → completed', t.qs(v_o), 'completed');
  perform t.s('Q8 orders.prep_status = done', (select prep_status from public.orders where id = v_o), 'done');
  r := t.call('cashier', format('select public.complete_handover(%L)', v_o));
  perform t.s('Q8 ส่งมอบซ้ำ → changed=false', r->>'changed', 'false');
  perform t.fails('Q8 คิวปิดแล้วเปลี่ยนสถานีไม่ได้', 'cashier',
    format('select public.set_station_status(%L, %L, %L)', v_o, 'drink', 'preparing'), 'QUEUE_CLOSED');

  -- ย้อนการส่งมอบ
  perform t.as('cashier', format('select public.reopen_handover(%L)', v_o));
  perform t.s('Q8 reopen → ready', t.qs(v_o), 'ready');
  perform t.s('Q8 reopen → orders.prep_status = preparing', (select prep_status from public.orders where id = v_o), 'preparing');
  perform t.as('cashier', format('select public.complete_handover(%L)', v_o));

  -- ส่งมอบแบบ force เมื่องานยังไม่ครบ
  perform t.fails('Q8 งานไม่ครบ ส่งมอบแบบปกติไม่ได้', 'cashier',
    format('select public.complete_handover(%L)', t.id('oB1')), 'NOT_READY');
  perform t.as('cashier', format('select public.complete_handover(%L, null, true)', t.id('oB1')));
  perform t.s('Q8 force ส่งมอบ → completed', t.qs(t.id('oB1')), 'completed');
  perform t.s('Q8 force → งานที่ค้างถูกปิด', t.station(t.id('oB1'), 'cake'), 'ready');
end $$;

-- =====================================================================
-- Q10-Q14  รอบอบ: ต้องการ 28 ชิ้น → เสนอ 22 + 6, FIFO, ไม่เกินความจุ, ยืนยัน, เริ่ม/เสร็จเฉพาะส่วนที่จัด
-- =====================================================================
do $$
declare
  v_x uuid; v_y uuid; v_z uuid; v_d uuid; plan jsonb; v_sig text; r jsonb; v_b1 uuid; v_b2 uuid;
begin
  -- ล้างงานค้างที่เหลือ
  update public.orders set prep_status = 'done' where prep_status = 'preparing';
  perform t.n('Q10 ไม่มีงานเค้กค้าง', (select count(*) from public._cake_demand()), 0);

  -- ออเดอร์ X: เค้ก 10, Y: เค้ก 10, Z: เค้ก 8 (รวม 28) + Z มีเครื่องดื่ม 1; D = เครื่องดื่มล้วน
  v_x := t.cakes('cashier', 'Original', 10);
  v_y := t.cakes('cashier', 'Matcha', 10);
  v_z := t.checkout('cashier', gen_random_uuid(),
          jsonb_build_array(t.item('Red Velvet', 8), t.item('Apple Tea', 1, 'Matcha & Tea')), null, 'cash', 10000000);
  v_d := t.checkout('cashier', gen_random_uuid(), jsonb_build_array(t.item('Apple Tea', 2, 'Matcha & Tea')), null, 'cash', 100000);
  perform t.put('oX', v_x); perform t.put('oY', v_y); perform t.put('oZ', v_z); perform t.put('oD', v_d);

  plan := (t.call('cashier', 'select public.get_cake_plan()'))->'batches';
  perform t.n('Q12 ต้องการ 28 ชิ้น → เสนอ 2 รอบ', jsonb_array_length(plan), 2);
  perform t.n('Q12 รอบแรก 22 ชิ้น', (plan->0->>'load_after')::int, 22);
  perform t.n('Q12 รอบสอง 6 ชิ้น', (plan->1->>'load_after')::int, 6);
  perform t.n('Q11 ไม่เกินความจุทุกรอบ', (select count(*) from jsonb_array_elements(plan) b where (b->>'load_after')::int > (b->>'capacity')::int), 0);
  -- FIFO: X(10) → Y(10) → Z(2 ชิ้นแรก) ในรอบ 1
  perform t.n('Q13 FIFO: ออเดอร์แรกอยู่รอบ 1', (plan->0->'items'->0->>'queue_no')::int, t.qno(v_x));
  perform t.n('Q13 FIFO: ชิ้นของ Z แบ่งข้ามรอบ (2 + 6)',
    (select sum((i->>'quantity')::int) from jsonb_array_elements(plan->0->'items') i where (i->>'order_id')::uuid = v_z), 2);
  perform t.n('Q13 FIFO: ส่วนที่เหลือของ Z อยู่รอบ 2',
    (select sum((i->>'quantity')::int) from jsonb_array_elements(plan->1->'items') i where (i->>'order_id')::uuid = v_z), 6);
  perform t.n('Q12 ยังไม่ยืนยัน = ยังไม่มีรอบจริง', (select count(*) from public.production_batches where status = 'planning'), 0);

  -- ยืนยันแผน (signature ผิด → ปฏิเสธ)
  v_sig := (t.call('cashier', 'select public.get_cake_plan()'))->>'signature';
  perform t.fails('Q12 signature ไม่ตรง → PLAN_CHANGED', 'cashier',
    format('select public.confirm_cake_plan(%L)', 'bad'), 'PLAN_CHANGED');
  r := t.call('cashier', format('select public.confirm_cake_plan(%L)', v_sig));
  perform t.n('Q12 ยืนยันแผน → จัดครบ 28 ชิ้น', (r->>'applied')::int, 28);
  perform t.n('Q12 มี 2 รอบ planning', (select count(*) from public.production_batches where status = 'planning'), 2);
  r := t.call('cashier', format('select public.confirm_cake_plan(%L)', v_sig));
  perform t.n('Q12 ยืนยันซ้ำ (กดสองครั้ง) → ไม่จัดซ้ำ', (r->>'applied')::int, 0);
  perform t.n('Q12 หลังยืนยัน ไม่มีงานที่ยังไม่จัดรอบ', (select count(*) from public._cake_demand()), 0);

  select id into v_b1 from public.production_batches where status = 'planning' and business_date = public.bkk_today() order by batch_no limit 1;
  select id into v_b2 from public.production_batches where status = 'planning' and business_date = public.bkk_today() order by batch_no desc limit 1;
  perform t.put('b1', v_b1); perform t.put('b2', v_b2);
  perform t.n('Q12 รอบ 1 โหลด 22', (select sum(quantity) from public.batch_items where batch_id = v_b1), 22);
  perform t.n('Q12 รอบ 2 โหลด 6', (select sum(quantity) from public.batch_items where batch_id = v_b2), 6);

  -- กันเกินความจุ/เกินจำนวนสั่งในระดับฐานข้อมูล (แม้เขียนตรง)
  perform t.fails('Q11 จัดเครื่องดื่มลงรอบอบไม่ได้', 'postgres',
    format($q$ insert into public.batch_items(batch_id, item_preparation_id, quantity)
               select %L, ip.id, 1 from public.item_preparations ip where ip.order_id = %L limit 1 $q$, v_b1, v_d), 'INVALID_STATION');
  perform t.fails('Q11 จัดเค้กเกินจำนวนที่สั่ง → ปฏิเสธ', 'postgres',
    format($q$ update public.batch_items set quantity = quantity + 20 where batch_id = %L and item_preparation_id =
               (select id from public.item_preparations where order_id = %L and station = 'cake') $q$, v_b2, v_z), 'BATCH_CAPACITY_EXCEEDED');
  perform t.fails('Q11 ย้ายเข้ารอบที่เต็ม → ปฏิเสธ', 'cashier',
    format($q$ select public.move_batch_allocation((select bi.id from public.batch_items bi where bi.batch_id = %L limit 1), %L, 3) $q$, v_b2, v_b1),
    'BATCH_CAPACITY_EXCEEDED');

  -- เริ่มอบรอบ 1: เฉพาะเค้กที่จัดในรอบนี้ → preparing; เครื่องดื่มไม่ถูกแตะ
  perform t.as('cashier', format('select public.start_batch(%L)', v_b1));
  perform t.s('Q13 เริ่มรอบ 1 → X cake preparing', t.station(v_x, 'cake'), 'preparing');
  perform t.s('Q13 เริ่มรอบ 1 → Z cake preparing (ได้ 2 ชิ้นในรอบนี้)', t.station(v_z, 'cake'), 'preparing');
  perform t.s('Q13 เริ่มรอบ 1 → เครื่องดื่ม Z ไม่ถูกแตะ', t.station(v_z, 'drink'), 'queued');
  perform t.s('Q13 เริ่มรอบ 1 → ออเดอร์เครื่องดื่มล้วนไม่ถูกแตะ', t.qs(v_d), 'queued');
  r := t.call('cashier', format('select public.start_batch(%L)', v_b1));
  perform t.s('Q13 เริ่มรอบซ้ำ → changed=false', r->>'changed', 'false');
  perform t.fails('Q13 รอบที่เริ่มแล้วแก้แผนไม่ได้', 'cashier',
    format($q$ select public.move_batch_allocation((select bi.id from public.batch_items bi where bi.batch_id = %L limit 1), %L, 1) $q$, v_b1, v_b2),
    'BATCH_LOCKED');
  perform t.fails('Q13 รอบที่ยังไม่เริ่มอบ → complete ไม่ได้', 'cashier',
    format('select public.complete_batch(%L)', v_b2), 'BATCH_NOT_STARTED');

  -- ออเดอร์ใหม่ระหว่างอบรอบ 1: ต้องไม่ถูกยัดเข้ารอบที่กำลังอบ
  perform t.cakes('cashier', 'Original', 3);
  plan := (t.call('cashier', 'select public.get_cake_plan()'))->'batches';
  perform t.n('Q13 ออเดอร์ใหม่เข้ารอบ 2 (ไม่แตะรอบที่กำลังอบ)', jsonb_array_length(plan), 1);
  perform t.n('Q13 รอบที่เสนอคือรอบ planning เดิม (is_new=false)', (plan->0->>'is_new' = 'false')::int, 1);
  perform t.s('Q13 รอบที่เสนอคือ b2', plan->0->>'batch_id', v_b2::text);
  perform t.n('Q13 b2 โหลดหลังเติม = 9', (plan->0->>'load_after')::int, 9);

  -- อบรอบ 1 เสร็จ: เฉพาะจำนวนที่จัดในรอบ 1 พร้อม (เกณฑ์ข้อ 13)
  perform t.as('cashier', format('select public.complete_batch(%L)', v_b1));
  perform t.s('Q13 X (10 ชิ้นครบในรอบ 1) → cake ready', t.station(v_x, 'cake'), 'ready');
  perform t.s('Q13 X ไม่มีเครื่องดื่ม → คิว ready', t.qs(v_x), 'ready');
  perform t.s('Q13 Y → cake ready', t.station(v_y, 'cake'), 'ready');
  perform t.n('Q13 Z พร้อมเพียง 2 จาก 8', t.ready_qty(v_z, 'Red Velvet'), 2);
  perform t.s('Q13 Z ยังไม่ครบ → cake preparing', t.station(v_z, 'cake'), 'preparing');
  perform t.s('Q13 Z ยังไม่ ready (เค้กไม่ครบ + เครื่องดื่มยังไม่ทำ)', t.qs(v_z), 'preparing');
  perform t.s('Q13 เครื่องดื่มของ Z ยังคง queued', t.station(v_z, 'drink'), 'queued');
  perform t.s('Q13 ออเดอร์เครื่องดื่มล้วนยังคง queued', t.qs(v_d), 'queued');
  r := t.call('cashier', format('select public.complete_batch(%L)', v_b1));
  perform t.s('Q13 complete ซ้ำ → changed=false', r->>'changed', 'false');
  perform t.n('Q13 complete ซ้ำ ไม่เพิ่มจำนวนพร้อม', t.ready_qty(v_z, 'Red Velvet'), 2);

  -- รอบ 2: Z ส่วนที่เหลือ 6 + ออเดอร์ 3 ชิ้น
  perform t.as('cashier', format('select public.confirm_cake_plan(%L)', (t.call('cashier', 'select public.get_cake_plan()'))->>'signature'));
  perform t.as('cashier', format('select public.start_batch(%L)', v_b2));
  perform t.as('cashier', format('select public.complete_batch(%L)', v_b2));
  perform t.n('Q13 Z ครบ 8', t.ready_qty(v_z, 'Red Velvet'), 8);
  perform t.s('Q13 Z cake ready แต่เครื่องดื่มยัง queued → คิว preparing', t.qs(v_z), 'preparing');
  perform t.as('cashier', format('select public.set_station_status(%L, %L, %L)', v_z, 'drink', 'preparing'));
  perform t.as('cashier', format('select public.set_station_status(%L, %L, %L)', v_z, 'drink', 'ready'));
  perform t.s('Q7 Z ครบทั้งสองสถานี → ready', t.qs(v_z), 'ready');
  perform t.fails('Q13 ย้อนสถานีเค้กที่เสร็จจากรอบอบไม่ได้', 'cashier',
    format('select public.set_station_status(%L, %L, %L)', v_z, 'cake', 'queued'), 'CAKE_BATCH_COMPLETED');
end $$;

-- =====================================================================
-- Q15  ปรับแผนด้วยมือ + ตั้งค่าความจุ/รสชาติ
-- =====================================================================
do $$
declare v_o1 uuid; v_o2 uuid; plan jsonb; r jsonb; v_b uuid; v_bi uuid; v_load integer;
begin
  update public.orders set prep_status = 'done' where prep_status = 'preparing';
  update public.production_batches set status = 'cancelled' where status = 'planning';   -- ล้างแผนค้าง

  -- ความจุเปลี่ยนได้โดยผู้จัดการ (แคชเชียร์ทำไม่ได้)
  perform t.as('cashier', 'update public.production_settings set batch_capacity = 5 where id');   -- RLS: ไม่มีแถวที่แก้ได้
  perform t.n('Q15 แคชเชียร์แก้ความจุไม่ได้ (ค่าไม่เปลี่ยน)', (select batch_capacity from public.production_settings), 22);
  perform t.as('mgr', 'update public.production_settings set batch_capacity = 20 where id');
  v_o1 := t.cakes('cashier', 'Original', 14); v_o2 := t.cakes('cashier', 'Matcha', 14);
  plan := (t.call('cashier', 'select public.get_cake_plan()'))->'batches';
  perform t.n('Q15 ความจุ 20: ต้องการ 28 → 20 + 8', (plan->0->>'load_after')::int * 100 + (plan->1->>'load_after')::int, 2008);

  -- ไม่ผสมรส: แยกรอบตามรส
  perform t.as('mgr', 'update public.production_settings set mix_flavors = false where id');
  plan := (t.call('cashier', 'select public.get_cake_plan()'))->'batches';
  perform t.n('Q15 ไม่ผสมรส: 2 รอบ (14 + 14)', jsonb_array_length(plan), 2);
  perform t.n('Q15 ไม่ผสมรส: แต่ละรอบมีรสเดียว',
    (select count(*) from jsonb_array_elements(plan) b where (select count(distinct i->>'product_name') from jsonb_array_elements(b->'items') i) > 1), 0);
  perform t.as('mgr', 'update public.production_settings set mix_flavors = true, batch_capacity = 22 where id');

  -- ยืนยัน แล้วถอดบางส่วนออกจากแผน → กลับไปอยู่ในข้อเสนอ
  perform t.as('cashier', format('select public.confirm_cake_plan(%L)', (t.call('cashier', 'select public.get_cake_plan()'))->>'signature'));
  select bi.id, bi.batch_id into v_bi, v_b from public.batch_items bi join public.production_batches b on b.id = bi.batch_id
   where b.status = 'planning' order by b.batch_no, bi.created_at limit 1;
  select sum(quantity) into v_load from public.batch_items where batch_id = v_b;
  perform t.as('cashier', format('select public.move_batch_allocation(%L, null, 2)', v_bi));
  perform t.n('Q15 ถอด 2 ชิ้นออกจากแผน → กลับไปรอจัด', (select coalesce(sum(remaining), 0) from public._cake_demand()), 2);
  perform t.n('Q15 รอบต้นทางลดลง 2', (select sum(quantity) from public.batch_items where batch_id = v_b)::int, v_load - 2);
  perform t.as('cashier', format('select public.cancel_batch(%L)', v_b));
  perform t.s('Q15 ยกเลิกรอบที่ยังไม่เริ่ม → cancelled', (select status from public.production_batches where id = v_b), 'cancelled');
  perform t.n('Q15 ยกเลิกรอบ → งานกลับไปรอจัดใหม่ทั้งหมด', (select count(*) from public.batch_items where batch_id = v_b), 0);
end $$;

-- =====================================================================
-- Q16  คืนเงิน → ยกเลิกคิว; ปุ่ม DONE เดิมยังใช้ได้และซิงก์คิว
-- =====================================================================
do $$
declare v_o uuid; v_o2 uuid; v_total integer;
begin
  update public.orders set prep_status = 'done' where prep_status = 'preparing';
  update public.production_batches set status = 'cancelled' where status = 'planning';

  v_o := t.cakes('cashier', 'Original', 2);
  perform t.as('mgr', format('select public.confirm_cake_plan(%L)', (t.call('mgr', 'select public.get_cake_plan()'))->>'signature'));
  perform t.n('Q16 เค้กถูกจัดลงรอบแล้ว', (select count(*) from public.batch_items bi join public.item_preparations ip on ip.id = bi.item_preparation_id where ip.order_id = v_o), 1);
  select total_satang into v_total from public.orders where id = v_o;
  perform t.as('mgr', format('select public.refund_order(%L, %L, %s, %L, %L, %L)', gen_random_uuid(), v_o, v_total, 'cash', 'ลูกค้ายกเลิก', t.shift()));
  perform t.s('Q16 คืนเงินเต็มจำนวน → คิวยกเลิก', t.qs(v_o), 'cancelled');
  perform t.n('Q16 คิวที่ยกเลิก → ถอดออกจากรอบอบ', (select count(*) from public.batch_items bi join public.item_preparations ip on ip.id = bi.item_preparation_id where ip.order_id = v_o), 0);
  perform t.n('Q16 คิวที่ยกเลิก → ไม่นับเป็นงานเค้กค้าง', (select count(*) from public._cake_demand() d where d.order_id = v_o), 0);

  -- DONE เดิม
  v_o2 := t.cakes('cashier', 'Red Velvet', 1);
  perform t.as('cashier', format('select public.set_order_prep_status(%L, %L)', v_o2, 'done'));
  perform t.s('Q16 DONE เดิม → คิว completed', t.qs(v_o2), 'completed');
  perform t.as('cashier', format('select public.set_order_prep_status(%L, %L)', v_o2, 'preparing'));
  perform t.s('Q16 ย้อนกลับเดิม → คิว ready', t.qs(v_o2), 'ready');
  perform t.s('Q16 ย้อนกลับเดิม → orders = preparing', (select prep_status from public.orders where id = v_o2), 'preparing');
end $$;

-- =====================================================================
-- Q17  หน้าลูกค้า (token) + สิทธิ์ anon/authenticated
-- =====================================================================
do $$
declare
  v_o uuid; v_other uuid; v_tok text; v_otok text; r jsonb; v_tot integer;
begin
  update public.orders set prep_status = 'done' where prep_status = 'preparing';
  v_other := t.cakes('cashier', 'Original', 1);                        -- คิวหน้า
  v_tot := 15800 + (select price_satang from public.products where id = t.pid('Apple Tea', 'Matcha & Tea'));
  v_o := t.checkout('cashier', gen_random_uuid(),
           jsonb_build_array(t.item('Matcha', 2), t.item('Apple Tea', 1, 'Matcha & Tea')), null, 'transfer', v_tot, 'REF-SECRET');
  select public_token into v_tok from public.order_queues where order_id = v_o;
  select public_token into v_otok from public.order_queues where order_id = v_other;

  execute 'set local role anon';
  r := public.get_public_queue(v_tok);
  execute 'reset role';

  perform t.n('Q17 ลูกค้าเห็นเลขคิวของตัวเอง', (r->>'queue_no')::int, t.qno(v_o));
  perform t.n('Q17 คิวก่อนหน้า = 1 (นับเฉพาะที่ยังไม่เสร็จ)', (r->>'ahead')::int, 1);
  perform t.n('Q17 เห็นรายการของตัวเอง 2 รายการ', jsonb_array_length(r->'items'), 2);
  perform t.s('Q17 สถานะรวม queued', r->>'status', 'queued');
  perform t.s('Q17 แยกสถานะเค้ก/เครื่องดื่ม', (r->>'cake_status') || '/' || (r->>'drink_status'), 'queued/queued');
  perform t.s('Q17 ไม่มีเวลารอโดยประมาณ (ร้านไม่ได้ตั้งเวลาอบ)', coalesce(r->>'estimated_wait_minutes', 'null'), 'null');
  perform t.s('Q17 คีย์ที่คืนเป็นชุดที่กำหนดเท่านั้น',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(r) k),
    'ahead,cake_status,created_at,drink_status,estimated_wait_minutes,items,queue_no,shop_name,status,updated_at');
  perform t.s('Q17 รายการไม่มีราคา/ไอดีภายใน',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(r->'items'->0) k), 'addons,name,quantity,station');
  perform t.n('Q17 ไม่รั่ว: ไม่มีข้อมูลชำระเงิน/ผู้ขาย/ยอด',
    (select count(*) from regexp_matches(r::text, 'REF-SECRET|order_id|employee|shift|total|payment|price|phone', 'i')), 0);
  perform t.n('Q17 ไม่รั่ว: ไม่มี token ของคิวอื่น', (select count(*) from regexp_matches(r::text, v_otok)), 0);

  execute 'set local role anon';
  perform t.n('Q17 token ผิด → null', (public.get_public_queue(repeat('0', 64)) is null)::int, 1);
  perform t.n('Q17 token รูปแบบผิด → null', (public.get_public_queue('abc') is null)::int, 1);
  perform t.n('Q17 token ว่าง → null', (public.get_public_queue(null) is null)::int, 1);
  execute 'reset role';

  perform t.fails('Q17 anon อ่านตารางคิวตรงไม่ได้', 'postgres', $q$ set local role anon; select * from public.order_queues $q$, 'permission denied');
  perform t.fails('Q17 anon อ่าน orders ไม่ได้', 'postgres', $q$ set local role anon; select * from public.orders $q$, 'permission denied');
  perform t.fails('Q17 anon อ่าน item_preparations ไม่ได้', 'postgres', $q$ set local role anon; select * from public.item_preparations $q$, 'permission denied');
  perform t.fails('Q17 anon เปลี่ยนสถานะไม่ได้', 'postgres',
    format($q$ set local role anon; select public.set_station_status(%L, 'drink', 'ready') $q$, v_o), 'permission denied');
  perform t.fails('Q17 anon เรียก snapshot ไม่ได้', 'postgres', $q$ set local role anon; select public.get_production_snapshot() $q$, 'permission denied');
  perform t.fails('Q17 authenticated เรียกฟังก์ชันภายในไม่ได้', 'cashier',
    format('select public._complete_queue(%L, null, %L)', (select id from public.order_queues where order_id = v_o), 'x'), 'permission denied');
  perform t.fails('Q17 authenticated เขียนตารางคิวตรงไม่ได้', 'cashier',
    $q$ update public.order_queues set status = 'completed' $q$, 'permission denied');
  perform t.fails('Q17 authenticated ลบรอบอบตรงไม่ได้', 'mgr',
    $q$ delete from public.production_batches $q$, 'permission denied');
  perform t.fails('Q17 ผู้ใช้ที่ไม่ได้รับอนุมัติเรียก snapshot ไม่ได้', 'stranger', $q$ select public.get_production_snapshot() $q$, 'NOT_AUTHENTICATED');

  -- ลิงก์หมดอายุ
  update public.order_queues set created_at = now() - interval '25 hours' where order_id = v_other;
  perform t.n('Q17 ลิงก์เกินเวลา → null', (public.get_public_queue(v_otok) is null)::int, 1);
  update public.order_queues set created_at = now() where order_id = v_other;

  -- เวลารอโดยประมาณ: ตั้งเวลาอบแล้วจึงคำนวณได้
  perform t.as('mgr', 'update public.production_settings set bake_minutes = 15 where id');
  r := public.get_public_queue(v_tok);
  perform t.n('Q17 ตั้งเวลาอบ → มีเวลารอโดยประมาณ', ((r->>'estimated_wait_minutes')::int > 0)::int, 1);
  perform t.as('mgr', 'update public.production_settings set bake_minutes = null where id');

  -- ความคืบหน้าสะท้อนให้ลูกค้า
  perform t.as('cashier', format('select public.set_station_status(%L, %L, %L)', v_o, 'drink', 'ready'));
  r := public.get_public_queue(v_tok);
  perform t.s('Q17 ลูกค้าเห็นเครื่องดื่มพร้อม', r->>'drink_status', 'ready');
  perform t.s('Q17 รวมยัง preparing', r->>'status', 'preparing');
  -- คิวก่อนหน้าส่งมอบแล้ว → ahead ลดลง
  perform t.as('cashier', format('select public.complete_handover(%L, null, true)', v_other));
  perform t.n('Q17 คิวก่อนหน้าเสร็จ → ahead = 0', (public.get_public_queue(v_tok)->>'ahead')::int, 0);
end $$;

-- =====================================================================
-- Q18  การกำหนดสถานีสินค้า (override สินค้า → หมวด → ค่าเริ่มต้น) + RLS ของพนักงาน
-- =====================================================================
do $$
declare v_o uuid;
begin
  update public.orders set prep_status = 'done' where prep_status = 'preparing';
  perform t.fails('Q18 แคชเชียร์แก้การกำหนดสถานีไม่ได้', 'cashier',
    format($q$ insert into public.product_stations(product_id, station) values (%L, 'drink') $q$, t.pid('Red Velvet')), 'new row violates row-level security');
  perform t.as('mgr', format($q$ insert into public.product_stations(product_id, station) values (%L, 'drink') $q$, t.pid('Red Velvet')));
  v_o := t.cakes('cashier', 'Red Velvet', 1);
  perform t.s('Q18 override สินค้า → สถานี drink',
    (select station from public.item_preparations where order_id = v_o), 'drink');
  perform t.as('mgr', format($q$ delete from public.product_stations where product_id = %L $q$, t.pid('Red Velvet')));
  v_o := t.cakes('cashier', 'Red Velvet', 1);
  perform t.s('Q18 ลบ override → กลับไปตามหมวด (cake)',
    (select station from public.item_preparations where order_id = v_o), 'cake');
  -- หมวดที่ไม่ได้กำหนด → ค่าเริ่มต้น
  perform t.as('mgr', format($q$ delete from public.category_stations where category_id = (select id from public.categories where name = 'Matcha & Tea') $q$));
  v_o := t.checkout('cashier', gen_random_uuid(), jsonb_build_array(t.item('Apple Tea', 1, 'Matcha & Tea')), null, 'cash', 10000);
  perform t.s('Q18 หมวดไม่กำหนด → default_station (drink)', (select station from public.item_preparations where order_id = v_o), 'drink');
  perform t.as('mgr', $q$ insert into public.category_stations(category_id, station) select id, 'drink' from public.categories where name = 'Matcha & Tea' $q$);
  -- cashier อ่านคิวของวันนี้ได้ / ไม่เห็นตารางของคนอื่นที่ไม่ใช่ของวันนี้
  perform t.n('Q18 แคชเชียร์อ่านคิวของวันนี้ได้', ((t.call('cashier', 'select to_jsonb((select count(*) from public.order_queues))'))::text::int > 0)::int, 1);
end $$;

-- =====================================================================
-- Q19  คิวพลาดต้องไม่ทำให้การขายล้มเหลว + ซ่อมได้ (idempotent)
-- =====================================================================
create function t.boom() returns trigger language plpgsql as $$ begin raise exception 'simulated failure'; end $$;
do $$
declare v_o uuid; v_snap jsonb; n integer; v_before bigint := t.nqueues(); v_pay_before bigint;
begin
  create trigger t_boom before insert on public.item_preparations for each row execute function t.boom();
  select count(*) into v_pay_before from public.payments;
  v_o := t.checkout('cashier', gen_random_uuid(), jsonb_build_array(t.item('Original', 1)), null, 'cash', 10000);
  drop trigger t_boom on public.item_preparations;

  perform t.n('Q19 สร้างคิวพลาด → การขายยังสำเร็จ (payment บันทึก)', (select count(*) from public.payments), v_pay_before + 1);
  perform t.n('Q19 สร้างคิวพลาด → ไม่มีคิวค้างครึ่งๆ กลางๆ', t.nqueues(), v_before);
  perform t.n('Q19 สร้างคิวพลาด → ไม่เหลือรายการงาน', (select count(*) from public.item_preparations where order_id = v_o), 0);

  v_snap := t.call('cashier', 'select public.get_production_snapshot()');
  perform t.n('Q19 snapshot แจ้งออเดอร์ที่ไม่มีคิว', (v_snap->>'missing_queues')::int, 1);
  n := (t.call('cashier', 'select to_jsonb(public.repair_missing_queues())'))::text::int;
  perform t.n('Q19 ซ่อมคิว → สร้าง 1', n, 1);
  perform t.n('Q19 ออเดอร์มีคิวแล้ว', (select count(*) from public.order_queues where order_id = v_o), 1);
  n := (t.call('cashier', 'select to_jsonb(public.repair_missing_queues())'))::text::int;
  perform t.n('Q19 ซ่อมซ้ำ → ไม่สร้างเพิ่ม (idempotent)', n, 0);
end $$;

-- =====================================================================
-- Q20  snapshot ของ Dashboard: ยอดรวมแยกรส/สถานี, ขนาดข้อมูล, สิทธิ์
-- =====================================================================
do $$
declare v_snap jsonb;
begin
  update public.orders set prep_status = 'done' where prep_status = 'preparing';
  update public.production_batches set status = 'cancelled' where status in ('planning');
  perform t.cakes('cashier', 'Original', 5); perform t.cakes('cashier', 'Original', 2); perform t.cakes('cashier', 'Matcha', 4);
  perform t.checkout('cashier', gen_random_uuid(), jsonb_build_array(t.item('Apple Tea', 3, 'Matcha & Tea')), null, 'cash', 100000);
  v_snap := t.call('mgr', 'select public.get_production_snapshot()');
  perform t.n('Q20 รวมเค้ก Original ที่รอ = 7',
    (select (c->>'waiting')::int from jsonb_array_elements(v_snap->'cake_totals') c where c->>'name' = 'Original'), 7);
  perform t.n('Q20 รวมเค้ก Matcha ที่รอ = 4',
    (select (c->>'waiting')::int from jsonb_array_elements(v_snap->'cake_totals') c where c->>'name' = 'Matcha'), 4);
  perform t.n('Q20 เครื่องดื่ม Apple Tea ที่รอ = 3',
    (select (c->>'waiting')::int from jsonb_array_elements(v_snap->'drink_totals') c where c->>'name' = 'Apple Tea'), 3);
  perform t.n('Q20 จำนวนคิวที่ active = 4', (v_snap->'counts'->>'active_queues')::int, 4);
  perform t.n('Q20 แผนเสนอ 1 รอบ 11 ชิ้น', (v_snap->'plan'->'batches'->0->>'load_after')::int, 11);
  perform t.n('Q20 snapshot เล็ก (< 40KB สำหรับ 4 คิว)', (length(v_snap::text) < 40000)::int, 1);
end $$;

select 'ALL QUEUE SQL ASSERTIONS PASSED' as result;

-- get_cake_load (ตัวเตือนความจุรอบในหน้า POS)
do $$
declare v jsonb;
begin
  v := t.call('cashier', 'select public.get_cake_load()');
  perform t.n('Q21 get_cake_load: ความจุ', (v->>'capacity')::int, 22);
  perform t.n('Q21 get_cake_load: เค้กที่รอ = 11 ชิ้น (จากหัวข้อ Q20)', (v->>'queued_pieces')::int, 11);
  perform t.n('Q21 get_cake_load: ไม่มีรอบที่กำลังอบ', (v->>'baking_pieces')::int, 0);
  perform t.n('Q21 get_cake_load: แยกตามรส 2 รส', jsonb_array_length(v->'by_product'), 2);
  perform t.n('Q21 get_cake_load: Original รอ 7', (select (x->>'waiting')::int from jsonb_array_elements(v->'by_product') x where x->>'name' = 'Original'), 7);
  perform t.n('Q21 get_cake_load: คิวที่ active = 4', (v->>'active_queues')::int, 4);
  perform t.fails('Q21 anon เรียก get_cake_load ไม่ได้', 'postgres', $q$ set local role anon; select public.get_cake_load() $q$, 'permission denied');
end $$;
select 'ALL QUEUE SQL ASSERTIONS PASSED (incl. get_cake_load)' as result;
