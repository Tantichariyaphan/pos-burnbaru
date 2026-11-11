"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { CUSTOMER_STATUS_LABEL, STATION_ICON, STATION_LABEL, STATION_STATUS_LABEL, formatQueueNo, type PublicQueue, type QueueStatus, type Station, type StationStatus } from "@/lib/production";

type Conn = "live" | "offline" | "expired";

const BANNER: Record<QueueStatus, string> = {
  queued: "bg-stone-100 text-stone-900 border-stone-300",
  preparing: "bg-amber-50 text-amber-950 border-amber-300",
  ready: "bg-violet-100 text-violet-950 border-violet-400",
  completed: "bg-stone-100 text-stone-700 border-stone-300",
  cancelled: "bg-rose-50 text-rose-900 border-rose-300",
};
const STATION_TONE: Record<Station, string> = { cake: "bg-amber-50 border-amber-200", drink: "bg-emerald-50 border-emerald-200" };

function StationProgress({ station, status }: { station: Station; status: StationStatus | null }) {
  if (!status) return null;
  const steps: StationStatus[] = ["queued", "preparing", "ready"];
  const at = steps.indexOf(status);
  return (
    <div className={`rounded-2xl border p-3 ${STATION_TONE[station]}`} data-testid={`progress-${station}`}>
      <div className="flex items-center justify-between">
        <div className="font-semibold"><span aria-hidden>{STATION_ICON[station]}</span> {STATION_LABEL[station]}</div>
        <div className="font-semibold">{STATION_STATUS_LABEL[status]}{status === "ready" ? " ✓" : ""}</div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden>
        {steps.map((_, i) => <div key={i} className={`h-2 rounded-full ${i <= at ? (status === "ready" ? "bg-violet-500" : station === "cake" ? "bg-amber-500" : "bg-emerald-600") : "bg-stone-200"}`} />)}
      </div>
    </div>
  );
}

