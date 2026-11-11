"use client";
import { useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { cancelBatch, completeBatch, confirmCakePlan, moveAllocation, startBatch } from "@/app/actions/production";
import { Icon } from "@/components/icons";
import { Button, Modal, cn } from "@/components/ui";
import { BATCH_STATUS_LABEL, formatElapsed, elapsedMinutes, formatQueueNo, type ProductionSnapshot, type SnapshotBatch, type SnapshotBatchItem } from "@/lib/production";

export type Exec = (key: string, call: () => Promise<ActionResult<unknown>>, okText?: string) => void;

function LoadBar({ load, capacity, tone }: { load: number; capacity: number; tone: "amber" | "stone" }) {
  const pct = Math.min(100, Math.round((load / Math.max(1, capacity)) * 100));
  return (
    <div className="flex items-center gap-2" role="meter" aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={load} aria-label="จำนวนเค้กในรอบ">
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-stone-200">
        <div className={cn("h-full rounded-full", tone === "amber" ? "bg-amber-500" : "bg-stone-500")} style={{ width: `${pct}%` }} />
      </div>
      <span className="tnum text-base font-bold">{load}/{capacity}</span>
    </div>
  );
}

function groupItems(items: SnapshotBatchItem[]) {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.product_name, (m.get(i.product_name) ?? 0) + i.quantity);
  return [...m.entries()].map(([name, qty]) => ({ name, qty }));
}

