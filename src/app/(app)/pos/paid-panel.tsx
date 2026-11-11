"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { completeHandover, reopenHandover } from "@/app/actions/production";
import { setPrepStatus } from "@/app/actions/pos";
import { Icon } from "@/components/icons";
import { Badge, Button, Empty, Modal, Notice, cn } from "@/components/ui";
import { formatBaht } from "@/lib/money";
import { formatTime } from "@/lib/time";
import { formatOrderNo, METHOD_LABEL, PAYMENT_LABEL } from "@/lib/order-status";
import { STATION_ICON, STATION_STATUS_LABEL, formatQueueNo, type Station, type StationStatus } from "@/lib/production";
import type { Order } from "@/types/db";

type Setter = (fn: (orders: Order[]) => Order[]) => void;

const STATION_CHIP: Record<Station, Record<StationStatus, string>> = {
  cake: { queued: "bg-amber-50 text-amber-900 ring-amber-200", preparing: "bg-amber-200 text-amber-950 ring-amber-300", ready: "bg-violet-100 text-violet-900 ring-violet-300" },
  drink: { queued: "bg-emerald-50 text-emerald-900 ring-emerald-200", preparing: "bg-emerald-200 text-emerald-950 ring-emerald-300", ready: "bg-violet-100 text-violet-900 ring-violet-300" },
};

function StationChip({ station, status }: { station: Station; status: StationStatus | null }) {
  if (!status) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1", STATION_CHIP[station][status])}>
      <span aria-hidden>{STATION_ICON[station]}</span>{STATION_STATUS_LABEL[status]}{status === "ready" && <span aria-hidden> ✓</span>}
    </span>
  );
}

