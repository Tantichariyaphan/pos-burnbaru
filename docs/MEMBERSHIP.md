# BURN BARU CLUB — ระบบสมาชิก (รวม LINE OA เข้ากับ POS)

เอกสารนี้ครอบคลุม: สิ่งที่เปลี่ยน · วิธีตั้งค่า/เปิดใช้ · ตาราง EXISTING/MODIFY/NEW · KPI · สิ่งที่ยังต้องตัดสินใจ · สิ่งที่ตรวจสอบแล้วและ "ยังไม่ได้" ตรวจสอบ

## 1) สรุปแนวทาง

ระบบ LINE OA เดิม (Express + Postgres แยก) ถูก **พอร์ตตรรกะเข้ามาใน POS** แทนการรันสองระบบคู่กัน — POS (Supabase) เป็นแหล่งความจริงของยอดขาย สมาชิก/แต้ม/คูปองผูกกับ `customers` เดิม 1:1 ผ่าน `member_profiles`

หลักการที่คงไว้: เงินเป็นสตางค์จำนวนเต็ม · ข้อมูลการเงินแก้ย้อนหลังไม่ได้ · RLS ทุกตาราง · migration แบบเพิ่มอย่างเดียว · service-role key อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น · **ระบบสมาชิกล้มเหลวต้องไม่ทำให้การขายล้ม**

## 2) ตาราง EXISTING / MODIFY / NEW

| ส่วน | สถานะ | รายละเอียด |
|---|---|---|
| `customers`, `orders`, `payments`, `refunds`, `discounts`, `checkout_order`, `refund_order`, KDS/คิว | **EXISTING (ไม่แก้)** | ใช้ต่อทั้งหมด; `checkout_member_order` ครอบ `checkout_order` เดิม |
| แสตมป์ (LINE OA เดิม: 1 แก้ว = 1 ดวง, ครบ 10 = รางวัล) | **EXISTING → ย้ายมา** | อยู่ใน `member_ledger` (currency `stamps`) กติกาตั้งได้ใน `loyalty_settings` |
| คูปอง/QR/Keyword แชตบอท | **EXISTING → ย้ายมา** | `member_coupons`, `coupon_templates`, `chat_keywords` (ปรับให้ใช้ส่วนลดจากตาราง `discounts` เดิม ไม่สร้างตรรกะส่วนลดซ้ำ) |
| `src/lib/roles.ts`, `errors.ts`, `types/db.ts`, `supabase/middleware.ts`, `globals.css`, `.env.example` | **MODIFY** | สิทธิ์ `members`, ข้อความผิดพลาด, ชนิดข้อมูล, เส้นทางสาธารณะ, โทเคนสีแบรนด์ |
| `pos/checkout-dialog.tsx`, `pos-client.tsx`, `pos/page.tsx`, `actions/pos.ts` | **MODIFY** | ตัวเลือกสมาชิก/คูปอง; ไม่มีสมาชิก = เส้นทางเดิม (`checkout_order`) |
| `0005_membership.sql` | **NEW** | ตาราง `membership_tiers, coupon_templates, loyalty_settings, member_profiles, customer_line_links, member_ledger, member_order_links, member_events, member_tier_history, member_coupons, membership_claims, notification_outbox, chat_keywords` + ฟังก์ชัน/ทริกเกอร์/RLS |
| `/liff`, `/members`, `/api/liff/*`, `/api/line/webhook`, `/api/cron/outbox` | **NEW** | |

## 3) การออกแบบหลัก

- **ledger เดียว** `member_ledger` (แต้ม + แสตมป์) เพิ่มอย่างเดียว (`forbid_modify`), มี idempotency key, ยอดคงเหลืออยู่ที่ `member_profiles` และปรับผ่านฟังก์ชันที่ล็อกแถว (`FOR UPDATE`) เท่านั้น
- **ให้แต้มจาก trigger หลัง `payments`** ห่อด้วย exception block: ถ้าพลาด การขายสำเร็จตามปกติ และ `membership_reconcile` (ปุ่มในหน้า สมาชิก > ภาพรวม) ซ่อมย้อนหลังได้
- **คืนเงิน** ย้อนแต้มตามสัดส่วน (ปัดลง), ย้อนแสตมป์เมื่อคืนเต็มออเดอร์; ยอดไม่ติดลบ — ส่วนที่ย้อนไม่ได้เพราะแต้มถูกใช้ไปแล้วบันทึกเป็น `SHORTFALL` ใน ledger
- **Tier**: เลื่อนทันทีเมื่อยอดซื้อสะสมสุทธิย้อนหลัง N เดือนถึงเกณฑ์; **ไม่ลดอัตโนมัติ** จนกว่าเจ้าของเปิด `tier_downgrade_enabled`
- **ตัวเลขธุรกิจที่ยังไม่อนุมัติ** (อัตราแต้ม, เกณฑ์ SIGNATURE / THE BURN CLUB) เป็น `NULL`/ปิด — ระบบจะไม่เดาให้
- **ลูกค้าไม่สมาชิก (Guest)** ขายได้ปกติ; หลังชำระ พนักงานแสดง **Claim QR** ให้ลูกค้าสแกนรับแต้มย้อนหลังภายในหน้าต่างเวลาที่ตั้ง (`orders.customer_id` ไม่ถูกแก้ — ใช้ `member_order_links`)
- **QR สมาชิก** `BBM1.<qr_ref>.<exp>.<sig>`: opaque, ลงลายเซ็น HMAC, หมดอายุใน 2 นาที, หมุนได้
- **Claim token** เก็บเฉพาะ sha256; ใช้ได้ครั้งเดียว มีหมดอายุ
- **การแจ้งเตือน** ผ่าน `notification_outbox` (transactional แยกจาก marketing; การตลาดต้องมี consent + เพดานความถี่; retry backoff, ล้มเหลวหลัง 5 ครั้ง)

