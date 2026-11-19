/** แปลงรหัสข้อผิดพลาดจากฐานข้อมูล (RAISE EXCEPTION 'CODE[: รายละเอียด]') เป็นข้อความภาษาไทย */

const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: "ไม่ได้เข้าสู่ระบบ หรือบัญชียังไม่ได้รับอนุญาตให้ใช้งาน",
  FORBIDDEN: "คุณไม่มีสิทธิ์ทำรายการนี้",
  SALES_DISABLED: "ยังไม่เปิดรับชำระเงิน — เจ้าของร้านต้องยืนยันราคาและเปิดการขายในหน้า ตั้งค่า ก่อน",
  SHIFT_NOT_OPEN: "กะนี้ปิดไปแล้วหรือยังไม่เปิดกะ กรุณาเปิดกะก่อน",
  NO_OPEN_SHIFT: "ต้องเปิดกะก่อนจึงจะทำรายการเงินสดได้",
  SHIFT_ALREADY_OPEN: "เครื่องนี้มีกะที่เปิดอยู่แล้ว",
  SHIFT_REQUIRED: "มีหลายกะที่เปิดอยู่ กรุณาระบุกะ",
  SHIFT_NOT_FOUND: "ไม่พบกะ",
  REGISTER_NOT_FOUND: "ไม่พบเครื่อง POS",
  EMPTY_ORDER: "ยังไม่มีสินค้าในออเดอร์",
  INVALID_QUANTITY: "จำนวนสินค้าต้องอยู่ระหว่าง 1–99",
  PRODUCT_UNAVAILABLE: "มีสินค้าที่ปิดการใช้งานหรือไม่พบในรายการ",
  PRODUCT_SOLD_OUT: "สินค้าหมด",
  PRICE_NOT_SET: "สินค้ายังไม่ได้ตั้งราคา",
  ADDON_INVALID: "ตัวเลือกเสริมไม่ถูกต้องสำหรับสินค้านี้",
  DISCOUNT_INVALID: "ส่วนลดนี้ใช้ไม่ได้",
  TOTAL_NOT_POSITIVE: "ยอดสุทธิต้องมากกว่า 0",
  AMOUNT_TOO_LARGE: "ยอดรวมสูงเกินกำหนด",
  INVALID_METHOD: "วิธีชำระเงินไม่ถูกต้อง",
  INVALID_AMOUNT: "จำนวนเงินไม่ถูกต้อง",
  INVALID_DIRECTION: "ประเภทรายการไม่ถูกต้อง",
  INVALID_STATUS: "สถานะไม่ถูกต้อง",
  INVALID_RANGE: "ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)",
  INVALID_KIND: "ประเภทรายการสต็อกไม่ถูกต้อง",
  INVALID_INPUT: "ข้อมูลไม่ถูกต้อง",
  INSUFFICIENT_PAYMENT: "จำนวนเงินที่รับมาน้อยกว่ายอดที่ต้องชำระ",
  TRANSFER_AMOUNT_MISMATCH: "ยอดเงินโอนต้องเท่ากับยอดที่ต้องชำระ",
  INSUFFICIENT_DRAWER_CASH: "เงินสดในลิ้นชักไม่พอสำหรับรายการนี้",
  REASON_REQUIRED: "กรุณาระบุเหตุผล",
  REFUND_EXCEEDS_PAID: "ยอดคืนเงินเกินยอดที่ชำระไว้",
  ORDER_NOT_FOUND: "ไม่พบออเดอร์",
  MOVEMENT_NOT_FOUND: "ไม่พบรายการเงินเข้า-ออก",
  ALREADY_REVERSED: "รายการนี้ถูกกลับรายการไปแล้ว หรือเป็นรายการกลับรายการ",
  ITEM_NOT_FOUND: "ไม่พบรายการวัตถุดิบ",
  CUSTOMER_NOT_FOUND: "ไม่พบลูกค้า",
  IMMUTABLE_RECORD: "ข้อมูลการเงินที่บันทึกแล้วแก้ไขหรือลบไม่ได้ — ใช้การคืนเงิน/กลับรายการแทน",
  // ---- คิว / สถานีผลิต / รอบอบ ----
  QUEUE_NOT_FOUND: "ออเดอร์นี้ยังไม่มีคิว (อาจชำระก่อนเปิดใช้ระบบคิว) — กดซ่อมคิวที่หน้าผลิต",
  QUEUE_CLOSED: "คิวนี้ปิดแล้ว (รับสินค้าแล้วหรือถูกยกเลิก)",
  STATION_NOT_REQUIRED: "ออเดอร์นี้ไม่มีงานที่สถานีนี้",
  NOT_READY: "ออเดอร์ยังไม่พร้อม — ยืนยันส่งมอบทั้งที่ยังไม่เสร็จได้ที่ปุ่ม “ส่งมอบเลย”",
  STALE_STATE: "ข้อมูลเพิ่งถูกเปลี่ยนจากอีกเครื่อง — โหลดสถานะล่าสุดให้แล้ว กรุณาตรวจแล้วลองใหม่",
  USE_BATCH: "เค้กเริ่มทำผ่านรอบอบ — จัดรอบแล้วกด “เริ่มอบ”",
  CAKE_IN_BAKING_BATCH: "เค้กนี้อยู่ในรอบที่กำลังอบ — รอให้อบเสร็จที่รอบนั้น",
  CAKE_BATCH_COMPLETED: "เค้กนี้เสร็จจากรอบอบแล้ว ย้อนสถานะไม่ได้",
  PLAN_CHANGED: "แผนอบเปลี่ยนไประหว่างที่ดูอยู่ (มีออเดอร์ใหม่หรืออีกเครื่องแก้แผน) — โหลดแผนล่าสุดให้แล้ว กรุณาตรวจอีกครั้ง",
  BATCH_NOT_FOUND: "ไม่พบรอบอบ",
  BATCH_LOCKED: "รอบนี้เริ่มอบแล้วหรือปิดแล้ว แก้แผนไม่ได้",
  BATCH_NOT_STARTED: "รอบนี้ยังไม่ได้เริ่มอบ",
  BATCH_CAPACITY_EXCEEDED: "เกินความจุของรอบอบ",
  ITEM_OVER_ALLOCATED: "จัดเค้กลงรอบเกินจำนวนที่สั่ง",
  EMPTY_BATCH: "รอบนี้ยังไม่มีเค้ก",
  ALLOCATION_NOT_FOUND: "ไม่พบรายการในรอบ (อาจถูกย้ายไปแล้ว)",
  INVALID_TARGET: "รอบปลายทางไม่ถูกต้อง",
  MIXED_FLAVORS_NOT_ALLOWED: "ตั้งค่าไว้ว่าไม่ผสมรสในรอบเดียวกัน",
  INVALID_STATION: "สถานีไม่ถูกต้อง",
  MEMBER_NOT_FOUND: "ไม่พบสมาชิก",
  MEMBER_INACTIVE: "สมาชิกนี้ถูกปิดการใช้งาน",
  MEMBERSHIP_DISABLED: "ระบบสมาชิกยังไม่เปิดใช้งาน — เจ้าของร้านเปิดได้ในหน้า สมาชิก > ตั้งค่า",
  CONSENT_REQUIRED: "ต้องยอมรับนโยบายความเป็นส่วนตัวก่อนสมัครสมาชิก",
  INVALID_PHONE: "เบอร์โทรไม่ถูกต้อง",
  PHONE_ALREADY_MEMBER: "เบอร์โทรนี้เป็นสมาชิกอยู่แล้ว",
  PHONE_EXISTS_ASK_STAFF: "เบอร์นี้มีอยู่ในระบบแล้ว กรุณาให้พนักงานที่เคาน์เตอร์ช่วยผูกบัญชี",
  ALREADY_MEMBER: "ลูกค้านี้เป็นสมาชิกอยู่แล้ว",
  LINE_ALREADY_LINKED: "บัญชี LINE นี้ผูกกับสมาชิกอื่นอยู่แล้ว",
  ALREADY_LINKED: "สมาชิกนี้ผูก LINE แล้ว",
  NOT_LINKED: "สมาชิกนี้ยังไม่ได้ผูก LINE",
  BIRTHDAY_LOCKED: "วันเกิดตั้งแล้วแก้เองไม่ได้ กรุณาติดต่อพนักงาน",
  REGISTRATION_REQUIRED: "กรุณากรอกข้อมูลสมัครสมาชิก",
  COUPON_NOT_FOUND: "ไม่พบคูปอง",
  COUPON_NOT_OWNED: "คูปองนี้ไม่ใช่ของสมาชิกที่เลือก",
  COUPON_REQUIRES_MEMBER: "ใช้คูปองต้องเลือกสมาชิกก่อน",
  COUPON_ALREADY_USED: "คูปองนี้ถูกใช้ไปแล้ว",
  COUPON_EXPIRED: "คูปองหมดอายุแล้ว",
  COUPON_CANCELLED: "คูปองนี้ถูกยกเลิกแล้ว",
  COUPON_MIN_SPEND: "ยอดซื้อยังไม่ถึงขั้นต่ำของคูปอง",
  COUPON_TIER_NOT_ELIGIBLE: "ระดับสมาชิกยังไม่ถึงเงื่อนไขของคูปองนี้",
  COUPON_NEEDS_CHECKOUT: "คูปองส่วนลดต้องใช้ตอนชำระเงิน",
  DISCOUNT_CONFLICT: "ใช้ส่วนลดอื่นร่วมกับคูปองไม่ได้",
  TEMPLATE_NOT_FOUND: "ไม่พบรางวัลนี้หรือปิดใช้งานแล้ว",
  CLAIM_NOT_STARTED: "ยังไม่ถึงเวลาเริ่มรับสิทธิ์",
  CLAIM_ENDED: "หมดเวลารับสิทธิ์แล้ว",
  QUANTITY_EXCEEDED: "สิทธิ์นี้ถูกแลกครบจำนวนแล้ว",
  INSUFFICIENT_POINTS: "แต้มไม่พอ",
  INSUFFICIENT_BALANCE: "ยอดคงเหลือไม่พอ",
  CLAIM_INVALID: "QR ไม่ถูกต้อง",
  CLAIM_USED: "QR นี้ถูกใช้ไปแล้ว",
  CLAIM_EXPIRED: "QR หมดอายุแล้ว",
  CLAIM_WINDOW_PASSED: "เลยเวลาที่รับแต้มย้อนหลังได้",
  ORDER_HAS_MEMBER: "ออเดอร์นี้ผูกสมาชิกแล้ว",
  LAST_OWNER: "ต้องมีเจ้าของร้านที่ใช้งานอยู่อย่างน้อย 1 คน",
};

