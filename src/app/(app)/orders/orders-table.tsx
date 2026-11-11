"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { refundOrder } from "@/app/actions/orders";
import { Badge, Button, Empty, Field, Modal, Notice, inputCls, newKey } from "@/components/ui";
import { bahtToSatang, formatBaht } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { formatOrderNo, METHOD_LABEL, PAYMENT_LABEL, PREP_LABEL, refundableAmount } from "@/lib/order-status";
import { satangToInput } from "@/lib/queries";
import type { Order } from "@/types/db";

export function OrdersTable({ orders, refunded, canRefund }: { orders: Order[]; refunded: Record<string, number>; canRefund: boolean }) {
  const router = useRouter();
  const [target, setTarget] = useState<Order | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "transfer">("cash");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");

  const open = (o: Order) => {
    setTarget(o);
    setAmount(satangToInput(refundableAmount(o.total_satang, refunded[o.id] ?? 0)));
    setMethod(o.payments[0]?.method ?? "cash");
    setReason(""); setError(null); setKey(newKey());
  };
  const remaining = target ? refundableAmount(target.total_satang, refunded[target.id] ?? 0) : 0;
  const amountSatang = bahtToSatang(amount);
  const valid = amountSatang !== null && amountSatang > 0 && amountSatang <= remaining && reason.trim().length > 0;

  const submit = async () => {
    if (!target || amountSatang === null || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await refundOrder({ idempotencyKey: key, orderId: target.id, amountSatang, method, reason });
      if (!r.ok) return setError(r.error);
      setTarget(null);
      router.refresh();
    } catch {
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กดยืนยันอีกครั้งได้ (ระบบไม่คืนเงินซ้ำ)");
    } finally {
      setBusy(false);
    }
  };

  if (orders.length === 0) return <Empty>ไม่มีออเดอร์ในช่วงวันที่ที่เลือก</Empty>;
  return (
    <>
      <div className="glass overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-stone-100/70 text-xs text-stone-500">
              <tr><th className="p-3">เลขที่</th><th>เวลา</th><th>รายการ</th><th>ชำระ</th><th className="text-right">ยอด</th><th className="text-right">คืนเงิน</th><th>สถานะ</th><th className="pr-3 text-right" /></tr>
            </thead>
            <tbody className="divide-y divide-stone-200/70">
              {orders.map((o) => (
                <tr key={o.id} className="align-top">
                  <td className="tnum p-3 font-semibold">{formatOrderNo(o.order_no)}</td>
                  <td className="tnum whitespace-nowrap py-3 text-stone-600">{formatDateTime(o.created_at)}</td>
                  <td className="py-3">{o.order_items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}{o.discount_satang > 0 && <span className="block text-xs text-paid">ส่วนลด {o.discount_name}: −{formatBaht(o.discount_satang)}</span>}</td>
                  <td className="py-3">{o.payments[0] ? METHOD_LABEL[o.payments[0].method] : "-"}{o.payments[0]?.reference && <span className="block text-xs text-stone-500">อ้างอิง {o.payments[0].reference}</span>}</td>
                  <td className="tnum py-3 text-right font-medium">{formatBaht(o.total_satang)}</td>
                  <td className="tnum py-3 text-right text-refund">{refunded[o.id] ? "−" + formatBaht(refunded[o.id]) : ""}</td>
                  <td className="space-y-1 py-3">
                    <div><Badge tone={o.payment_status === "paid" ? "paid" : "refund"}>{PAYMENT_LABEL[o.payment_status]}</Badge></div>
                    <div><Badge tone={o.prep_status === "preparing" ? "preparing" : "done"}>{PREP_LABEL[o.prep_status]}</Badge></div>
                  </td>
                  <td className="space-x-1 whitespace-nowrap py-3 pr-3 text-right">
                    <Link href={`/receipt/${o.id}`} target="_blank" className="inline-flex min-h-11 items-center rounded-xl px-3 text-matcha-700 active:bg-matcha-50">ใบเสร็จ</Link>
                    {canRefund && refundableAmount(o.total_satang, refunded[o.id] ?? 0) > 0 && (
                      <Button size="sm" variant="danger" onClick={() => open(o)}>คืนเงิน</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={!!target} onClose={() => !busy && setTarget(null)} title={target ? `คืนเงิน ${formatOrderNo(target.order_no)}` : ""}
        footer={
          <div className="flex items-center justify-end gap-2">
            {error && <div className="mr-auto flex-1"><Notice tone="error">{error}</Notice></div>}
            <Button onClick={() => setTarget(null)} disabled={busy}>ยกเลิก</Button>
            <Button variant="danger" size="lg" disabled={!valid || busy} onClick={submit}>ยืนยันคืนเงิน</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Notice tone="info">ยอดที่คืนได้สูงสุด <b>{formatBaht(remaining)}</b> — ออเดอร์เดิมไม่ถูกลบ/แก้ไข ระบบบันทึกเป็นรายการคืนเงินพร้อมเหตุผล</Notice>
          <Field label="จำนวนเงินที่คืน (บาท)">
            <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="คืนเงินทางไหน" hint="คืนเงินสดจะหักจากลิ้นชักของกะที่เปิดอยู่ตอนนี้ — คืนเงินโอนไม่กระทบลิ้นชัก">
            <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as "cash" | "transfer")}>
              <option value="cash">เงินสด</option><option value="transfer">โอนเงิน</option>
            </select>
          </Field>
          <Field label="เหตุผล (จำเป็น)">
            <input className={inputCls} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ทำผิดเมนู / ลูกค้าไม่พอใจ" />
          </Field>
        </div>
      </Modal>
    </>
  );
}