## 4) ตั้งค่าและเปิดใช้งาน (ทำตามลำดับ)

1. **สำรองฐานข้อมูล** แล้วรัน `supabase/migrations/0005_membership.sql` บน Supabase (SQL Editor) — เพิ่มอย่างเดียว ไม่แตะข้อมูลเดิม *(ไม่มีการรันอัตโนมัติบน production)*
2. รัน `supabase/seed.sql` ซ้ำได้ (idempotent)
3. ตั้ง Environment Variables (Vercel) ตาม `.env.example`: `NEXT_PUBLIC_LIFF_ID, LINE_LOGIN_CHANNEL_ID, LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN, MEMBER_QR_SECRET, CRON_SECRET` (+ `SUPABASE_SERVICE_ROLE_KEY` ที่มีอยู่แล้ว)
4. **LINE Developers Console**
   - Messaging API channel: Webhook URL = `https://<โดเมน>/api/line/webhook`, เปิด Use webhook, ปิด auto-reply ของ LINE OA ถ้าต้องการให้บอทตอบเอง
   - LINE Login channel (ผูกกับ Provider เดียวกับ OA): สร้าง LIFF app, Endpoint URL = `https://<โดเมน>/liff`, scope `openid profile`, ใส่ LIFF ID ใน `NEXT_PUBLIC_LIFF_ID`; ใส่ Channel ID ใน `LINE_LOGIN_CHANNEL_ID`
5. **Cron**: เรียก `GET /api/cron/outbox` พร้อม header `Authorization: Bearer <CRON_SECRET>` ทุก 1–5 นาที (Vercel Hobby ตั้ง cron ได้วันละครั้งเท่านั้น — ใช้บริการภายนอก เช่น cron-job.org / GitHub Actions แทน) งานนี้ทั้งส่งแจ้งเตือนค้างและสร้างงานตามเวลา (วันเกิด, Come Back, คูปองใกล้หมดอายุ)
6. เข้า **สมาชิก › ตั้งค่าโปรแกรม** (เจ้าของ) กำหนดอัตราแต้ม, เกณฑ์ Tier, แม่แบบคูปอง/รางวัล แล้วจึง **เปิดระบบสมาชิก**
7. ทดสอบบนเครื่องจริง: สมัครผ่าน LIFF → ขาย 1 ออเดอร์ที่ผูกสมาชิก → เห็นแต้ม → คืนเงิน → เห็นแต้มถูกย้อน

## 5) KPI ในหน้า สมาชิก › ภาพรวม

| KPI | ความหมาย |
|---|---|
| สมาชิกที่ผูก LINE | สมาชิกที่มีการผูกบัญชี LINE ที่ยังใช้งาน ÷ สมาชิกทั้งหมด |
| สมาชิกที่ซื้อในช่วง | จำนวนสมาชิกที่มีออเดอร์ (ไม่ถูกคืนเต็ม) ในช่วงที่เลือก |
| ซื้อซ้ำ | สมาชิกที่มี ≥ 2 ออเดอร์ในช่วงที่เลือก ÷ สมาชิกที่ซื้อ |
| ยอดขายจากสมาชิก / สัดส่วนออเดอร์สมาชิก | ผลรวม `orders.total_satang` ที่ผูกสมาชิก vs ออเดอร์ที่ไม่ผูก |
| แต้มที่ออก/ใช้แลก/คงค้าง | จาก `member_ledger` และยอดใน `member_profiles` |
| อัตราใช้คูปอง | คูปองที่ใช้ ÷ คูปองที่ออกในช่วง |

## 6) ย้ายข้อมูลจาก LINE OA เดิม (ยังไม่ได้ทำ — ต้องใช้ข้อมูลจริงจากคุณ)

