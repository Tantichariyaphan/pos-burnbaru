/**
 * สรุปกะ — นิยามต้องตรงกับ public.compute_shift_summary() ในฐานข้อมูล
 *
 *  total_sales   = Σ ยอดก่อนส่วนลดของออเดอร์ในกะ
 *  net_sales     = total_sales − discounts − refunds (ที่จ่ายคืนในกะนี้)
 *  expected_cash = เงินทอนตั้งต้น + ขายเงินสด + เงินสดเข้า − เงินสดออก − คืนเงินสด
 *  variance      = เงินที่นับได้ − expected_cash
 *  เงินโอนไม่อยู่ในลิ้นชักเงินสด
 */

export interface ShiftSummary {
  opening_cash_satang: number;
  cash_sales_satang: number;
  cash_refunds_satang: number;
  cash_in_satang: number;
  cash_out_satang: number;
  expected_cash_satang: number;
  total_sales_satang: number;
  discounts_satang: number;
  refunds_satang: number;
  net_sales_satang: number;
  cash_payments_satang: number;
  transfer_payments_satang: number;
  transfer_refunds_satang: number;
  transfer_in_satang: number;
  transfer_out_satang: number;
  order_count: number;
  cash_order_count: number;
  transfer_order_count: number;
  /** มีเฉพาะกะที่ปิดแล้ว */
  counted_cash_satang?: number;
  variance_satang?: number;
}

export function expectedCash(p: {
  openingCash: number; cashSales: number; cashIn: number; cashOut: number; cashRefunds: number;
}): number {
  return p.openingCash + p.cashSales + p.cashIn - p.cashOut - p.cashRefunds;
}

export function cashVariance(counted: number, expected: number): number {
  return counted - expected;
}

export type Method = "cash" | "transfer";

export interface ShiftInputs {
  openingCash: number;
  orders: { subtotal: number; discount: number }[];
  payments: { method: Method; amount: number }[];
  refunds: { method: Method; amount: number }[];
  movements: { direction: "in" | "out"; channel: Method; amount: number }[];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function computeShiftSummary(i: ShiftInputs): ShiftSummary {
  const gross = sum(i.orders.map((o) => o.subtotal));
  const discounts = sum(i.orders.map((o) => o.discount));
  const cashSales = sum(i.payments.filter((p) => p.method === "cash").map((p) => p.amount));
  const transferSales = sum(i.payments.filter((p) => p.method === "transfer").map((p) => p.amount));
  const cashRefunds = sum(i.refunds.filter((r) => r.method === "cash").map((r) => r.amount));
  const transferRefunds = sum(i.refunds.filter((r) => r.method === "transfer").map((r) => r.amount));
  const mv = (dir: "in" | "out", ch: Method) =>
    sum(i.movements.filter((m) => m.direction === dir && m.channel === ch).map((m) => m.amount));
  const cashIn = mv("in", "cash");
  const cashOut = mv("out", "cash");
  const refunds = cashRefunds + transferRefunds;
  return {
    opening_cash_satang: i.openingCash,
    cash_sales_satang: cashSales,
    cash_refunds_satang: cashRefunds,
    cash_in_satang: cashIn,
    cash_out_satang: cashOut,
    expected_cash_satang: expectedCash({
      openingCash: i.openingCash, cashSales, cashIn, cashOut, cashRefunds,
    }),
    total_sales_satang: gross,
    discounts_satang: discounts,
    refunds_satang: refunds,
    net_sales_satang: gross - discounts - refunds,
    cash_payments_satang: cashSales,
    transfer_payments_satang: transferSales,
    transfer_refunds_satang: transferRefunds,
    transfer_in_satang: mv("in", "transfer"),
    transfer_out_satang: mv("out", "transfer"),
    order_count: i.orders.length,
    cash_order_count: i.payments.filter((p) => p.method === "cash").length,
    transfer_order_count: i.payments.filter((p) => p.method === "transfer").length,
  };
}
