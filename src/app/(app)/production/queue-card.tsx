"use client";
import { Button, cn } from "@/components/ui";
import { Icon } from "@/components/icons";
import {
  QUEUE_STATUS_LABEL, STATION_ICON, STATION_LABEL, STATION_STATUS_LABEL, elapsedMinutes, formatElapsed, formatQueueNo,
  type SnapshotItem, type SnapshotQueue, type Station, type StationStatus,
} from "@/lib/production";

export type StationFilter = Station | "all";

export interface CardActions {
  pending: ReadonlySet<string>;
  onStation: (q: SnapshotQueue, station: Station, target: StationStatus) => void;
  onHandover: (q: SnapshotQueue) => void;
  onReopen: (q: SnapshotQueue) => void;
}

const STATION_CHIP: Record<Station, Record<StationStatus, string>> = {
  cake: { queued: "bg-amber-50 text-amber-900 ring-amber-300", preparing: "bg-amber-300 text-amber-950 ring-amber-500", ready: "bg-violet-200 text-violet-950 ring-violet-400" },
  drink: { queued: "bg-emerald-50 text-emerald-900 ring-emerald-300", preparing: "bg-emerald-300 text-emerald-950 ring-emerald-500", ready: "bg-violet-200 text-violet-950 ring-violet-400" },
};
export function StationChip({ station, status }: { station: Station; status: StationStatus | null }) {
  if (!status) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold ring-1", STATION_CHIP[station][status])}>
      <span aria-hidden>{STATION_ICON[station]}</span>{STATION_LABEL[station]}: {STATION_STATUS_LABEL[status]}{status === "ready" && <span aria-hidden> ✓</span>}
    </span>
  );
}

const ACCENT: Record<StationFilter, string> = {
  cake: "border-l-amber-500", drink: "border-l-emerald-600", all: "border-l-violet-500",
};

