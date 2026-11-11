"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions";
import { completeHandover, repairQueues, reopenHandover, setStationStatus } from "@/app/actions/production";
import { Icon } from "@/components/icons";
import { Button, Empty, Modal, Notice, cn } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useSyncedResource } from "@/lib/use-synced";
import {
  STATION_ICON, STATION_LABEL, applyHandoverOptimistic, applyStationOptimistic, formatQueueNo,
  type ProductTotal, type ProductionSnapshot, type SnapshotQueue, type Station, type StationStatus,
} from "@/lib/production";
import { QueueCard, type CardActions, type StationFilter } from "./queue-card";
import { BatchPanel, type Exec } from "./batch-panel";
import { ProductionSettings } from "./production-settings";

export type Mode = "split" | "cake" | "drink" | "all";
export interface ConfigData {
  categories: { id: string; name: string }[];
  products: { id: string; name: string; category_id: string | null; is_active: boolean }[];
  categoryStations: Record<string, Station>;
  productStations: Record<string, Station>;
}
type Conn = "connecting" | "live" | "offline";

const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: "split", label: "แยกจอ", icon: "▥" },
  { id: "cake", label: "เค้ก", icon: STATION_ICON.cake },
  { id: "drink", label: "เครื่องดื่ม", icon: STATION_ICON.drink },
  { id: "all", label: "ทุกออเดอร์", icon: "☰" },
];

