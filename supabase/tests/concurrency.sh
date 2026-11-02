#!/usr/bin/env bash
# ส่ง checkout ด้วย idempotency key เดียวกันพร้อมกัน 8 ครั้ง → ต้องได้ 1 ออเดอร์ 1 การชำระ และทุกคำสั่งได้ order id เดียวกัน
# ใช้ข้อมูลที่ financial.test.sql ทิ้งไว้ (ต้องรันหลังไฟล์นั้น)
set -euo pipefail
URL="$1"
PSQL=(psql "$URL" -X -q -t -A -v ON_ERROR_STOP=1)

# เตรียม: เปิดขาย + มีกะที่เปิดอยู่ (กะของ manager จากชุดทดสอบยังเปิดอยู่)
"${PSQL[@]}" -c "update public.settings set sales_enabled = true;" >/dev/null
SHIFT=$("${PSQL[@]}" -c "select id from public.shifts where status = 'open' limit 1")
CASHIER=$("${PSQL[@]}" -c "select id from public.employees where email = 'cashier@cafe.test'")
PROD=$("${PSQL[@]}" -c "select p.id from public.products p join public.categories c on c.id = p.category_id where p.name = 'Original' and c.name = 'Basque Burnt Cheesecake'")
KEY=$(cat /proc/sys/kernel/random/uuid)
BEFORE=$("${PSQL[@]}" -c "select count(*) from public.orders")

SQL="begin; select set_config('request.jwt.claim.sub', '$CASHIER', true); set local role authenticated;
select public.checkout_order('$KEY', '$SHIFT', '[{\"product_id\":\"$PROD\",\"quantity\":1}]'::jsonb, null, 'cash', 10000, null, null, null); commit;"

OUT=$(mktemp -d)
for i in 1 2 3 4 5 6 7 8; do
  ( "${PSQL[@]}" -c "$SQL" > "$OUT/$i.txt" 2> "$OUT/$i.err" || echo "fail" >> "$OUT/$i.err" ) &
done
wait

IDS=$(cat "$OUT"/*.txt | grep -E '^[0-9a-f-]{36}$' | grep -v "^$CASHIER$" | sort -u)
N_IDS=$(echo "$IDS" | grep -c . || true)
AFTER=$("${PSQL[@]}" -c "select count(*) from public.orders")
PAY=$("${PSQL[@]}" -c "select count(*) from public.payments where idempotency_key = '$KEY'")
echo "  คำสั่งทั้งหมด 8, order id ที่ได้ไม่ซ้ำ = $N_IDS, ออเดอร์ที่เพิ่ม = $((AFTER-BEFORE)), payments = $PAY"
if [[ "$N_IDS" != "1" || "$((AFTER-BEFORE))" != "1" || "$PAY" != "1" ]]; then
  echo "❌ concurrency idempotency failed"; cat "$OUT"/*.err | head; exit 1
fi