export function BatchPanel({ snap, pending, exec, nowMs }: { snap: ProductionSnapshot; pending: ReadonlySet<string>; exec: Exec; nowMs: number }) {
  const [moving, setMoving] = useState<{ item: SnapshotBatchItem; from: SnapshotBatch } | null>(null);
  const [cancelling, setCancelling] = useState<SnapshotBatch | null>(null);
  const [qty, setQty] = useState(1);

  const active = snap.batches.filter((b) => b.status === "baking" || b.status === "planning");
  const baking = active.filter((b) => b.status === "baking");
  const planning = active.filter((b) => b.status === "planning");
  const plan = snap.plan.batches.filter((p) => p.add_load > 0);
  const planPieces = plan.reduce((s, p) => s + p.add_load, 0);
  const anyBaking = baking.length > 0;

  return (
    <section className="space-y-3" aria-label="รอบอบเค้ก" data-testid="batch-panel">
      <h3 className="flex items-center gap-2 text-lg font-bold text-amber-900"><Icon name="flame" size={22} /> รอบอบเค้ก <span className="text-sm font-normal text-stone-600">(ความจุ {snap.settings.batch_capacity} ชิ้น/รอบ)</span></h3>

      {baking.map((b) => (
        <div key={b.id} className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-3" data-batch-status="baking">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-400 px-3 py-1 text-sm font-bold text-amber-950">🔥 {BATCH_STATUS_LABEL.baking} · รอบ #{b.batch_no}</span>
            {b.started_at && <span className="tnum text-sm text-stone-700">เริ่ม {formatElapsed(elapsedMinutes(b.started_at, nowMs))}ที่แล้ว</span>}
          </div>
          <div className="mt-2"><LoadBar load={b.load} capacity={b.capacity} tone="amber" /></div>
          <ul className="mt-2 space-y-0.5 text-base">
            {groupItems(b.items).map((g) => <li key={g.name}><span className="tnum font-bold">{g.qty}×</span> {g.name}</li>)}
          </ul>
          <p className="mt-1 text-sm text-stone-600">คิว: {[...new Set(b.items.map((i) => i.queue_no))].sort((x, y) => x - y).map(formatQueueNo).join(", ")}</p>
          <Button variant="success" size="lg" className="mt-2 w-full" disabled={pending.has(`batch:${b.id}`)} onClick={() => exec(`batch:${b.id}`, () => completeBatch(b.id), `รอบ #${b.batch_no} อบเสร็จแล้ว`)}>
            <Icon name="check" size={24} /> อบเสร็จ ({b.load} ชิ้น)
          </Button>
        </div>
      ))}

      {planning.map((b) => (
        <div key={b.id} className="rounded-2xl border border-amber-300 bg-white/90 p-3" data-batch-status="planning">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-stone-200 px-3 py-1 text-sm font-bold text-stone-800">📋 {BATCH_STATUS_LABEL.planning} · รอบ #{b.batch_no}</span>
          </div>
          <div className="mt-2"><LoadBar load={b.load} capacity={b.capacity} tone="stone" /></div>
          {b.items.length === 0 ? <p className="mt-2 text-sm text-stone-500">ยังไม่มีเค้กในรอบนี้</p> : (
            <ul className="mt-2 divide-y divide-stone-100">
              {b.items.map((i) => (
                <li key={i.id} className="flex items-center gap-2 py-1">
                  <span className="tnum w-14 font-bold text-matcha-800">{formatQueueNo(i.queue_no)}</span>
                  <span className="min-w-0 flex-1 truncate">{i.product_name}</span>
                  <span className="tnum font-bold">×{i.quantity}</span>
                  <button className="grid size-11 place-items-center rounded-lg text-stone-500 active:bg-stone-200" aria-label={`ย้าย/ถอด ${formatQueueNo(i.queue_no)} ${i.product_name}`} onClick={() => { setMoving({ item: i, from: b }); setQty(i.quantity); }}>
                    <Icon name="menu" size={20} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex gap-2">
            <Button variant="primary" size="lg" className="flex-1 !bg-amber-700" disabled={b.load === 0 || pending.has(`batch:${b.id}`)} onClick={() => exec(`batch:${b.id}`, () => startBatch(b.id), `เริ่มอบรอบ #${b.batch_no}`)}>
              🔥 เริ่มอบ ({b.load} ชิ้น)
            </Button>
            <Button variant="danger" size="lg" className="!px-4" aria-label="ยกเลิกรอบ" disabled={pending.has(`batch:${b.id}`)} onClick={() => setCancelling(b)}><Icon name="trash" size={22} /></Button>
          </div>
        </div>
      ))}

      {/* แผนที่ระบบเสนอ (FIFO) — ยังไม่เปลี่ยนอะไรจนกว่าพนักงานจะยืนยัน */}
      {plan.length > 0 && (
        <div className="rounded-2xl border border-dashed border-amber-500 bg-amber-50/60 p-3" data-testid="cake-plan">
          <h4 className="font-bold text-amber-950">💡 แผนที่เสนอ (เรียงตามคิวที่มาก่อน)</h4>
          <ul className="mt-1 space-y-2">
            {plan.map((p, idx) => (
              <li key={`${p.batch_id ?? "new"}-${idx}`} className="rounded-xl bg-white/80 p-2">
                <div className="flex items-center justify-between gap-2 text-base font-semibold">
                  <span>รอบ #{p.batch_no}{p.is_new && <span className="ml-1 rounded bg-amber-200 px-1.5 text-xs">ใหม่</span>}</span>
                  <span className="tnum">{p.load_after}/{p.capacity} ชิ้น</span>
                </div>
                <ul className="mt-1 text-sm text-stone-700">
                  {p.items.map((i) => <li key={`${i.prep_id}`}><span className="tnum font-semibold">{formatQueueNo(i.queue_no)}</span> {i.product_name} ×{i.quantity}</li>)}
                </ul>
              </li>
            ))}
          </ul>
          <Button variant="primary" size="lg" className="mt-2 w-full !bg-amber-700" disabled={pending.has("plan")} onClick={() => exec("plan", () => confirmCakePlan(snap.plan.signature), "ยืนยันแผนแล้ว")}>
            <Icon name="check" size={22} /> ยืนยันแผน ({planPieces} ชิ้น)
          </Button>
          <p className="mt-1 text-xs text-stone-600">เค้กที่เริ่มอบแล้วจะไม่ถูกย้าย · ยืนยันแล้วยังปรับด้วยมือได้ก่อนกด “เริ่มอบ”</p>
        </div>
      )}
      {plan.length === 0 && active.length === 0 && <p className="rounded-xl bg-white/70 px-3 py-4 text-center text-stone-600">ยังไม่มีเค้กรอรอบอบ</p>}
      {anyBaking && plan.length > 0 && <p className="text-xs text-stone-600">รอบที่กำลังอบไม่ถูกเปลี่ยน — เค้กใหม่ไปอยู่รอบถัดไป</p>}

      <Modal open={!!moving} onClose={() => setMoving(null)} title={moving ? `ย้าย ${formatQueueNo(moving.item.queue_no)} · ${moving.item.product_name}` : ""}>
        {moving && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="font-medium">จำนวนที่ย้าย</span>
              <button className="grid size-14 place-items-center rounded-xl border border-stone-300 text-2xl active:bg-stone-200" aria-label="ลด" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <span className="tnum w-12 text-center text-2xl font-bold">{qty}</span>
              <button className="grid size-14 place-items-center rounded-xl border border-stone-300 text-2xl active:bg-stone-200" aria-label="เพิ่ม" onClick={() => setQty((q) => Math.min(moving.item.quantity, q + 1))}>+</button>
              <span className="text-sm text-stone-600">จาก {moving.item.quantity}</span>
            </div>
            <div className="grid gap-2">
              {planning.filter((b) => b.id !== moving.from.id).map((b) => (
                <Button key={b.id} size="lg" disabled={b.load + qty > b.capacity} onClick={() => { const m = moving; setMoving(null); exec("move", () => moveAllocation({ batchItemId: m.item.id, targetBatchId: b.id, quantity: qty }), `ย้ายไปรอบ #${b.batch_no}`); }}>
                  ไปรอบ #{b.batch_no} <span className="tnum text-sm text-stone-600">({b.load}/{b.capacity}){b.load + qty > b.capacity && " เต็ม"}</span>
                </Button>
              ))}
              <Button variant="danger" size="lg" onClick={() => { const m = moving; setMoving(null); exec("move", () => moveAllocation({ batchItemId: m.item.id, targetBatchId: null, quantity: qty }), "ถอดออกจากแผนแล้ว"); }}>
                ถอดออกจากรอบ (กลับไปรอจัดแผน)
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!cancelling} onClose={() => setCancelling(null)} title={cancelling ? `ยกเลิกรอบ #${cancelling.batch_no}?` : ""}
        footer={<div className="flex gap-2"><Button size="lg" className="flex-1" onClick={() => setCancelling(null)}>ไม่ยกเลิก</Button>
          <Button variant="danger" size="lg" className="flex-1" onClick={() => { const b = cancelling!; setCancelling(null); exec(`batch:${b.id}`, () => cancelBatch(b.id), "ยกเลิกรอบแล้ว"); }}>ยกเลิกรอบ</Button></div>}>
        <p>เค้กในรอบนี้จะกลับไปรอจัดแผนใหม่ (ไม่กระทบออเดอร์หรือยอดขาย)</p>
      </Modal>
    </section>
  );
}