function useNow(ms = 20_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

const byFifo = (a: SnapshotQueue, b: SnapshotQueue) => a.created_at.localeCompare(b.created_at) || a.queue_no - b.queue_no;

function Totals({ rows, tone }: { rows: ProductTotal[]; tone: "amber" | "emerald" }) {
  if (rows.length === 0) return <p className="text-base text-stone-500">ไม่มีงานค้าง</p>;
  return (
    <ul className="space-y-0.5">
      {rows.map((r) => (
        <li key={r.name} className="flex items-baseline gap-2 text-lg leading-tight">
          <span className={cn("tnum min-w-10 text-2xl font-extrabold", tone === "amber" ? "text-amber-800" : "text-emerald-800")}>{r.waiting + r.in_progress}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
          {r.in_progress > 0 && <span className="tnum text-sm text-stone-600">กำลังทำ {r.in_progress}</span>}
        </li>
      ))}
    </ul>
  );
}

function Tile({ title, big, tone, children, testId }: { title: string; big?: string | number; tone: "amber" | "emerald" | "violet" | "stone"; children?: React.ReactNode; testId?: string }) {
  const cls = { amber: "border-amber-300 bg-amber-50", emerald: "border-emerald-300 bg-emerald-50", violet: "border-violet-300 bg-violet-50", stone: "border-stone-300 bg-white/90" }[tone];
  return (
    <div className={cn("rounded-2xl border p-3", cls)} data-testid={testId}>
      <div className="flex items-baseline gap-2"><h3 className="text-base font-bold">{title}</h3>{big !== undefined && <span className="tnum ml-auto text-4xl font-extrabold leading-none">{big}</span>}</div>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

export function ProductionClient({
  initial, loadError, initialMode, canConfigure, config, employeeName,
}: {
  initial: ProductionSnapshot; loadError: string | null; initialMode: Mode; canConfigure: boolean; config: ConfigData | null; employeeName: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [mode, setModeState] = useState<Mode>(initialMode);
  const [conn, setConn] = useState<Conn>("connecting");
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [reopen, setReopen] = useState<SnapshotQueue | null>(null);
  const [force, setForce] = useState<SnapshotQueue | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const inflight = useRef<Set<string>>(new Set());
  const now = useNow();

  const fetchSnap = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_production_snapshot");
    if (error) throw new Error(error.message);
    return data as ProductionSnapshot;
  }, [supabase]);

  const live = useSyncedResource<ProductionSnapshot>(initial, fetchSnap, {
    intervalMs: conn === "live" ? 30_000 : 5_000,
    errorMessage: () => "โหลดข้อมูลไม่สำเร็จ — แสดงข้อมูลล่าสุด กำลังลองใหม่",
  });
  const snap = live.data;
  const refreshRef = useRef(live.refresh);
  refreshRef.current = live.refresh;

  // Realtime: ถ้าได้สิทธิ์ก็รับการเปลี่ยนแปลงทันที; ไม่ได้ก็ใช้ polling (5 วิ) แทน
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const kick = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void refreshRef.current(), 250); };
    const ch = supabase.channel("production-kds");
    for (const table of ["order_queues", "item_preparations", "production_batches", "batch_items"]) {
      ch.on("postgres_changes", { event: "*", schema: "public", table }, kick);
    }
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") { setConn("live"); void refreshRef.current(); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setConn("offline");
    });
    return () => { if (timer) clearTimeout(timer); void supabase.removeChannel(ch); };
  }, [supabase]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === "error" ? 6000 : 2500);
    return () => clearTimeout(t);
  }, [toast]);
  const showToast = useCallback((tone: "success" | "error", text: string) => setToast({ tone, text }), []);

  const setMode = (m: Mode) => {
    setModeState(m);
    try { const u = new URL(window.location.href); u.searchParams.set("station", m); window.history.replaceState(null, "", u); } catch { /* ignore */ }
  };

  /** รันคำสั่งเปลี่ยนสถานะ: กันกดซ้ำทันที, อัปเดตหน้าจอก่อน (ถ้ามี), ล้มเหลว → โหลดสถานะจริงกลับมา */
  const exec: Exec = useCallback((key, call, okText) => {
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    setPending(new Set(inflight.current));
    void live.track(async () => {
      const r: ActionResult<unknown> = await call();
      if (!r.ok) throw new Error(r.error);
    })
      .then(() => { if (okText) showToast("success", okText); })
      .catch((e: unknown) => showToast("error", e instanceof Error && e.message ? e.message : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง"))
      .finally(() => { inflight.current.delete(key); setPending(new Set(inflight.current)); });
  }, [live, showToast]);

  const optimistic = useCallback((key: string, apply: (s: ProductionSnapshot) => ProductionSnapshot, call: () => Promise<ActionResult<unknown>>, okText?: string) => {
    if (inflight.current.has(key)) return;
    live.setData(apply);
    exec(key, call, okText);
  }, [live, exec]);

  const actions: CardActions = useMemo(() => ({
    pending,
    // ไปข้างหน้า (เริ่ม/พร้อม): ไม่ส่ง expectedVersion — idempotent และไม่ทำให้กดซ้ำเพราะ STALE_STATE
    onStation: (q, station, target: StationStatus) => {
      const backwards = (target === "preparing" && (station === "drink" ? q.drink_status : q.cake_status) === "ready") || target === "queued";
      optimistic(`${q.order_id}:${station}`, (s) => applyStationOptimistic(s, q.order_id, station, target),
        () => setStationStatus({ orderId: q.order_id, station, target, expectedVersion: backwards ? q.version : null }));
    },
    onHandover: (q) => {
      if (q.status !== "ready") { setForce(q); return; }
      optimistic(`${q.order_id}:handover`, (s) => applyHandoverOptimistic(s, q.order_id, "completed", new Date().toISOString()),
        () => completeHandover({ orderId: q.order_id }), `${formatQueueNo(q.queue_no)} ส่งมอบแล้ว`);
    },
    onReopen: (q) => setReopen(q),
  }), [pending, optimistic]);

  const active = useMemo(() => snap.queues.filter((q) => q.status === "queued" || q.status === "preparing" || q.status === "ready").sort(byFifo), [snap.queues]);
  const cakeQueue = useMemo(() => active.filter((q) => q.status !== "ready" && q.cake_status !== null && q.cake_status !== "ready"), [active]);
  const drinkQueue = useMemo(() => active.filter((q) => q.status !== "ready" && q.drink_status !== null && q.drink_status !== "ready"), [active]);
  const ready = useMemo(() => active.filter((q) => q.status === "ready"), [active]);
  const recent = useMemo(() => snap.queues.filter((q) => q.status === "completed").sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")).slice(0, 8), [snap.queues]);

  const baking = snap.batches.find((b) => b.status === "baking");
  const planNext = snap.plan.batches[0];
  const planAfter = snap.plan.batches[1];
  const cap = snap.settings.batch_capacity;
  const cakePieces = snap.cake_totals.reduce((s, r) => s + r.waiting + r.in_progress, 0);
  const drinkCups = snap.drink_totals.reduce((s, r) => s + r.waiting + r.in_progress, 0);

  const cakeSection = (
    <div className="space-y-3">
      <BatchPanel snap={snap} pending={pending} exec={exec} nowMs={now} />
      <h3 className="text-lg font-bold text-amber-900">คิวเค้ก <span className="tnum text-base font-normal text-stone-600">({cakeQueue.length})</span></h3>
      {cakeQueue.length === 0 ? <Empty>ไม่มีเค้กที่ต้องทำ</Empty> : cakeQueue.map((q) => <QueueCard key={q.order_id} q={q} filter="cake" nowMs={now} actions={actions} />)}
    </div>
  );
  const drinkSection = (
    <div className="space-y-3">
      <h3 className="text-lg font-bold text-emerald-900">คิวเครื่องดื่ม <span className="tnum text-base font-normal text-stone-600">({drinkQueue.length})</span></h3>
      {drinkQueue.length === 0 ? <Empty>ไม่มีเครื่องดื่มที่ต้องทำ</Empty> : drinkQueue.map((q) => <QueueCard key={q.order_id} q={q} filter="drink" nowMs={now} actions={actions} />)}
    </div>
  );
  const allSection = (
    <div className="space-y-3">
      <h3 className="text-lg font-bold">ทุกออเดอร์ที่ยังไม่ส่งมอบ <span className="tnum text-base font-normal text-stone-600">({active.length})</span></h3>
      {active.length === 0 ? <Empty>ไม่มีออเดอร์ค้าง</Empty> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{active.map((q) => <QueueCard key={q.order_id} q={q} filter="all" nowMs={now} actions={actions} />)}</div>
      )}
      {recent.length > 0 && (
        <>
          <h3 className="pt-2 text-base font-bold text-stone-600">ส่งมอบล่าสุด</h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{recent.map((q) => <QueueCard key={q.order_id} q={q} filter="all" nowMs={now} actions={actions} />)}</div>
        </>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3" data-testid="production">
      {/* แถบบน */}
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-extrabold">งานผลิต</h1>
        <div role="tablist" aria-label="เลือกจอ" className="flex gap-1 rounded-2xl bg-white/70 p-1">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)}
              className={cn("min-h-14 rounded-xl px-4 text-lg font-bold", mode === m.id ? "bg-matcha-700 text-white" : "text-stone-700 active:bg-stone-200")}>
              <span aria-hidden>{m.icon}</span> {m.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1.5 font-semibold", conn === "live" ? "bg-green-100 text-green-900" : conn === "offline" ? "bg-amber-100 text-amber-900" : "bg-stone-100 text-stone-700")} data-conn={conn}>
            <Icon name="wifi" size={16} />{conn === "live" ? "อัปเดตสด" : conn === "offline" ? "ตรวจทุก 5 วินาที" : "กำลังเชื่อมต่อ"}
          </span>
          {live.lastOkAt && <span className="tnum hidden text-stone-500 md:inline">อัปเดต {new Date(live.lastOkAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
          <Button size="lg" className="!px-4" onClick={() => void live.refresh()} aria-label="โหลดใหม่"><Icon name="refresh" size={22} /></Button>
          {canConfigure && config && <Button size="lg" className="!px-4" onClick={() => setSettingsOpen(true)} aria-label="ตั้งค่างานผลิต"><Icon name="gear" size={22} /></Button>}
        </div>
      </header>

      {(loadError || live.error) && <Notice tone="error">{live.error ?? loadError}</Notice>}
      {snap.missing_queues > 0 && (
        <Notice tone="warn">
          <div className="flex flex-wrap items-center gap-2">
            <span>มี {snap.missing_queues} ออเดอร์ที่ชำระแล้วแต่ยังไม่มีคิว (เช่น ชำระก่อนเปิดใช้ระบบคิว)</span>
            <Button size="md" disabled={pending.has("repair")} onClick={() => exec("repair", () => repairQueues(), "สร้างคิวที่ขาดแล้ว")}>สร้างคิวให้</Button>
          </div>
        </Notice>
      )}

      {/* สรุปใหญ่ อ่านได้จากระยะไกล */}
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-5" aria-label="สรุป">
        <Tile title="คิวที่ค้างอยู่" big={snap.counts.active_queues} tone="stone" testId="tile-active">
          <p className="tnum text-sm text-stone-600">รอ {snap.counts.queued} · กำลังทำ {snap.counts.preparing}</p>
        </Tile>
        <Tile title="🔔 พร้อมรับ" big={snap.counts.ready_for_pickup} tone="violet" testId="tile-ready">
          <p className="text-sm text-violet-900">{ready.length > 0 ? ready.map((q) => formatQueueNo(q.queue_no)).join(" ") : "—"}</p>
        </Tile>
        <Tile title={`${STATION_ICON.cake} เค้กที่ต้องทำ (ชิ้น)`} big={cakePieces} tone="amber" testId="tile-cake"><Totals rows={snap.cake_totals} tone="amber" /></Tile>
        <Tile title={`${STATION_ICON.drink} เครื่องดื่มที่ต้องทำ (แก้ว)`} big={drinkCups} tone="emerald" testId="tile-drink"><Totals rows={snap.drink_totals} tone="emerald" /></Tile>
        <Tile title="🔥 รอบอบ" tone="amber" testId="tile-batch">
          <p className="text-base">{baking ? <>กำลังอบ <span className="tnum text-2xl font-extrabold">{baking.load}/{baking.capacity}</span></> : "ไม่มีรอบที่กำลังอบ"}</p>
          <p className="text-base">รอบถัดไป <span className="tnum text-2xl font-extrabold">{planNext ? planNext.load_after : 0}/{cap}</span>
            {planAfter && <span className="tnum text-sm text-stone-600"> · ถัดไปอีก {planAfter.load_after}</span>}</p>
        </Tile>
      </section>

      {/* ช่องรอส่งมอบ */}
      {ready.length > 0 && mode !== "all" && (
        <section className="rounded-2xl border-2 border-violet-400 bg-violet-50 p-2" aria-label="พร้อมรับ" data-testid="pass">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-1 text-lg font-bold text-violet-900">🔔 พร้อมส่งมอบ</span>
            {ready.map((q) => (
              <Button key={q.order_id} variant="primary" size="lg" className="!bg-violet-700" disabled={pending.has(`${q.order_id}:handover`)} onClick={() => actions.onHandover(q)}>
                <span className="tnum">{formatQueueNo(q.queue_no)}</span> <span className="text-sm font-normal">ส่งมอบ ✓</span>
              </Button>
            ))}
          </div>
        </section>
      )}

      {/* เนื้อหา */}
      <main className={cn("min-h-0 flex-1", mode === "split" ? "overflow-y-auto lg:overflow-hidden" : "scroll-y")}>
        {mode === "split" && (
          <div className="grid gap-3 lg:h-full lg:grid-cols-2">
            <div className="scroll-y rounded-2xl border border-amber-200 bg-amber-50/40 p-2 lg:min-h-0" data-testid="col-cake">{cakeSection}</div>
            <div className="scroll-y rounded-2xl border border-emerald-200 bg-emerald-50/40 p-2 lg:min-h-0" data-testid="col-drink">{drinkSection}</div>
          </div>
        )}
        {mode === "cake" && <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-2">{cakeSection}</div>}
        {mode === "drink" && <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-2">{drinkSection}</div>}
        {mode === "all" && allSection}
      </main>

      <footer className="text-xs text-stone-500">เข้าสู่ระบบโดย {employeeName} · ตั้งค่าหน้าจอแต่ละเครื่องแยกกันได้ (เลือกแท็บแล้วเก็บไว้ที่ลิงก์ ?station=)</footer>

      <Modal open={!!force} onClose={() => setForce(null)} title={force ? `${formatQueueNo(force.queue_no)} ยังเตรียมไม่ครบ` : ""}
        footer={<div className="flex gap-2"><Button size="lg" className="flex-1" onClick={() => setForce(null)}>กลับ</Button>
          <Button variant="primary" size="lg" className="flex-1 !bg-violet-700" onClick={() => { const q = force!; setForce(null); exec(`${q.order_id}:handover`, () => completeHandover({ orderId: q.order_id, force: true }), `${formatQueueNo(q.queue_no)} ส่งมอบแล้ว`); }}>ส่งมอบเลย</Button></div>}>
        <p>ออเดอร์นี้ยังมีรายการที่ไม่พร้อม ต้องการส่งมอบให้ลูกค้าตอนนี้เลยหรือไม่?</p>
        {force && <p className="mt-2 text-sm text-stone-600">เค้ก: {force.cake_status ?? "—"} · เครื่องดื่ม: {force.drink_status ?? "—"}</p>}
      </Modal>
      <Modal open={!!reopen} onClose={() => setReopen(null)} title={reopen ? `ย้อนการส่งมอบ ${formatQueueNo(reopen.queue_no)}?` : ""}
        footer={<div className="flex gap-2"><Button size="lg" className="flex-1" onClick={() => setReopen(null)}>ไม่ย้อน</Button>
          <Button variant="primary" size="lg" className="flex-1" onClick={() => { const q = reopen!; setReopen(null); optimistic(`${q.order_id}:handover`, (s) => applyHandoverOptimistic(s, q.order_id, "ready", ""), () => reopenHandover({ orderId: q.order_id, expectedVersion: q.version }), "ย้อนการส่งมอบแล้ว"); }}>ย้อนกลับ</Button></div>}>
        <p>ออเดอร์จะกลับไปเป็น “พร้อมรับ” และลูกค้าจะเห็นสถานะอัปเดต</p>
      </Modal>

      {settingsOpen && config && (
        <ProductionSettings open onClose={() => setSettingsOpen(false)} settings={snap.settings} config={config}
          onSaved={() => { router.refresh(); void live.refresh(); }} onToast={showToast} />
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-3">
          <div className={cn("pointer-events-auto max-w-lg rounded-xl px-4 py-2.5 text-base font-medium text-white shadow-lg", toast.tone === "error" ? "bg-refund" : "bg-matcha-800")} role="status">{toast.text}</div>
        </div>
      )}
    </div>
  );
}
