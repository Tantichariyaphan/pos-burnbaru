import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canChangePrep, formatOrderNo, isPaid, needsConfirmation, paymentStatusAfterRefund, refundableAmount,
} from "../../src/lib/order-status";
import { errorCode, friendlyError } from "../../src/lib/errors";
import { addDays, bangkokToday, isIsoDate } from "../../src/lib/time";
import { can, NAV } from "../../src/lib/roles";

test("DONE ไม่ได้ทำให้ออเดอร์ 'ชำระแล้ว' — ดูจากรายการชำระเงินเท่านั้น", () => {
  assert.equal(isPaid({ payments: [], payment_status: "paid" }), false);
  assert.equal(isPaid({ payments: null, payment_status: "paid" }), false);
  assert.equal(isPaid({ payments: [{}], payment_status: "paid" }), true);
  // คืนเงินแล้วก็ยังมีประวัติการรับเงิน
  assert.equal(isPaid({ payments: [{}], payment_status: "refunded" }), true);
});

test("สถานะการทำออเดอร์: ย้อนกลับจาก เสร็จแล้ว → รอทำ ต้องยืนยัน", () => {
  assert.equal(canChangePrep("preparing", "done"), true);
  assert.equal(canChangePrep("done", "preparing"), true);
  assert.equal(canChangePrep("done", "done"), false);
  assert.equal(needsConfirmation("done", "preparing"), true);
  assert.equal(needsConfirmation("preparing", "done"), false);
});

test("คืนเงิน: ยอดที่คืนได้และสถานะหลังคืน", () => {
  assert.equal(refundableAmount(19700, 1000), 18700);
  assert.equal(refundableAmount(100, 500), 0);
  assert.equal(paymentStatusAfterRefund(19700, 0, 1000), "partially_refunded");
  assert.equal(paymentStatusAfterRefund(19700, 1000, 18700), "refunded");
  assert.throws(() => paymentStatusAfterRefund(19700, 1000, 18701), RangeError);
  assert.throws(() => paymentStatusAfterRefund(19700, 0, 0), RangeError);
});

test("formatOrderNo", () => {
  assert.equal(formatOrderNo(1), "#001");
  assert.equal(formatOrderNo(42), "#042");
  assert.equal(formatOrderNo(1234), "#1234");
});

test("errors: แปลงรหัสจากฐานข้อมูลเป็นข้อความไทย", () => {
  assert.equal(errorCode("SALES_DISABLED"), "SALES_DISABLED");
  assert.equal(errorCode("PRODUCT_SOLD_OUT: Apple Tea"), "PRODUCT_SOLD_OUT");
  assert.equal(errorCode("permission denied for table orders"), null);
  assert.match(friendlyError("SHIFT_NOT_OPEN"), /เปิดกะ/);
  assert.match(friendlyError("PRODUCT_SOLD_OUT: Apple Tea"), /สินค้าหมด: Apple Tea/);
  assert.match(friendlyError("PRICE_NOT_SET: Matcha Latte"), /Matcha Latte/);
  assert.match(friendlyError("IMMUTABLE_RECORD: DELETE on payments is not allowed"), /คืนเงิน/);
  assert.match(friendlyError('new row violates row-level security policy for table "products"'), /ไม่มีสิทธิ์/);
  assert.match(friendlyError("TypeError: Failed to fetch"), /อินเทอร์เน็ต/);
  assert.match(friendlyError(undefined), /ไม่ทราบสาเหตุ/);
});

test("time: วันที่ธุรกิจเป็นเขตเวลา Asia/Bangkok", () => {
  // 18:30Z วันที่ 29 = 01:30 วันที่ 30 ที่กรุงเทพ
  assert.equal(bangkokToday(new Date("2026-10-29T18:30:00Z")), "2026-10-30");
  assert.equal(bangkokToday(new Date("2026-10-29T16:59:59Z")), "2026-10-29");
  assert.equal(addDays("2026-10-30", -1), "2026-10-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(isIsoDate("2026-10-30"), true);
  assert.equal(isIsoDate("2026-13-40"), false);
  assert.equal(isIsoDate("30/10/2026"), false);
});

test("roles: สิทธิ์ตามบทบาท", () => {
  assert.equal(can("cashier", "pos"), true);
  assert.equal(can("cashier", "reports"), false);
  assert.equal(can("cashier", "orders.refund"), false);
  assert.equal(can("manager", "orders.refund"), true);
  assert.equal(can("manager", "employees"), false);
  assert.equal(can("owner", "settings"), true);
  assert.equal(can(null, "pos"), false);
  const cashierNav = NAV.filter((n) => can("cashier", n.perm)).map((n) => n.href);
  assert.deepEqual(cashierNav, ["/pos", "/customers", "/cash", "/help"]);
});