export function errorCode(message: string | null | undefined): string | null {
  if (!message) return null;
  const m = /^([A-Z][A-Z_]+)(?::|$|\s)/.exec(message.trim());
  return m ? m[1] : null;
}

/** รายละเอียดหลังเครื่องหมาย ":" (เช่น ชื่อสินค้า) */
function detail(message: string): string {
  const i = message.indexOf(":");
  return i >= 0 ? message.slice(i + 1).trim() : "";
}

export function friendlyError(message: string | null | undefined): string {
  if (!message) return "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
  const code = errorCode(message);
  if (code && MESSAGES[code]) {
    const d = detail(message);
    return d && (code === "PRODUCT_SOLD_OUT" || code === "PRICE_NOT_SET") ? `${MESSAGES[code]}: ${d}` : MESSAGES[code];
  }
  if (/row-level security|permission denied/i.test(message)) return MESSAGES.FORBIDDEN;
  if (/duplicate key/i.test(message)) return "มีข้อมูลนี้อยู่แล้ว";
  if (/violates foreign key/i.test(message)) return "ข้อมูลนี้ถูกใช้งานอยู่ ลบหรือแก้ไขไม่ได้";
  if (/fetch failed|network|Failed to fetch/i.test(message)) return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
  return "ทำรายการไม่สำเร็จ กรุณาลองใหม่ (" + message.slice(0, 120) + ")";
}
