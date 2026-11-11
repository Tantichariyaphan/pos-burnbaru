import { test } from "node:test";
import assert from "node:assert/strict";
import { cashVariance, computeShiftSummary, expectedCash, type ShiftInputs } from "../../src/lib/shift";

test("expectedCash = เปิด + ขายสด + เข้า − ออก − คืนสด", () => {
  assert.equal(expectedCash({ openingCash: 100000, cashSales: 31910, cashIn: 20000, cashOut: 50000, cashRefunds: 19700 }), 82210);
  assert.equal(cashVariance(82000, 82210), -210);
  assert.equal(cashVariance(82500, 82210), 290);
  assert.equal(cashVariance(82210, 82210), 0);
});

// สถานการณ์เดียวกับ supabase/tests/financial.test.sql (หัวข้อ G) — ตัวเลขต้องตรงกับที่ฐานข้อมูลคำนวณ
const scenario: ShiftInputs = {
  openingCash: 100000,
  orders: [
    { subtotal: 19700, discount: 0 },
    { subtotal: 5900, discount: 0 },
    { subtotal: 5900, discount: 590 },
    { subtotal: 6900, discount: 0 },
  ],
  payments: [
    { method: "cash", amount: 19700 },
    { method: "transfer", amount: 5900 },
    { method: "cash", amount: 5310 },
    { method: "cash", amount: 6900 },
  ],
  refunds: [
    { method: "cash", amount: 1000 }, { method: "cash", amount: 18700 },
    { method: "transfer", amount: 5900 }, { method: "transfer", amount: 6900 },
  ],
  movements: [
    { direction: "in", channel: "cash", amount: 20000 },
    { direction: "out", channel: "cash", amount: 30000 },
    { direction: "out", channel: "transfer", amount: 50000 },
    { direction: "out", channel: "cash", amount: 20000 }, // กลับรายการเงินเข้า
  ],
};

test("computeShiftSummary ตรงกับตัวเลขที่ SQL ยืนยันไว้", () => {
  const s = computeShiftSummary(scenario);
  assert.equal(s.total_sales_satang, 38400);
  assert.equal(s.discounts_satang, 590);
  assert.equal(s.refunds_satang, 32500);
  assert.equal(s.net_sales_satang, 5310);
  assert.equal(s.cash_sales_satang, 31910);
  assert.equal(s.transfer_payments_satang, 5900);
  assert.equal(s.cash_refunds_satang, 19700);
  assert.equal(s.transfer_refunds_satang, 12800);
  assert.equal(s.cash_in_satang, 20000);
  assert.equal(s.cash_out_satang, 50000);
  assert.equal(s.transfer_out_satang, 50000);
  assert.equal(s.expected_cash_satang, 82210);
  assert.equal(s.order_count, 4);
  assert.equal(s.cash_order_count, 3);
  assert.equal(s.transfer_order_count, 1);
});

test("เงินโอนไม่เข้าลิ้นชัก: รายรับ/รายจ่ายโอนไม่เปลี่ยน expected cash", () => {
  const base = computeShiftSummary({ openingCash: 50000, orders: [], payments: [], refunds: [], movements: [] });
  const withTransfers = computeShiftSummary({
    openingCash: 50000,
    orders: [{ subtotal: 9000, discount: 0 }],
    payments: [{ method: "transfer", amount: 9000 }],
    refunds: [{ method: "transfer", amount: 1000 }],
    movements: [
      { direction: "out", channel: "transfer", amount: 30000 },
      { direction: "in", channel: "transfer", amount: 5000 },
    ],
  });
  assert.equal(base.expected_cash_satang, 50000);
  assert.equal(withTransfers.expected_cash_satang, 50000);
  assert.equal(withTransfers.net_sales_satang, 9000 - 1000);
});

test("รายจ่ายเงินสดลดลิ้นชักแต่ไม่ลดยอดขาย; คืนเงินไม่นับซ้ำเป็นรายจ่าย", () => {
  const s = computeShiftSummary({
    openingCash: 0,
    orders: [{ subtotal: 10000, discount: 0 }],
    payments: [{ method: "cash", amount: 10000 }],
    refunds: [{ method: "cash", amount: 2000 }],
    movements: [{ direction: "out", channel: "cash", amount: 3000 }],
  });
  assert.equal(s.net_sales_satang, 8000);      // ขาย − คืน (ไม่หักรายจ่าย)
  assert.equal(s.cash_out_satang, 3000);       // รายจ่ายไม่รวมการคืนเงิน
  assert.equal(s.expected_cash_satang, 5000);  // 10000 − 2000 − 3000
});

test("กะว่าง", () => {
  const s = computeShiftSummary({ openingCash: 0, orders: [], payments: [], refunds: [], movements: [] });
  assert.equal(s.expected_cash_satang, 0);
  assert.equal(s.net_sales_satang, 0);
  assert.equal(s.order_count, 0);
});