function Items({ items, station }: { items: SnapshotItem[]; station: Station }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1">
      {items.map((i) => (
        <li key={i.id} className="flex flex-wrap items-baseline gap-x-2 text-lg leading-snug">
          <span className="tnum min-w-9 text-2xl font-extrabold">{i.quantity}×</span>
          <span className="font-semibold">{i.name}</span>
          {i.addons.length > 0 && <span className="text-sm text-stone-600">(+{i.addons.join(", ")})</span>}
          {station === "cake" && i.quantity > 1 && i.ready_quantity > 0 && i.status !== "ready" && (
            <span className="tnum rounded-md bg-violet-100 px-1.5 text-sm font-semibold text-violet-900">พร้อมแล้ว {i.ready_quantity}/{i.quantity}</span>
          )}
          {station === "cake" && i.batches.filter((b) => b.status !== "completed").map((b, idx) => (
            <span key={idx} className={cn("rounded-md px-1.5 text-sm font-semibold", b.status === "baking" ? "bg-amber-300 text-amber-950" : "bg-stone-200 text-stone-800")}>
              {b.status === "baking" ? "🔥 กำลังอบ" : "วางแผน"} รอบ #{b.batch_no} <span className="tnum">({b.quantity})</span>
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

export function QueueCard({ q, filter, nowMs, actions }: { q: SnapshotQueue; filter: StationFilter; nowMs: number; actions: CardActions }) {
  const min = elapsedMinutes(q.created_at, nowMs);
  const late = min >= 20 ? "text-refund" : min >= 10 ? "text-amber-700" : "text-stone-600";
  const cake = q.items.filter((i) => i.station === "cake");
  const drink = q.items.filter((i) => i.station === "drink");
  const key = (s: Station) => `${q.order_id}:${s}`;
  const handoverKey = `${q.order_id}:handover`;
  const closed = q.status === "completed" || q.status === "cancelled";

  const drinkButton = () => {
    const st = q.drink_status;
    if (!st) return null;
    const busy = actions.pending.has(key("drink"));
    if (st === "queued") return <Button variant="primary" size="lg" className="w-full !bg-emerald-700" disabled={busy} onClick={() => actions.onStation(q, "drink", "preparing")}>▶ เริ่มทำ</Button>;
    if (st === "preparing") return <Button variant="success" size="lg" className="w-full" disabled={busy} onClick={() => actions.onStation(q, "drink", "ready")}><Icon name="check" size={24} /> พร้อมแล้ว</Button>;
    return <Button size="md" className="min-h-14 w-full" disabled={busy || closed} onClick={() => actions.onStation(q, "drink", "preparing")}><Icon name="undo" size={18} /> ย้อนกลับ (กำลังทำ)</Button>;
  };
  const cakeButton = () => {
    const st = q.cake_status;
    if (!st || st === "ready") return null;
    const baking = cake.some((i) => i.batches.some((b) => b.status === "baking"));
    const planned = cake.some((i) => i.batches.some((b) => b.status === "planning"));
    const busy = actions.pending.has(key("cake"));
    if (baking) return <div className="rounded-xl bg-amber-100 px-3 py-3 text-center font-semibold text-amber-950">🔥 กำลังอบ — เสร็จเมื่อกด “อบเสร็จ” ที่รอบอบ</div>;
    return (
      <div className="space-y-1">
        {!planned && <div className="rounded-xl bg-stone-100 px-3 py-2 text-center text-sm text-stone-700">ยังไม่อยู่ในแผนรอบอบ — ยืนยันแผนที่แผงรอบอบ</div>}
        <Button size="md" className="min-h-14 w-full" disabled={busy} onClick={() => actions.onStation(q, "cake", "ready")}>พร้อมแล้ว (ไม่ผ่านรอบอบ)</Button>
      </div>
    );
  };

  return (
    <article className={cn("rounded-2xl border border-l-8 bg-white/95 p-3 shadow-sm", ACCENT[filter], q.status === "ready" && "ring-2 ring-violet-400")} data-queue={q.queue_no} data-status={q.status}>
      <header className="flex flex-wrap items-center gap-2">
        <span className="tnum text-4xl font-extrabold leading-none text-matcha-800">{formatQueueNo(q.queue_no)}</span>
        <span className={cn("tnum text-base font-semibold", late)} title="เวลาตั้งแต่ชำระเงิน">⏱ {formatElapsed(min)}</span>
        <span className={cn("ml-auto rounded-full px-3 py-1 text-sm font-bold", q.status === "ready" ? "bg-violet-600 text-white" : q.status === "preparing" ? "bg-sky-100 text-sky-900" : closed ? "bg-stone-200 text-stone-700" : "bg-stone-100 text-stone-800")}>
          {q.status === "ready" && "🔔 "}{QUEUE_STATUS_LABEL[q.status]}
        </span>
      </header>

      {(filter === "all" || filter === "cake") && cake.length > 0 && (
        <section className="mt-2" aria-label="เค้ก">
          {filter === "all" && <div className="mb-1"><StationChip station="cake" status={q.cake_status} /></div>}
          <Items items={cake} station="cake" />
        </section>
      )}
      {(filter === "all" || filter === "drink") && drink.length > 0 && (
        <section className="mt-2" aria-label="เครื่องดื่ม">
          {filter === "all" && <div className="mb-1"><StationChip station="drink" status={q.drink_status} /></div>}
          <Items items={drink} station="drink" />
        </section>
      )}
      {filter === "cake" && drink.length > 0 && <div className="mt-2"><StationChip station="drink" status={q.drink_status} /></div>}
      {filter === "drink" && cake.length > 0 && <div className="mt-2"><StationChip station="cake" status={q.cake_status} /></div>}

      <footer className="mt-3 space-y-2">
        {filter === "drink" && drinkButton()}
        {filter === "cake" && cakeButton()}
        {filter === "all" && !closed && (
          <>
            {q.drink_status && q.drink_status !== "ready" && drinkButton()}
            {q.cake_status && q.cake_status !== "ready" && cakeButton()}
          </>
        )}
        {filter === "all" && q.status === "ready" && (
          <Button variant="success" size="lg" className="w-full !bg-violet-700" disabled={actions.pending.has(handoverKey)} onClick={() => actions.onHandover(q)}>
            <Icon name="check" size={24} /> ส่งมอบให้ลูกค้าแล้ว
          </Button>
        )}
        {filter === "all" && q.status === "completed" && (
          <Button size="md" className="min-h-14 w-full" disabled={actions.pending.has(handoverKey)} onClick={() => actions.onReopen(q)}><Icon name="undo" size={18} /> ย้อนการส่งมอบ</Button>
        )}
        {filter === "all" && !closed && q.status !== "ready" && (
          <button className="min-h-11 w-full rounded-xl text-sm text-stone-500 underline-offset-2 active:bg-stone-100" disabled={actions.pending.has(handoverKey)} onClick={() => actions.onHandover(q)}>
            ส่งมอบทั้งที่งานยังไม่ครบ…
          </button>
        )}
      </footer>
    </article>
  );
}