export function PaidPanel({
  orders, error, setOrders, track, onToast, onShowQr,
}: {
  orders: Order[]; error: string | null; setOrders: Setter;
  /** ครอบการเปลี่ยนสถานะ: ระหว่างทำ polling จะไม่ทับหน้าจอ และจบแล้วโหลดสถานะจริงเสมอ */
  track: <R,>(fn: () => Promise<R>) => Promise<R>;
  onToast: (tone: "success" | "error", text: string) => void;
  onShowQr: (o: Order) => void;
}) {
  const [tab, setTab] = useState<"preparing" | "done">("preparing");
  const [revert, setRevert] = useState<Order | null>(null);
  const [forceDone, setForceDone] = useState<Order | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const inflight = useRef<Set<string>>(new Set());   // กันกดซ้ำแบบ "ทันที" (ก่อน React render รอบถัดไป)

  const preparing = useMemo(
    () => orders.filter((o) => o.prep_status === "preparing").sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [orders],
  );
  const done = useMemo(
    () => orders.filter((o) => o.prep_status === "done").sort((a, b) => (b.prepared_at ?? b.created_at).localeCompare(a.prepared_at ?? a.created_at)),
    [orders],
  );
  const list = tab === "preparing" ? preparing : done;

  const change = (o: Order, status: "preparing" | "done", force = false) => {
    if (inflight.current.has(o.id)) return;     // กดซ้ำ → ไม่ส่งคำขอซ้ำ
    inflight.current.add(o.id);
    setBusy(new Set(inflight.current));
    const original = o;
    // หน้าจอเปลี่ยนทันที (optimistic) — ไม่ประกาศความสำเร็จจนกว่าเซิร์ฟเวอร์ยืนยัน และถ้าล้มเหลวจะคืนค่าเดิม
    setOrders((list) => list.map((x) => (x.id === o.id
      ? { ...x, prep_status: status, prepared_at: status === "done" ? new Date().toISOString() : null }
      : x)));
    void track(async () => {
      // มีคิว → ส่งมอบ/เปิดคิวใหม่ผ่านระบบคิว (ซิงก์สถานีให้); ไม่มีคิว (ออเดอร์เก่า) → ปุ่มเดิม
      // ไม่ส่ง expectedVersion ตอน DONE: การกดไปข้างหน้าเป็น idempotent และเซิร์ฟเวอร์ตรวจ "พร้อมหรือยัง" จากสถานะปัจจุบันเอง
      // (ถ้าส่ง version จากหน้าจอที่ค้าง จะเด้ง STALE_STATE ทำให้ต้องกดซ้ำ)
      const r = o.queue
        ? status === "done"
          ? await completeHandover({ orderId: o.id, force })
          : await reopenHandover({ orderId: o.id, expectedVersion: o.queue.version })
        : await setPrepStatus({ orderId: o.id, status });
      if (!r.ok) throw new Error(r.error);
    })
      .catch((e: unknown) => {
        setOrders((list) => list.map((x) => (x.id === o.id ? original : x)));
        onToast("error", e instanceof Error && e.message ? e.message : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง");
      })
      .finally(() => {
        inflight.current.delete(o.id);
        setBusy(new Set(inflight.current));
      });
  };

  const onDone = (o: Order) => {
    // งานยังไม่ครบ (เช่น เครื่องดื่มยังไม่พร้อม) → ถามก่อนส่งมอบ; ไม่ใช่ทุกครั้ง
    if (o.queue && o.queue.status !== "ready") setForceDone(o);
    else change(o, "done");
  };

  return (
    <div className="glass flex h-full min-h-0 flex-col rounded-3xl">
      <div className="flex items-center gap-2 px-3 pt-3">
        <h2 className="text-base font-semibold">✅ ออเดอร์ที่ชำระแล้ว</h2>
        <Link href="/production" className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm text-matcha-700 active:bg-matcha-50">
          <Icon name="flame" size={18} /> งานผลิต
        </Link>
        <Link href="/orders" className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm text-matcha-700 active:bg-matcha-50">
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
              const q = o.queue ?? null;
              const isBusy = busy.has(o.id);
              return (
                <li key={o.id} data-order-id={o.id} className={cn("rounded-2xl border bg-white/90 p-2.5", o.prep_status === "preparing" ? "border-sky-200" : "border-stone-200")}>
                  <div className="flex items-center gap-2">
                    {q && <span className="tnum rounded-lg bg-matcha-700 px-2 py-0.5 text-lg font-extrabold text-white" data-testid="queue-chip">{formatQueueNo(q.queue_no)}</span>}
                    <span className={cn("tnum font-bold", q ? "text-sm text-stone-600" : "text-lg")}>{formatOrderNo(o.order_no)}</span>
                    <span className="tnum text-xs text-stone-500">{formatTime(o.created_at)}</span>
                    <span className="ml-auto tnum font-semibold">{formatBaht(o.total_satang)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge tone={refunded ? "refund" : "paid"}>{PAYMENT_LABEL[o.payment_status]}</Badge>
                    {pay && <Badge tone="neutral">{METHOD_LABEL[pay.method]}</Badge>}
                    <Badge tone={o.prep_status === "preparing" ? "preparing" : "done"}>{o.prep_status === "preparing" ? "รอทำ" : "เสร็จแล้ว"}</Badge>
                    {q && q.status !== "completed" && q.status !== "cancelled" && (
                      <>
                        <StationChip station="cake" status={q.cake_status} />
                        <StationChip station="drink" status={q.drink_status} />
                      </>
                    )}
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
                      <Button variant="success" size="md" className="min-h-14 flex-1 text-lg" disabled={isBusy} onClick={() => onDone(o)} aria-busy={isBusy}>
                        <Icon name="check" size={22} /> {isBusy ? "กำลังบันทึก…" : q?.status === "ready" ? "ส่งมอบ DONE" : "DONE"}
                      </Button>
                    ) : (
                      <Button size="md" className="min-h-14 flex-1" disabled={isBusy} onClick={() => setRevert(o)} aria-busy={isBusy}>
                        <Icon name="undo" size={18} /> {isBusy ? "กำลังบันทึก…" : "ย้อนกลับไปรอทำ"}
                      </Button>
                    )}
                    {q && (
                      <button
                        onClick={() => onShowQr(o)} aria-label={`QR คิว ${formatQueueNo(q.queue_no)}`}
                        className="grid size-14 place-items-center rounded-xl border border-stone-300 bg-white/80 text-stone-700 active:bg-stone-100"
                      >
                        <Icon name="qr" size={24} />
                      </button>
                    )}
                    <Link
                      href={`/receipt/${o.id}`} target="_blank" aria-label={`ใบเสร็จ ${formatOrderNo(o.order_no)}`}
                      className="grid size-14 place-items-center rounded-xl border border-stone-300 bg-white/80 text-stone-700 active:bg-stone-100"
                    >
                      <Icon name="printer" size={22} />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal
        open={!!forceDone} onClose={() => setForceDone(null)} title="ส่งมอบทั้งที่งานยังไม่ครบ?"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setForceDone(null)}>ยังก่อน</Button>
            <Button variant="success" onClick={() => { if (forceDone) change(forceDone, "done", true); setForceDone(null); }}>ส่งมอบเลย</Button>
          </div>
        }
      >
        {forceDone?.queue && (
          <div className="space-y-2">
            <p>ออเดอร์ {formatQueueNo(forceDone.queue.queue_no)} ยังไม่ครบทุกสถานี:</p>
            <div className="flex flex-wrap gap-1.5">
              <StationChip station="cake" status={forceDone.queue.cake_status} />
              <StationChip station="drink" status={forceDone.queue.drink_status} />
            </div>
            <p className="text-sm text-stone-600">การส่งมอบจะปิดคิวนี้ทันที (บันทึกใน audit log) — ถ้าแค่รอให้ครบ ให้กด “ยังก่อน”</p>
          </div>
        )}
      </Modal>

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
