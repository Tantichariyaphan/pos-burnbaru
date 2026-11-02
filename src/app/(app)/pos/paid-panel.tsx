"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { setPrepStatus } from "@/app/actions/pos";
import { Icon } from "@/components/icons";
import { Badge, Button, Empty, Modal, Notice, cn } from "@/components/ui";
import { formatBaht } from "@/lib/money";
import { formatTime } from "@/lib/time";
import { formatOrderNo, METHOD_LABEL, PAYMENT_LABEL } from "@/lib/order-status";
import type { Order } from "@/types/db";

export function PaidPanel({
  orders, error, onChanged, onToast, onOrdersChange,
}: {
  orders: Order[]; error: string | null; onChanged: () => void | Promise<void>;
  onToast: (tone: "success" | "error", text: string) => void; onOrdersChange: (o: Order[]) => void;
}) {
  const [tab, setTab] = useState<"preparing" | "done">("preparing");
  const [revert, setRevert] = useState<Order | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  // รอทำ: เก่าสุดขึ้นก่อน (ทำตามลำดับที่สั่ง)  เสร็จแล้ว: ล่าสุดขึ้นก่อน
  const preparing = useMemo(
    () => orders.filter((o) => o.prep_status === "preparing").sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [orders],
  );
  const done = useMemo(
    () => orders.filter((o) => o.prep_status === "done").sort((a, b) => (b.prepared_at ?? b.created_at).localeCompare(a.prepared_at ?? a.created_at)),
    [orders],
  );
  const list = tab === "preparing" ? preparing : done;

  const change = (o: Order, status: "preparing" | "done") => {
    setBusy(o.id);
    const before = orders;
    // อัปเดตหน้าจอทันที แล้วค่อยยืนยันกับเซิร์ฟเวอร์ (ถ้าล้มเหลวจะย้อนกลับ)
    onOrdersChange(orders.map((x) => (x.id === o.id ? { ...x, prep_status: status, prepared_at: status === "done" ? new Date().toISOString() : null } : x)));
    start(async () => {
      try {
        const r = await setPrepStatus({ orderId: o.id, status });
        if (!r.ok) { onOrdersChange(before); onToast("error", r.error); }
      } catch {
        onOrdersChange(before);
        onToast("error", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง");
      } finally {
        setBusy(null);
        void onChanged();
      }
    });
  };

  return (
    <div className="glass flex h-full min-h-0 flex-col rounded-3xl">
      <div className="flex items-center gap-2 px-3 pt-3">
        <h2 className="text-base font-semibold">✅ ออเดอร์ที่ชำระแล้ว</h2>
        <Link href="/orders" className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm text-matcha-700 active:bg-matcha-50">
          ประวัติ
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-1.5 px-3 pb-2 pt-1" role="tablist">
        {([["preparing", "รอทำ", preparing.length], ["done", "เสร็จแล้ว", done.length]] as const).map(([k, label, n]) => (
          <button
            key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("min-h-11 rounded-xl text-sm font-medium", tab === k ? (k === "preparing" ? "bg-preparing text-white" : "bg-done text-white") : "bg-white/70 text-stone-600 active:bg-stone-100")}
          >
            {label} <span className="tnum">({n})</span>
          </button>
        ))}
      </div>

      <div className="scroll-y min-h-0 flex-1 px-3 pb-3">
        {error && <div className="mb-2"><Notice tone="error">โหลดรายการล่าสุดไม่สำเร็จ: {error}</Notice></div>}
        {list.length === 0 ? (
          <Empty>{tab === "preparing" ? "ไม่มีออเดอร์ที่รอทำ 🎉" : "ยังไม่มีออเดอร์ที่เสร็จวันนี้"}</Empty>
        ) : (
          <ul className="space-y-2">
            {list.map((o) => {
              const pay = o.payments[0];
              const refunded = o.payment_status !== "paid";
              return (
                <li key={o.id} className={cn("rounded-2xl border bg-white/90 p-2.5", o.prep_status === "preparing" ? "border-sky-200" : "border-stone-200")}>
                  <div className="flex items-center gap-2">
                    <span className="tnum text-lg font-bold">{formatOrderNo(o.order_no)}</span>
                    <span className="tnum text-xs text-stone-500">{formatTime(o.created_at)}</span>
                    <span className="ml-auto tnum font-semibold">{formatBaht(o.total_satang)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge tone={refunded ? "refund" : "paid"}>{PAYMENT_LABEL[o.payment_status]}</Badge>
                    {pay && <Badge tone="neutral">{METHOD_LABEL[pay.method]}</Badge>}
                    <Badge tone={o.prep_status === "preparing" ? "preparing" : "done"}>{o.prep_status === "preparing" ? "รอทำ" : "เสร็จแล้ว"}</Badge>
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-[15px]">
                    {o.order_items.map((i) => (
                      <li key={i.id}>
                        <span className="tnum font-semibold">{i.quantity}×</span> {i.product_name}
                        {i.addons.length > 0 && <span className="text-xs text-matcha-700"> (+{i.addons.map((a) => a.name).join(", ")})</span>}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex items-center gap-2">
                    {o.prep_status === "preparing" ? (
                      <Button variant="success" size="md" className="flex-1" disabled={busy === o.id} onClick={() => change(o, "done")}>
                        <Icon name="check" size={20} /> DONE
                      </Button>
                    ) : (
                      <Button size="md" className="flex-1" disabled={busy === o.id} onClick={() => setRevert(o)}>
                        <Icon name="undo" size={18} /> ย้อนกลับไปรอทำ
                      </Button>
                    )}
                    <Link
                      href={`/receipt/${o.id}`} target="_blank" aria-label={`ใบเสร็จ ${formatOrderNo(o.order_no)}`}
                      className="grid size-11 place-items-center rounded-xl border border-stone-300 bg-white/80 text-stone-700 active:bg-stone-100"
                    >
                      <Icon name="printer" size={20} />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal
        open={!!revert} onClose={() => setRevert(null)} title="ย้อนกลับไปสถานะ “รอทำ”?"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setRevert(null)}>ไม่ย้อน</Button>
            <Button variant="primary" onClick={() => { if (revert) change(revert, "preparing"); setRevert(null); }}>ยืนยันย้อนกลับ</Button>
          </div>
        }
      >
        <p>ออเดอร์ {revert && formatOrderNo(revert.order_no)} จะกลับไปอยู่ในรายการ “รอทำ” (สถานะการชำระเงินไม่เปลี่ยน)</p>
      </Modal>
    </div>
  );
}
