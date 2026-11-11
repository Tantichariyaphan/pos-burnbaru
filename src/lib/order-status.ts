export type PrepStatus = "preparing" | "done";
export type PaymentStatus = "paid" | "partially_refunded" | "refunded";

export const PREP_LABEL: Record<PrepStatus, string> = { preparing: "รอทำ", done: "เสร็จแล้ว" };
export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  paid: "ชำระแล้ว",
  partially_refunded: "คืนเงินบางส่วน",
  refunded: "คืนเงินแล้ว",
};
export const METHOD_LABEL = { cash: "เงินสด", transfer: "โอนเงิน" } as const;

/** รอทำ ⇄ เสร็จแล้ว (ทั้งสองทางได้ แต่ย้อนกลับต้องยืนยันที่หน้าจอ) */
export function canChangePrep(from: PrepStatus, to: PrepStatus): boolean {
  return from !== to;
}
export function needsConfirmation(from: PrepStatus, to: PrepStatus): boolean {
  return from === "done" && to === "preparing";
}

/**
 * "ชำระแล้ว" ดูจากการมีรายการชำระเงินเท่านั้น — การกด DONE ไม่ได้ทำให้ออเดอร์ถือว่าชำระแล้ว
 * (การคืนเงินก็ไม่ได้ทำให้ออเดอร์กลับเป็น "ยังไม่ชำระ": ประวัติการรับเงินยังอยู่)
 */
export function isPaid(order: { payments?: unknown[] | null; payment_status?: string | null }): boolean {
  return (order.payments?.length ?? 0) > 0 && order.payment_status != null;
}

export function refundableAmount(total: number, alreadyRefunded: number): number {
  return Math.max(0, total - alreadyRefunded);
}

export function paymentStatusAfterRefund(total: number, alreadyRefunded: number, newRefund: number): PaymentStatus {
  const sum = alreadyRefunded + newRefund;
  if (newRefund <= 0 || sum > total) throw new RangeError("ยอดคืนเงินไม่ถูกต้อง");
  return sum === total ? "refunded" : "partially_refunded";
}

/** หมายเลขออเดอร์ที่แสดงบนจอ/ใบเสร็จ: 7 → "#007" */
export function formatOrderNo(n: number): string {
  return "#" + String(n).padStart(3, "0");
}