มีฟังก์ชันนำเข้าที่ idempotent (เฉพาะ service role): `import_line_oa_member(...)` และ `import_line_oa_coupon(...)` — สมาชิกที่นำเข้ายังไม่มี `privacy_accepted_at` (ต้องยอมรับตอนเข้า LIFF ครั้งแรก) แสตมป์คงเหลือเข้า ledger เป็น `ADMIN_ADJUSTMENT`
ต้องการ: export ตาราง `members` และ `coupons` จากฐานข้อมูล Render ของ LINE OA เดิม → ผมไม่มีสิทธิ์เข้าถึงฐานนั้น **ห้ามรันกับ production โดยไม่ซ้อมกับสำเนาก่อน**

## 7) สิ่งที่ตรวจสอบแล้ว / ยังไม่ได้ตรวจสอบ (ตามจริง)

**ตรวจแล้ว (รันจริง)**
- `tsc --noEmit` ผ่านทั้งโปรเจกต์
- ยูนิตเทสต์ 63/63 ผ่าน (เดิม 49 + ใหม่ 14: ลายเซ็น LINE, ID token, push/retry, ข้อความแจ้งเตือน, QR สมาชิก, claim token, แชตบอท, outbox dispatch, เส้นทางสาธารณะ, สิทธิ์)
- ทดสอบ DB บน Postgres 16 จริง: `financial.test.sql`, `queue.test.sql` ผ่านเหมือนเดิม; `membership.test.sql` 217 รายการผ่าน (สมัคร/ผูก LINE, แต้ม/แสตมป์, Tier, คืนเงิน, คูปอง, แลกแต้ม, Claim QR, outbox, งานตามเวลา, นำเข้า, สิทธิ์ anon/cashier, ล้มเหลวแล้วต้องไม่ล้มการขาย)
- คำขอพร้อมกันจริง (`membership_concurrency.sh`): ใช้คูปองใบเดียวพร้อมกัน 6 ครั้ง → สำเร็จ 1; แลกแต้ม key เดียวกัน 6 ครั้ง → หักครั้งเดียว; โควตาเหลือ 1 → ออก 1; token ใช้ซ้ำพร้อมกัน → ใช้ได้ 1

**ยังไม่ได้ตรวจสอบ**
- `next build` และการรันแอปจริง (เครื่องที่ผมเข้าถึงเป็น Linux แต่ `node_modules` ติดตั้งจาก Windows จึงรัน build/`tsx` ไม่ได้) → รัน `npm run build` และ `npm test` บนเครื่องคุณ
- การเชื่อมต่อ LINE จริง (webhook, LIFF, push) — ไม่มีคีย์/บัญชี; ตรวจเฉพาะตรรกะด้วย mock
- หน้าตา UI บนมือถือ/iPad จริง
- `supabase/tests/queue_concurrency.sh` สถานการณ์ C (ยืนยันแผนอบพร้อมกัน) **ล้มเหลวอยู่ก่อนแล้ว** แม้ไม่ติดตั้ง 0005 (ตรวจแล้วกับไฟล์ของ GitHub) — เป็นปัญหาเดิมของระบบคิว ไม่ได้แก้ในงานนี้; `run.sh` รันขั้นตอนสมาชิกก่อน `queue_concurrency.sh` เพื่อให้ผลของสมาชิกไม่ถูกบังด้วยความล้มเหลวนี้
- ยังไม่มี Rich Menu (สคริปต์ตั้ง Rich Menu ไม่ได้ทำ — ตั้งใน LINE OA Manager ชี้มาที่ลิงก์ LIFF ได้)

## 8) ต้องการการตัดสินใจจากเจ้าของร้าน

1. **อัตราแต้ม** (กี่บาท = 1 แต้ม) และฐานคำนวณ (หลัง/ก่อนส่วนลด)
2. **เกณฑ์ Tier** ของ SIGNATURE และ THE BURN CLUB + สิทธิประโยชน์ + จะลดระดับอัตโนมัติหรือไม่
3. **คืนเงินเมื่อแต้มถูกใช้ไปแล้ว**: ตอนนี้ย้อนเท่าที่มีและบันทึกส่วนที่ขาด (ไม่ติดลบ) — ถ้าต้องการติดลบ/เรียกคืนคูปอง ต้องกำหนดนโยบาย
4. **แต้มหมดอายุ** — ยังไม่ทำ (ต้องกำหนดกติกา)
5. **ยืนยันเบอร์ด้วย OTP** — ยังไม่ทำ (ต้องมีผู้ให้บริการ SMS); ปัจจุบันกันซ้ำด้วยเบอร์ที่ normalize แล้ว และเบอร์ที่ตรงลูกค้าเดิมต้องให้พนักงานผูก
6. **ความปลอดภัย**: ไฟล์ `.env.example` ของโปรเจกต์ line-oa เดิมมีค่าที่ดูเหมือนข้อมูลลับจริง — **ควรหมุน (rotate) ค่าเหล่านั้นทันที** (ผมไม่ได้แก้ไฟล์ใน line-oa)
