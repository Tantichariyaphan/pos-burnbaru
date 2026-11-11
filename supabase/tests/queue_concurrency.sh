#!/usr/bin/env bash
# การแข่งกันของหลายเครื่อง (เกณฑ์ข้อ 4, 9, 11, 14) — ใช้ข้อมูลที่ queue.test.sql ทิ้งไว้ (รันหลังไฟล์นั้น)
#   A) checkout 12 ครั้งพร้อมกัน (key ต่างกัน) → เลขคิวไม่ซ้ำ ไม่มีช่องว่างที่ไม่คาดคิด
#   B) กด "พร้อมแล้ว" ซ้ำ 8 ครั้งพร้อมกัน → เปลี่ยนจริงครั้งเดียว version +1
#   C) ยืนยันแผนอบ 2 เครื่องพร้อมกัน + ออเดอร์เข้าใหม่ระหว่างนั้น → ไม่เกินความจุ ไม่จัดซ้ำ
#   D) เริ่ม/จบรอบอบพร้อมกัน → เปลี่ยนจริงครั้งเดียว
set -euo pipefail
URL="$1"
PSQL=(psql "$URL" -X -q -t -A -v ON_ERROR_STOP=1)
OUT=$(mktemp -d)
fail() { echo "❌ $1"; cat "$OUT"/*.err 2>/dev/null | head -5; exit 1; }

"${PSQL[@]}" -c "update public.settings set sales_enabled = true; update public.orders set prep_status = 'done' where prep_status = 'preparing'; update public.production_batches set status = 'cancelled' where status = 'planning';" >/dev/null
SHIFT=$("${PSQL[@]}" -c "select id from public.shifts where status = 'open' limit 1")
CASHIER=$("${PSQL[@]}" -c "select id from public.employees where email = 'cashier@cafe.test'")
prod() { "${PSQL[@]}" -c "select p.id from public.products p join public.categories c on c.id = p.category_id where p.name = '$1' and c.name = '$2'"; }
ORIG=$(prod Original 'Basque Burnt Cheesecake'); APPLE=$(prod 'Apple Tea' 'Matcha & Tea')
as_cashier() { echo "begin; select set_config('request.jwt.claim.sub', '$CASHIER', true); set local role authenticated; $1 commit;"; }
checkout_sql() { as_cashier "select public.checkout_order(gen_random_uuid(), '$SHIFT', '[{\"product_id\":\"$ORIG\",\"quantity\":$1,\"addon_ids\":[]}]'::jsonb, null, 'cash', 100000000, null, null, null);"; }

# ---- A) เลขคิวพร้อมกัน ----
BEFORE=$("${PSQL[@]}" -c "select count(*) from public.order_queues")
for i in $(seq 1 12); do ( "${PSQL[@]}" -c "$(checkout_sql 1)" > "$OUT/a$i.txt" 2> "$OUT/a$i.err" ) & done; wait
AFTER=$("${PSQL[@]}" -c "select count(*) from public.order_queues")
DUP=$("${PSQL[@]}" -c "select count(*) - count(distinct queue_no) from public.order_queues where business_date = public.bkk_today()")
ORPHAN=$("${PSQL[@]}" -c "select count(*) from public.orders o where o.business_date = public.bkk_today() and exists (select 1 from public.payments p where p.order_id = o.id) and not exists (select 1 from public.order_queues q where q.order_id = o.id) and o.created_at > now() - interval '1 minute'")
echo "  A) 12 checkout พร้อมกัน: คิวเพิ่ม $((AFTER-BEFORE)), เลขคิวซ้ำ $DUP, ออเดอร์ไม่มีคิว $ORPHAN"
[[ "$((AFTER-BEFORE))" == "12" && "$DUP" == "0" && "$ORPHAN" == "0" ]] || fail "queue numbering under concurrency"

# ---- B) กดซ้ำพร้อมกัน ----
O=$("${PSQL[@]}" -c "$(checkout_sql 1)" | grep -E '^[0-9a-f-]{36}$' | grep -v "^$CASHIER$" | head -1)
V0=$("${PSQL[@]}" -c "select version from public.order_queues where order_id = '$O'")
for i in $(seq 1 8); do ( "${PSQL[@]}" -c "$(as_cashier "select public.set_station_status('$O', 'cake', 'ready');")" > "$OUT/b$i.txt" 2> "$OUT/b$i.err" ) & done; wait
V1=$("${PSQL[@]}" -c "select version from public.order_queues where order_id = '$O'")
CHANGED=$(cat "$OUT"/b*.txt | grep -c '"changed": true' || true)
echo "  B) กด 'พร้อมแล้ว' 8 ครั้งพร้อมกัน: changed=true $CHANGED ครั้ง, version $V0 → $V1"
[[ "$CHANGED" == "1" && "$V1" == "$((V0+1))" ]] || fail "double-tap should change exactly once"
for i in $(seq 1 8); do ( "${PSQL[@]}" -c "$(as_cashier "select public.complete_handover('$O');")" > "$OUT/h$i.txt" 2> "$OUT/h$i.err" ) & done; wait
HC=$(cat "$OUT"/h*.txt | grep -c '"changed": true' || true)
echo "     ส่งมอบพร้อมกัน 8 ครั้ง: changed=true $HC ครั้ง"
[[ "$HC" == "1" ]] || fail "handover should apply exactly once"

# ---- C) แผนอบ 2 เครื่อง + ออเดอร์ใหม่พร้อมกัน ----
"${PSQL[@]}" -c "update public.orders set prep_status = 'done' where prep_status = 'preparing'" >/dev/null
for q in 10 10 8; do "${PSQL[@]}" -c "$(checkout_sql $q)" >/dev/null; done
SIG=$("${PSQL[@]}" -c "$(as_cashier "select public.get_cake_plan()->>'signature';")" | grep -E '^[0-9a-f]{32}$')
( "${PSQL[@]}" -c "$(as_cashier "select public.confirm_cake_plan('$SIG');")" > "$OUT/c1.txt" 2> "$OUT/c1.err" ) &
( "${PSQL[@]}" -c "$(as_cashier "select public.confirm_cake_plan('$SIG');")" > "$OUT/c2.txt" 2> "$OUT/c2.err" ) &
( "${PSQL[@]}" -c "$(checkout_sql 5)" > "$OUT/c3.txt" 2> "$OUT/c3.err" ) &
wait
OVER=$("${PSQL[@]}" -c "select count(*) from public.production_batches b where b.status = 'planning' and (select coalesce(sum(quantity),0) from public.batch_items where batch_id = b.id) > b.capacity")
OVERITEM=$("${PSQL[@]}" -c "select count(*) from public.item_preparations ip where (select coalesce(sum(bi.quantity),0) from public.batch_items bi join public.production_batches b on b.id = bi.batch_id where bi.item_preparation_id = ip.id and b.status in ('planning','baking')) > ip.quantity - ip.ready_quantity")
ALLOC=$("${PSQL[@]}" -c "select coalesce(sum(bi.quantity),0) from public.batch_items bi join public.production_batches b on b.id = bi.batch_id where b.status = 'planning' and b.business_date = public.bkk_today()")
ERRS=$(cat "$OUT"/c1.err "$OUT"/c2.err | grep -c "PLAN_CHANGED" || true)
echo "  C) ยืนยันแผนพร้อมกัน: จัดไว้ $ALLOC ชิ้น (ต้องการ 28), รอบที่เกินความจุ $OVER, รายการที่จัดเกิน $OVERITEM, ถูกปฏิเสธเพราะแผนเปลี่ยน $ERRS"
[[ "$OVER" == "0" && "$OVERITEM" == "0" && "$ALLOC" -le 33 && "$ALLOC" -ge 28 ]] || fail "plan confirmation race"
# แผนที่เหลือ (ออเดอร์ 5 ชิ้นอาจเข้าทีหลัง) ต้องยืนยันต่อได้และรวมเป็น 33 โดยไม่จัดซ้ำ
SIG=$("${PSQL[@]}" -c "$(as_cashier "select public.get_cake_plan()->>'signature';")" | grep -E '^[0-9a-f]{32}$') || true
"${PSQL[@]}" -c "$(as_cashier "select public.confirm_cake_plan('$SIG');")" >/dev/null 2>&1 || true
TOTAL=$("${PSQL[@]}" -c "select coalesce(sum(bi.quantity),0) from public.batch_items bi join public.production_batches b on b.id = bi.batch_id where b.status = 'planning' and b.business_date = public.bkk_today()")
[[ "$TOTAL" == "33" ]] || fail "all 33 pieces should be allocated exactly once (got $TOTAL)"
echo "     หลังยืนยันส่วนที่เหลือ: จัดครบ 33 ชิ้น ไม่ซ้ำ"

# ---- D) เริ่ม/จบรอบพร้อมกัน ----
B1=$("${PSQL[@]}" -c "select id from public.production_batches where status = 'planning' and business_date = public.bkk_today() order by batch_no limit 1")
for i in $(seq 1 6); do ( "${PSQL[@]}" -c "$(as_cashier "select public.start_batch('$B1');")" > "$OUT/s$i.txt" 2> "$OUT/s$i.err" ) & done; wait
SC=$(cat "$OUT"/s*.txt | grep -c '"changed": true' || true)
for i in $(seq 1 6); do ( "${PSQL[@]}" -c "$(as_cashier "select public.complete_batch('$B1');")" > "$OUT/e$i.txt" 2> "$OUT/e$i.err" ) & done; wait
EC=$(cat "$OUT"/e*.txt | grep -c '"changed": true' || true)
READY=$("${PSQL[@]}" -c "select coalesce(sum(ip.ready_quantity),0) from public.item_preparations ip where ip.id in (select item_preparation_id from public.batch_items where batch_id = '$B1')")
INB=$("${PSQL[@]}" -c "select coalesce(sum(quantity),0) from public.batch_items where batch_id = '$B1'")
echo "  D) เริ่มรอบ 6 ครั้งพร้อมกัน: เปลี่ยนจริง $SC; จบรอบ 6 ครั้งพร้อมกัน: เปลี่ยนจริง $EC; พร้อม=$READY จัดในรอบ=$INB"
[[ "$SC" == "1" && "$EC" == "1" && "$READY" == "$INB" ]] || fail "batch start/complete race"