export function QueueTracker({ token, initial, initialState }: { token: string; initial: PublicQueue | null; initialState: Conn }) {
  const [q, setQ] = useState<PublicQueue | null>(initial);
  const [conn, setConn] = useState<Conn>(initialState);
  const [updatedAt, setUpdatedAt] = useState<number | null>(initial ? Date.now() : null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delay = useRef(5000);
  const stopped = useRef(false);
  const inflight = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      const res = await fetch(`/api/queue/${token}`, { cache: "no-store", referrerPolicy: "no-referrer" });
      if (res.status === 404) { setConn("expired"); stopped.current = true; return; }
      if (!res.ok) throw new Error("unavailable");
      const data = (await res.json()) as PublicQueue;
      setQ(data); setUpdatedAt(Date.now()); setConn("live"); delay.current = 5000;
      if (data.status === "completed" || data.status === "cancelled") stopped.current = true;   // จบแล้ว หยุดโหลด
    } catch {
      setConn("offline");
      delay.current = Math.min(delay.current * 2, 30_000);   // ถอยหลังเมื่อเน็ตมีปัญหา
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    stopped.current = initial?.status === "completed" || initial?.status === "cancelled" || initialState === "expired";
    const schedule = () => {
      if (stopped.current) return;
      timer.current = setTimeout(async () => {
        if (document.visibilityState === "visible") await load();
        schedule();
      }, delay.current);
    };
    const onVisible = () => { if (document.visibilityState === "visible" && !stopped.current) void load(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    schedule();
    return () => {   // ออกจากหน้า = หยุดทุกอย่าง
      stopped.current = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [load, initial?.status, initialState]);

  if (!q) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-md place-items-center p-6 text-center">
        <div>
          <div className="text-5xl">{conn === "expired" ? "🔗" : "📡"}</div>
          <h1 className="mt-3 text-xl font-semibold">{conn === "expired" ? "ไม่พบคิวนี้ หรือลิงก์หมดอายุแล้ว" : "โหลดข้อมูลไม่ได้ชั่วคราว"}</h1>
          <p className="mt-2 text-stone-600">{conn === "expired" ? "กรุณาสอบถามพนักงานหน้าร้าน" : "กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"}</p>
          {conn !== "expired" && (
            <button onClick={() => { stopped.current = false; void load(); }} className="mt-4 min-h-12 rounded-xl bg-matcha-700 px-6 font-medium text-white">ลองใหม่</button>
          )}
        </div>
      </main>
    );
  }

  const cakeItems = q.items.filter((i) => i.station === "cake");
  const drinkItems = q.items.filter((i) => i.station === "drink");
  const waiting = q.status === "queued" || q.status === "preparing";

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-3 p-4">
      <header className="text-center">
        <div className="text-sm font-semibold text-matcha-700">{q.shop_name === "Grandfa Farm Cafe & Resort" ? "BurnBaru" : q.shop_name ?? "BurnBaru"}</div>
        <div className="text-xs text-stone-500">ติดตามออเดอร์ของคุณ</div>
      </header>

      <section className="glass rounded-3xl p-5 text-center">
        <div className="text-sm text-stone-600">คิวของคุณ</div>
        <div className="tnum text-7xl font-extrabold tracking-wide text-matcha-800" data-testid="my-queue">{formatQueueNo(q.queue_no)}</div>
        <div className={`mt-3 rounded-2xl border px-3 py-3 text-lg font-semibold ${BANNER[q.status]}`} role="status" data-testid="overall">
          {q.status === "ready" && <span aria-hidden>🔔 </span>}{CUSTOMER_STATUS_LABEL[q.status]}
        </div>
        {waiting && (
          <p className="mt-3 text-stone-700" data-testid="ahead">
            {q.ahead > 0 ? <>มี <b className="tnum text-xl">{q.ahead}</b> คิวก่อนหน้าคุณ</> : <b>ถึงคิวของคุณแล้ว กำลังเตรียมออเดอร์</b>}
          </p>
        )}
        {waiting && (
          <p className="mt-1 text-sm text-stone-600" data-testid="eta">
            {q.estimated_wait_minutes !== null ? <>ประมาณ <b className="tnum">{q.estimated_wait_minutes}</b> นาที (โดยประมาณ อาจเปลี่ยนได้)</> : "ยังประเมินเวลาไม่ได้ — ระบบจะอัปเดตสถานะให้อัตโนมัติ"}
          </p>
        )}
      </section>

      {q.status !== "cancelled" && (
        <section className="space-y-2" aria-label="ความคืบหน้า">
          <StationProgress station="cake" status={q.cake_status} />
          <StationProgress station="drink" status={q.drink_status} />
        </section>
      )}

      <section className="glass rounded-3xl p-4" aria-label="รายการของคุณ">
        <h2 className="mb-2 text-sm font-semibold text-stone-600">รายการของคุณ</h2>
        <ul className="space-y-1.5">
          {[...cakeItems, ...drinkItems].map((i, idx) => (
            <li key={idx} className="flex gap-2">
              <span className="tnum font-semibold">{i.quantity}×</span>
              <span>{STATION_ICON[i.station]} {i.name}{i.addons.length > 0 && <span className="text-xs text-stone-500"> (+{i.addons.join(", ")})</span>}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-3xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950" aria-label="วิธีรับสินค้า">
        <h2 className="font-semibold">วิธีรับสินค้า</h2>
        <p className="mt-1">เมื่อสถานะขึ้นว่า <b>“ออเดอร์พร้อมแล้ว”</b> ให้แจ้งเลขคิว <b className="tnum">{formatQueueNo(q.queue_no)}</b> ที่เคาน์เตอร์ พนักงานจะส่งมอบให้ค่ะ</p>
      </section>

      <footer className="flex items-center justify-between pb-6 text-xs text-stone-500">
        <span className="flex items-center gap-1" role="status">
          <span className={`inline-block size-2 rounded-full ${conn === "live" ? "bg-green-600" : "bg-amber-500"}`} />
          {stopped.current && (q.status === "completed" || q.status === "cancelled") ? "จบการติดตามแล้ว" : conn === "live" ? "อัปเดตอัตโนมัติ" : "เชื่อมต่อไม่ได้ กำลังลองใหม่…"}
          {updatedAt && <span className="tnum"> · {new Date(updatedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Bangkok" })}</span>}
        </span>
        {q.status !== "completed" && q.status !== "cancelled" && (
          <button onClick={() => void load()} disabled={busy} className="flex min-h-11 items-center gap-1 rounded-xl px-3 text-matcha-700 active:bg-matcha-50 disabled:opacity-50">
            <Icon name="refresh" size={18} /> รีเฟรช
          </button>
        )}
      </footer>
    </main>
  );
}
