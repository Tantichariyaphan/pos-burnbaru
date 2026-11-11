# รายงานความเข้ากันได้ — ระบบคิว / งานผลิต / รอบอบเค้ก

หลักการ: **ต่อยอด ไม่เขียนใหม่** ทุกอย่างของเดิมยังทำงานเหมือนเดิม; ของใหม่เป็น migration แบบ additive (`0004`) + ไฟล์ใหม่

## ใช้ซ้ำ (ไม่แก้)
| ส่วน | หมายเหตุ |
|---|---|
| `checkout_order()`, `refund_order()`, ฟังก์ชันกะ/เงินสด, ภาษี, รายงาน, ใบเสร็จ (ตรรกะ) | ไม่ถูกแก้ ฟังก์ชันคิวต่อเข้าทาง trigger เท่านั้น |
| ตาราง `orders`, `order_items`, `payments`, `shifts`, `products`, `categories`, `settings`, `audit_log` | ไม่เปลี่ยนโครงสร้าง ไม่มี UPDATE/DELETE ข้อมูลเดิม |
| Employee auth, `require_role`, RLS เดิม, trigger กันแก้ข้อมูลการเงิน | ไม่แตะ ไม่ผ่อนสิทธิ์ |

## ต่อยอด (แก้เล็กน้อย เข้ากันย้อนหลังได้)
| ไฟล์ | สิ่งที่เพิ่ม |
|---|---|
| `src/app/(app)/pos/pos-client.tsx`, `paid-panel.tsx`, `order-panel.tsx`, `checkout-dialog.tsx`, `pos/page.tsx` | แสดงคิว/สถานีที่รายการออเดอร์, ปุ่ม QR, เตือนรอบอบเต็ม (ไม่บล็อกการขาย), DONE ผ่านระบบคิว, แก้ polling ทับสถานะ; ถ้ายังไม่รัน 0004 หน้านี้ยังขายได้ปกติ |
| `src/app/actions/pos.ts` | `checkout` คืนข้อมูลคิวเพิ่ม (เรียก `ensure_order_queue` แบบไม่กระทบการขายถ้าพลาด) |
| `src/app/receipt/[id]/page.tsx` | เลขคิว + QR (แสดงเมื่อมีคิวเท่านั้น) |
| `src/lib/roles.ts`, `queries.ts`, `errors.ts`, `types/db.ts`, `components/icons.tsx`, `lib/supabase/middleware.ts` | เมนู/สิทธิ์ `production`, query คิว, ข้อความผิดพลาด, ไอคอน, ปล่อย `/q/*` และ `/api/queue/*` ให้เข้าได้โดยไม่ล็อกอิน |
| `supabase/seed.sql` | เพิ่มการกำหนดสถานีของหมวด (idempotent) |
| `tests/unit/status.test.ts` | เมนูแคชเชียร์มี `/production` |

> ไฟล์ branding ที่ผู้ใช้ส่งมา (BurnBaru, สี #6d0212) ถูกนำไปใช้ใน pos-client, receipt, globals.css, layout, login ก่อนเริ่มงานนี้ — ไม่ใช่ส่วนของฟีเจอร์คิว

## ใหม่
- `supabase/migrations/0004_queue_production.sql`, `supabase/rollback/0004_rollback.sql`, `supabase/tests/queue.test.sql`, `queue_concurrency.sh`
- `src/app/(app)/production/*` (KDS, แผงรอบอบ, ตั้งค่า), `src/app/actions/production.ts`
- `src/app/q/[token]/*`, `src/app/api/queue/[token]/route.ts`
- `src/lib/{production,production-client,qr,sync-controller,use-synced,public-queue}.ts`, `src/lib/supabase/anon.ts`, `src/components/qr-code.tsx`
- `tests/unit/{qr,sync-controller,production}.test.ts`

## ความปลอดภัย
- ตารางใหม่ทั้งหมดเปิด RLS; เขียนได้ผ่านฟังก์ชัน SECURITY DEFINER (`search_path=public`, ตรวจ `require_role`) เท่านั้น — ไม่มี policy `true` และไม่มี grant เขียนตรง ยกเว้น `update` เฉพาะ 5 คอลัมน์ของ `production_settings` (ผ่าน RLS ให้ owner/manager)
- ฟังก์ชันภายในถูก `revoke` จาก public/anon/authenticated อย่างชัดเจน; ฟังก์ชันเดียวที่ anon เรียกได้คือ `get_public_queue(token)` คืน DTO ขั้นต่ำ (ไม่มี id ภายใน/การเงิน/ข้อมูลลูกค้า) และไม่มี SELECT ตรงบนตารางสำหรับ anon
- token: 64 hex (~244 บิต) จาก `gen_random_uuid()`; ลิงก์หมดอายุได้; หน้า/API ตั้ง `Referrer-Policy: no-referrer`, `no-store`, `noindex`; ไม่มี service-role key ในโค้ดฝั่งเบราว์เซอร์
- **ข้อสังเกตที่ไม่ได้แก้ (นอกขอบเขต):** ใน Supabase default privileges ให้ `authenticated` เรียกฟังก์ชันใหม่ได้ ฟังก์ชันภายในของ migration 0003 (เช่น `compute_shift_summary`) อาจถูกเรียกได้โดยผู้ล็อกอินตามค่าเริ่มต้น — ควรตรวจบน production ด้วย `select proname, proacl from pg_proc where pronamespace='public'::regnamespace` แล้ว revoke ตามความเหมาะสม (ฟังก์ชันของ 0004 ถูก revoke ไว้แล้ว)

## ข้อจำกัด / ยังไม่ได้ตรวจ
- ไม่เคย `npm install` / `next build` / ESLint ในสภาพแวดล้อมที่เขียน (npm ถูกบล็อก) — typecheck ทำผ่าน type stub เท่านั้น
- ไม่ได้ทดสอบกับ Supabase/Realtime/Vercel จริง; ไฟล์ SQL ทดสอบบน Postgres 16 ธรรมดาที่จำลอง role ของ Supabase
- หน้าจอทดสอบด้วยข้อมูลจำลองใน Chromium (ไม่ใช่ iPad/Safari จริง)
- ไฟล์ของผู้ใช้เป็น CRLF ส่วนไฟล์ที่เขียนใหม่เป็น LF
