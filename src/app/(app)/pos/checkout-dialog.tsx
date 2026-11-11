"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { checkout } from "@/app/actions/pos";
import { Icon } from "@/components/icons";
import { QrCode } from "@/components/qr-code";
import { Button, Modal, NumPad, Notice, cn, inputCls, newKey } from "@/components/ui";
import { bahtToSatang, calcChange, formatBaht, quickCashAmounts } from "@/lib/money";
import { lineTotal, toCheckoutItems, type CartDiscount, type CartLine, type CartTotals } from "@/lib/cart";
import { formatOrderNo } from "@/lib/order-status";
import { formatQueueNo, queueUrl } from "@/lib/production";
import { satangToInput } from "@/lib/queries";
import type { Customer, Order } from "@/types/db";

type Method = "cash" | "transfer";

export function CheckoutDialog({
  open, onClose, shiftId, cart, totals, discount, orders, customers, onPaid,
}: {
  open: boolean; onClose: () => void; shiftId: string; cart: CartLine[]; totals: CartTotals;
  discount: CartDiscount | null; orders: Order[]; customers: Customer[] | null; onPaid: () => void;
}) {
  const [method, setMethod] = useState<Method>("cash");
  const [received, setReceived] = useState("");
  const [reference, setReference] = useState("");
  const [confirmedTransfer, setConfirmedTransfer] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ orderId: string; change: number; method: Method; total: number; queue: { queueNo: number; token: string } | null } | null>(null);
  const keyRef = useRef<string>("");
  const lock = useRef(false);

  // เปิดกล่องใหม่ = เริ่มความพยายามชำระใหม่ (key ใหม่) / key เดิมใช้ซ้ำได้เฉพาะตอนลองกดยืนยันซ้ำหลังเน็ตหลุด
  useEffect(() => {
    if (open) {
      keyRef.current = newKey();
      setMethod("cash"); setReceived(""); setReference(""); setConfirmedTransfer(false);
      setCustomerId(""); setError(null); setResult(null); setSubmitting(false); lock.current = false;
    }
  }, [open]);

  const total = totals.total;
  const receivedSatang = method === "cash" ? bahtToSatang(received) : total;
  const change = method === "cash" && receivedSatang !== null ? calcChange(receivedSatang, total) : 0;
  const canConfirm =
    !submitting && total > 0 &&
    (method === "cash" ? receivedSatang !== null && receivedSatang >= total : confirmedTransfer);

  const confirm = async () => {
    if (lock.current || !canConfirm || receivedSatang === null) return;   // กันกดซ้ำ
    lock.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const r = await checkout({
        idempotencyKey: keyRef.current, shiftId, items: toCheckoutItems(cart),
        discountId: discount?.id ?? null, method, receivedSatang,
        reference: method === "transfer" ? reference.trim() || null : null,
        customerId: customerId || null,
      });
      if (!r.ok) { setError(r.error); lock.current = false; return; }
      setResult({ orderId: r.data!.orderId, change, method, total, queue: r.data!.queue ?? null });
      onPaid();
    } catch {
      // ไม่รู้ว่าเซิร์ฟเวอร์บันทึกแล้วหรือยัง → กดยืนยันอีกครั้งได้ (key เดิม = ไม่ตัดเงินซ้ำ)
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — กดยืนยันอีกครั้งได้เลย ระบบจะไม่บันทึกซ้ำ");
      lock.current = false;
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- สำเร็จ ----------
  if (open && result) {
    const paidOrder = orders.find((o) => o.id === result.orderId);
    return (
      <Modal open onClose={onClose} title="ชำระเงินสำเร็จ" dismissable={false}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Link href={`/receipt/${result.orderId}`} target="_blank" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-stone-300 bg-white/80 px-4">
              <Icon name="printer" size={20} /> ใบเสร็จ
            </Link>
            <Button variant="primary" size="lg" onClick={onClose}>ออเดอร์ใหม่</Button>
          </div>
        }
      >
        <div className="py-4 text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-green-100 text-paid"><Icon name="check" size={36} /></div>
          <p className="mt-3 text-lg font-semibold">
            {paidOrder ? `ออเดอร์ ${formatOrderNo(paidOrder.order_no)}` : "บันทึกออเดอร์แล้ว"} · {formatBaht(result.total)}
          </p>
          <p className="text-stone-600">{result.method === "cash" ? "รับเงินสด" : "รับเงินโอน"} — ออเดอร์ย้ายไปรายการ “รอทำ” แล้ว</p>
          {result.method === "cash" && (
            <div className="mt-4 rounded-2xl bg-matcha-50 py-4">
              <div className="text-sm text-stone-600">เงินทอน</div>
              <div className="tnum text-5xl font-bold text-matcha-800">{formatBaht(result.change)}</div>
            </div>
          )}
          {result.queue && (
            <div className="mt-4 flex items-center justify-center gap-4 rounded-2xl border border-stone-200 bg-white py-3" data-testid="queue-ticket">
              <div>
                <div className="text-sm text-stone-600">คิวของลูกค้า</div>
                <div className="tnum text-5xl font-extrabold text-matcha-800" data-testid="queue-no">{formatQueueNo(result.queue.queueNo)}</div>
                <div className="mt-1 flex items-center justify-center gap-1 text-xs text-stone-600"><Icon name="qr" size={16} /> สแกนดูสถานะ</div>
              </div>
              <QrCode value={queueUrl(typeof window === "undefined" ? "" : window.location.origin, result.queue.token)} size={132} label="QR ติดตามคิว" />
            </div>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open} onClose={onClose} wide title="ชำระเงิน" dismissable={!submitting}
      footer={
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            {error && <Notice tone="error">{error}</Notice>}
          </div>
          <Button onClick={onClose} disabled={submitting}>กลับ</Button>
          <Button variant="primary" size="lg" disabled={!canConfirm} onClick={confirm} className="min-w-56">
            {submitting ? "กำลังบันทึก…" : <>ยืนยันรับชำระ <span className="tnum">{formatBaht(total)}</span></>}
          </Button>
        </div>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        {/* สรุปออเดอร์ */}
        <div>
          <h3 className="mb-1 text-sm font-semibold text-stone-500">สรุปออเดอร์</h3>
          <ul className="divide-y divide-stone-200/70 rounded-2xl border border-stone-200 bg-white/80 px-3 text-[15px]">
            {cart.map((l) => (
              <li key={l.key} className="flex justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="tnum font-semibold">{l.qty}×</span> {l.name}
                  {l.addons.length > 0 && <span className="block text-xs text-matcha-700">+ {l.addons.map((a) => a.name).join(", ")}</span>}
                </span>
                <span className="tnum">{formatBaht(lineTotal(l))}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 text-sm">
            {totals.discount > 0 && (
              <>
                <div className="flex justify-between"><dt>รวมรายการ</dt><dd className="tnum">{formatBaht(totals.subtotal)}</dd></div>
                <div className="flex justify-between text-paid"><dt>ส่วนลด {discount?.name}</dt><dd className="tnum">−{formatBaht(totals.discount)}</dd></div>
              </>
            )}
            <div className="flex items-baseline justify-between border-t border-stone-300 pt-2">
              <dt className="text-base font-semibold">ยอดที่ต้องชำระ</dt>
              <dd className="tnum text-4xl font-bold text-matcha-800">{formatBaht(total)}</dd>
            </div>
          </dl>
          {customers && customers.length > 0 && (
            <label className="mt-4 block text-sm">
              <span className="mb-1 block font-medium text-stone-700">ลูกค้า (ไม่บังคับ)</span>
              <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— ไม่ระบุ —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
              </select>
            </label>
          )}
        </div>

        {/* วิธีชำระ */}
        <div>
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="วิธีชำระเงิน">
            {([["cash", "เงินสด", "cash"], ["transfer", "โอนเงิน", "bank"]] as const).map(([m, label, icon]) => (
              <button
                key={m} role="tab" aria-selected={method === m} onClick={() => setMethod(m)} disabled={submitting}
                className={cn(
                  "flex min-h-16 items-center justify-center gap-2 rounded-2xl border text-lg font-semibold",
                  method === m ? "border-matcha-700 bg-matcha-700 text-white" : "border-stone-300 bg-white/80 active:bg-stone-100",
                )}
              >
                <Icon name={icon} size={26} /> {label}
              </button>
            ))}
          </div>

          {method === "cash" ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-baseline justify-between rounded-2xl border border-stone-300 bg-white px-4 py-2">
                <span className="text-sm text-stone-600">รับเงินมา</span>
                <span className="tnum text-3xl font-semibold" data-testid="received">{received === "" ? "฿0" : "฿" + received}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {quickCashAmounts(total).map((s, i) => (
                  <button key={s} onClick={() => setReceived(satangToInput(s))} className="min-h-11 rounded-full border border-stone-300 bg-white px-4 text-sm font-medium active:bg-matcha-50">
                    {i === 0 ? "พอดี " : ""}{formatBaht(s)}
                  </button>
                ))}
              </div>
              <NumPad value={received} onChange={setReceived} />
              <div className={cn("flex items-baseline justify-between rounded-2xl px-4 py-2", receivedSatang !== null && receivedSatang >= total ? "bg-matcha-50" : "bg-stone-100")}>
                <span className="text-sm text-stone-600">เงินทอน</span>
                <span className="tnum text-3xl font-bold text-matcha-800" data-testid="change">
                  {receivedSatang !== null && receivedSatang >= total ? formatBaht(change) : "—"}
                </span>
              </div>
              {receivedSatang !== null && receivedSatang < total && received !== "" && (
                <p className="text-sm text-refund">รับเงินยังไม่ครบ ขาดอีก {formatBaht(total - receivedSatang)}</p>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="flex items-baseline justify-between rounded-2xl border border-stone-300 bg-white px-4 py-3">
                <span className="text-sm text-stone-600">ยอดที่ต้องได้รับ</span>
                <span className="tnum text-3xl font-semibold">{formatBaht(total)}</span>
              </div>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-stone-700">เลขอ้างอิง / 4 ตัวท้ายบัญชี (ถ้ามี)</span>
                <input className={inputCls} value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} placeholder="เช่น เลขที่รายการจากสลิป" />
              </label>
              <label className="flex min-h-14 items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3">
                <input type="checkbox" className="mt-1 size-6 accent-matcha-700" checked={confirmedTransfer} onChange={(e) => setConfirmedTransfer(e.target.checked)} />
                <span className="text-[15px]">
                  <b>ฉันตรวจสอบแล้วว่าเงินเข้าบัญชีครบ {formatBaht(total)}</b>
                  <span className="block text-xs text-stone-600">ตรวจจากแอปธนาคาร/ข้อความแจ้งเงินเข้า — ไม่ใช่แค่ดูสลิปจากลูกค้า</span>
                </span>
              </label>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
