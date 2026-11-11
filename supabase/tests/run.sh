#!/usr/bin/env bash
# รันชุดทดสอบฐานข้อมูลกับ Postgres ที่ "ใช้ทิ้งได้"
#
#   PG_TEST_URL=postgresql://postgres:postgres@localhost:5432/pos_test bash supabase/tests/run.sh
#
# ⚠️ สคริปต์จะ DROP SCHEMA public/auth/t แล้วสร้างใหม่ — ชื่อฐานข้อมูลต้องลงท้ายด้วย _test
set -euo pipefail
cd "$(dirname "$0")/.."

URL="${PG_TEST_URL:-}"
if [[ -z "$URL" ]]; then
  echo "ตั้งค่า PG_TEST_URL ก่อน (เช่น postgresql://postgres:postgres@localhost:5432/pos_test)"; exit 2
fi
DB_NAME="${URL##*/}"; DB_NAME="${DB_NAME%%\?*}"
if [[ "$DB_NAME" != *_test ]]; then
  echo "ปฏิเสธ: ชื่อฐานข้อมูล '$DB_NAME' ต้องลงท้ายด้วย _test (กันรันใส่ฐานจริง)"; exit 2
fi

PSQL=(psql "$URL" -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists t cascade; create schema public;"
"${PSQL[@]}" -f tests/00_supabase_stub.sql
for f in migrations/*.sql; do echo "• apply $f"; "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f seed.sql
"${PSQL[@]}" -f seed.sql   # รันซ้ำต้องไม่สร้างข้อมูลซ้ำ
echo "• run tests/financial.test.sql"
"${PSQL[@]}" -f tests/financial.test.sql
echo "• run tests/queue.test.sql"
"${PSQL[@]}" -f tests/queue.test.sql
echo "• concurrency: ส่ง checkout ด้วย idempotency key เดียวกันพร้อมกัน"
bash tests/concurrency.sh "$URL"
echo "• concurrency: คิว/สถานี/รอบอบ หลายเครื่องพร้อมกัน"
bash tests/queue_concurrency.sh "$URL"
echo "✅ DB tests passed"
