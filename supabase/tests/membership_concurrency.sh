#!/usr/bin/env bash
# การแข่งกันของคำขอพร้อมกัน (ต้องรันหลัง membership.test.sql ซึ่งทิ้งข้อมูลทดสอบไว้)
#  A) ใช้คูปองใบเดียวกันตอน checkout พร้อมกัน 6 ครั้ง  → สำเร็จ 1, คูปอง used 1, ใช้ใน 1 ออเดอร์
#  B) แลกแต้มด้วย idempotency key เดียวกัน 6 ครั้ง       → หักแต้ม 1 ครั้ง, ได้คูปอง 1 ใบ
#  C) แลกแต้มด้วย key ต่างกัน แต่โควตาเหลือ 1 สิทธิ์       → ได้ 1 ใบ ที่เหลือ QUANTITY_EXCEEDED, แต้มไม่ติดลบ
#  D) ใช้ Claim token เดียวกันพร้อมกัน 6 ครั้ง             → ใช้สำเร็จ 1 ครั้ง
set -euo pipefail
URL="$1"
PSQL=(psql "$URL" -X -q -t -A -v ON_ERROR_STOP=1)
OUT=$(mktemp -d)
fail() { echo "❌ $1"; cat "$OUT"/*.err 2>/dev/null | head -5; exit 1; }

"${PSQL[@]}" -c "update public.settings set sales_enabled = true; update public.loyalty_settings set membership_enabled = true, points_enabled = true, satang_per_point = 1000;" >/dev/null
SHIFT=$("${PSQL[@]}" -c "select id from public.shifts where status = 'open' limit 1")
CASHIER=$("${PSQL[@]}" -c "select id from public.employees where email = 'cashier@cafe.test'")
PROD=$("${PSQL[@]}" -c "select p.id from public.products p join public.categories c on c.id = p.category_id where p.name = 'Original' and c.name = 'Basque Burnt Cheesecake'")
MEMBER=$("${PSQL[@]}" -c "select customer_id from public.member_profiles where member_no = 'BB-00001'")

# ---------- A) คูปองใบเดียว ใช้พร้อมกัน ----------
DISC=$("${PSQL[@]}" -c "select id from public.discounts where name = 'FIX20'")
COUPON=$("${PSQL[@]}" -c "
  with t as (insert into public.coupon_templates(title, source, discount_id, expire_days) values ('concurrency', 'promotion', '$DISC', 7) returning id)
  select public._issue_from_template('$MEMBER', (select id from t), 'conc:' || gen_random_uuid()::text)")
for i in 1 2 3 4 5 6; do
  K=$(cat /proc/sys/kernel/random/uuid)
  SQL="begin; select set_config('request.jwt.claim.sub', '$CASHIER', true); set local role authenticated;
  select public.checkout_member_order('$K', '$SHIFT', '[{\"product_id\":\"$PROD\",\"quantity\":1}]'::jsonb, null, 'cash', 100000, null, '$MEMBER', null, '$COUPON'); commit;"
  ( "${PSQL[@]}" -c "$SQL" > "$OUT/a$i.txt" 2> "$OUT/a$i.err" || true ) &
done
wait
OK_A=$(cat "$OUT"/a*.txt | grep -E '^[0-9a-f-]{36}$' | grep -vc "^$CASHIER$" || true)
USED=$("${PSQL[@]}" -c "select count(*) from public.member_coupons where id = '$COUPON' and status = 'used'")
ORDERS=$("${PSQL[@]}" -c "select count(*) from public.orders where id = (select used_order_id from public.member_coupons where id = '$COUPON')")
ALREADY=$(cat "$OUT"/a*.err | grep -c 'COUPON_ALREADY_USED' || true)
echo "  A) สำเร็จ=$OK_A, COUPON_ALREADY_USED=$ALREADY, คูปอง used=$USED, ออเดอร์ที่ผูก=$ORDERS"
[[ "$OK_A" == "1" && "$USED" == "1" && "$ORDERS" == "1" && "$ALREADY" == "5" ]] || fail "A: คูปองใช้ซ้ำได้/ผลไม่ตรง"

# ---------- B) แลกแต้ม key เดียวกัน ----------
LINE_ID=$("${PSQL[@]}" -c "select line_user_id from public.customer_line_links where customer_id = '$MEMBER' and unlinked_at is null limit 1")
if [[ -z "$LINE_ID" ]]; then
  LINE_ID="Uconc0001"
  "${PSQL[@]}" -c "insert into public.customer_line_links(customer_id, line_user_id) values ('$MEMBER', '$LINE_ID')" >/dev/null
fi
TPL=$("${PSQL[@]}" -c "insert into public.coupon_templates(title, source, point_cost, expire_days) values ('conc-reward', 'reward', 10, 30) returning id")
"${PSQL[@]}" -c "update public.member_profiles set points_balance = 100 where customer_id = '$MEMBER'" >/dev/null
P0=$("${PSQL[@]}" -c "select points_balance from public.member_profiles where customer_id = '$MEMBER'")
KEYB="conc-claim-same-key-001"
for i in 1 2 3 4 5 6; do
  ( "${PSQL[@]}" -c "begin; set local role service_role; select public.liff_claim_reward('$LINE_ID', '$TPL', '$KEYB'); commit;" > "$OUT/b$i.txt" 2> "$OUT/b$i.err" || true ) &
done
wait
P1=$("${PSQL[@]}" -c "select points_balance from public.member_profiles where customer_id = '$MEMBER'")
NC=$("${PSQL[@]}" -c "select count(*) from public.member_coupons where template_id = '$TPL'")
echo "  B) แต้มก่อน=$P0 หลัง=$P1 คูปองที่ได้=$NC"
[[ "$NC" == "1" && "$((P0-P1))" == "10" ]] || fail "B: แลกแต้มซ้ำ/หักแต้มผิด"

# ---------- C) โควตาเหลือ 1 สิทธิ์ key ต่างกัน ----------
TPLC=$("${PSQL[@]}" -c "insert into public.coupon_templates(title, source, point_cost, expire_days, quantity_limit) values ('conc-limit-1', 'reward', 5, 30, 1) returning id")
P0=$P1
for i in 1 2 3 4 5 6; do
  ( "${PSQL[@]}" -c "begin; set local role service_role; select public.liff_claim_reward('$LINE_ID', '$TPLC', 'conc-claim-diff-key-00$i'); commit;" > "$OUT/c$i.txt" 2> "$OUT/c$i.err" || true ) &
done
wait
P1=$("${PSQL[@]}" -c "select points_balance from public.member_profiles where customer_id = '$MEMBER'")
NC=$("${PSQL[@]}" -c "select count(*) from public.member_coupons where template_id = '$TPLC'")
QE=$(cat "$OUT"/c*.err | grep -c 'QUANTITY_EXCEEDED' || true)
echo "  C) คูปองที่ออก=$NC, QUANTITY_EXCEEDED=$QE, แต้มที่หัก=$((P0-P1))"
[[ "$NC" == "1" && "$QE" == "5" && "$((P0-P1))" == "5" ]] || fail "C: เกินโควตา/หักแต้มซ้ำ"

# ---------- D) Claim token ใช้พร้อมกัน ----------
H=$(printf 'conc-token-%s' "$RANDOM$RANDOM" | sha256sum | cut -d' ' -f1)
"${PSQL[@]}" -c "insert into public.membership_claims(token_hash, purpose, created_by, expires_at) values ('$H', 'join', '$CASHIER', now() + interval '10 minutes')" >/dev/null
for i in 1 2 3 4 5 6; do
  ( "${PSQL[@]}" -c "begin; set local role service_role; select public.claim_consume('$H', 'Uconcjoin$i', 'N$i', null, 'ทดสอบ$i', '08700000$i$i', null, true, false); commit;" > "$OUT/d$i.txt" 2> "$OUT/d$i.err" || true ) &
done
wait
USED_AT=$("${PSQL[@]}" -c "select count(*) from public.membership_claims where token_hash = '$H' and used_at is not null")
NEWM=$("${PSQL[@]}" -c "select count(*) from public.customer_line_links where line_user_id like 'Uconcjoin%' and unlinked_at is null")
echo "  D) token ถูกใช้=$USED_AT, สมาชิกใหม่ที่เกิด=$NEWM"
[[ "$USED_AT" == "1" && "$NEWM" == "1" ]] || fail "D: token ใช้ซ้ำได้"
echo "✅ membership concurrency passed"
