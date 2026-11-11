/**
 * ตรรกะบริสุทธิ์ของงานผลิต: สถานี, สถานะ, ป้ายคิว, ตัวเตือนความจุรอบอบ
 * (ฐานข้อมูลเป็นแหล่งความจริง — ไฟล์นี้ใช้แสดงผล/เตือนล่วงหน้า และมี unit test)
 */
export type Station = "cake" | "drink";
export type StationStatus = "queued" | "preparing" | "ready";
export type QueueStatus = "queued" | "preparing" | "ready" | "completed" | "cancelled";
export type BatchStatus = "planning" | "baking" | "completed" | "cancelled";

export const STATION_LABEL: Record<Station, string> = { cake: "เค้ก", drink: "เครื่องดื่ม" };
export const STATION_ICON: Record<Station, string> = { cake: "🍰", drink: "🍵" };

export const STATION_STATUS_LABEL: Record<StationStatus, string> = { queued: "รอทำ", preparing: "กำลังทำ", ready: "พร้อมแล้ว" };
export const QUEUE_STATUS_LABEL: Record<QueueStatus, string> = {
  queued: "รอคิว", preparing: "กำลังทำ", ready: "พร้อมรับ", completed: "รับแล้ว", cancelled: "ยกเลิก",
};
export const CUSTOMER_STATUS_LABEL: Record<QueueStatus, string> = {
  queued: "อยู่ในคิว", preparing: "กำลังเตรียมออเดอร์", ready: "ออเดอร์พร้อมแล้ว — รับได้เลย", completed: "รับสินค้าแล้ว ขอบคุณค่ะ", cancelled: "ออเดอร์ถูกยกเลิก",
};
export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = { planning: "วางแผน", baking: "กำลังอบ", completed: "อบเสร็จ", cancelled: "ยกเลิก" };

export const formatQueueNo = (n: number) => `Q${String(n).padStart(3, "0")}`;

export function elapsedMinutes(fromIso: string, nowMs: number): number {
  const t = Date.parse(fromIso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 60_000)) : 0;
}
export function formatElapsed(min: number): string {
  if (min < 1) return "เมื่อครู่";
  if (min < 60) return `${min} นาที`;
  return `${Math.floor(min / 60)} ชม. ${min % 60} นาที`;
}

// ---------- รวมสถานะ (สะท้อนตรรกะใน SQL: _station_status / _recompute_queue) ----------
export function stationStatusOf(statuses: ReadonlyArray<"queued" | "preparing" | "ready" | "cancelled">): StationStatus | null {
  const live = statuses.filter((s) => s !== "cancelled");
  if (live.length === 0) return null;
  if (live.every((s) => s === "ready")) return "ready";
  if (live.some((s) => s === "preparing" || s === "ready")) return "preparing";
  return "queued";
}

/** สถานะรวมของคิวจากสถานะของแต่ละสถานีที่ต้องทำ (null = ไม่มีงานที่สถานีนั้น) */
export function overallStatusOf(cake: StationStatus | null, drink: StationStatus | null): "queued" | "preparing" | "ready" | null {
  if (cake === null && drink === null) return null;
  if ((cake ?? "ready") === "ready" && (drink ?? "ready") === "ready") return "ready";
  if (cake === "preparing" || cake === "ready" || drink === "preparing" || drink === "ready") return "preparing";
  return "queued";
}

export function isActiveQueue(s: QueueStatus): boolean {
  return s === "queued" || s === "preparing" || s === "ready";
}

// ---------- สินค้า → สถานี (สะท้อน resolve_station ใน SQL) ----------
export interface StationRoutes {
  products: Record<string, Station>;     // product_id → station (override)
  categories: Record<string, Station>;   // category_id → station
  defaultStation: Station;
}
export function resolveStation(productId: string, categoryId: string | null, routes: StationRoutes): Station {
  return routes.products[productId] ?? (categoryId ? routes.categories[categoryId] : undefined) ?? routes.defaultStation;
}

// ---------- ตัวเตือนความจุรอบอบ (แสดงที่หน้า POS) ----------
export interface CakeLoad {
  capacity: number;
  queuedPieces: number;           // เค้กที่ชำระแล้ว ยังไม่เข้ารอบที่กำลังอบ (รวมที่อยู่ในแผน)
  bakingPieces: number;
  bakingStartedAt: string | null;
  bakeMinutes: number | null;     // null = ร้านไม่ได้ตั้งเวลาอบ → ไม่ประมาณเวลารอ
  activeQueues: number;
  byProduct: { name: string; waiting: number; in_progress: number }[];
}

/** แปลงผลของ get_cake_load (RPC) เป็น CakeLoad; null ถ้าไม่มีข้อมูล */
export function parseCakeLoad(raw: unknown): CakeLoad | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  if (typeof r.capacity !== "number") return null;
  return {
    capacity: num(r.capacity, 22), queuedPieces: num(r.queued_pieces), bakingPieces: num(r.baking_pieces),
    bakingStartedAt: typeof r.baking_started_at === "string" ? r.baking_started_at : null,
    bakeMinutes: typeof r.bake_minutes === "number" ? r.bake_minutes : null,
    activeQueues: num(r.active_queues),
    byProduct: Array.isArray(r.by_product) ? (r.by_product as CakeLoad["byProduct"]) : [],
  };
}
export interface CakeForecast {
  capacity: number;
  currentLoad: number;            // โหลดรอบที่กำลังจัด (ก่อนเพิ่มตะกร้า)
  remaining: number;              // ที่ว่างในรอบนี้
  cartPieces: number;
  afterLoad: number;              // โหลดรอบนี้หลังเพิ่มตะกร้า
  exceeds: boolean;               // ตะกร้าทำให้เกินรอบปัจจุบัน
  spillToNext: number;            // ชิ้นของตะกร้านี้ที่ไปรอบถัดไป
  nextBatchLoad: number;          // โหลดที่เสนอสำหรับรอบถัดไป (รวมของเดิมที่ล้น)
  batchesNeeded: number;          // จำนวนรอบทั้งหมดที่ต้องอบ (ไม่รวมที่กำลังอบ)
  waitMinutes: number | null;     // เวลารอจนเค้กของตะกร้านี้เสร็จ — เฉพาะเมื่อมีเวลาอบที่ตั้งไว้
}

/** ตัวเลขนี้เป็นตัวช่วยวางแผนการผลิต ไม่ใช่สต็อก และ "ไม่ใช้บล็อกการขาย" */
export function cakeForecast(load: CakeLoad, cartPieces: number, nowMs: number): CakeForecast {
  const cap = Math.max(1, load.capacity);
  const q = Math.max(0, load.queuedPieces);
  const c = Math.max(0, cartPieces);
  const total = q + c;
  const exceeds = c > 0 && total > cap;
  const batchesNeeded = total === 0 ? 0 : Math.ceil(total / cap);
  let waitMinutes: number | null = null;
  if (c > 0 && load.bakeMinutes !== null) {
    // สะท้อน get_public_queue: เวลาที่เหลือของรอบที่กำลังอบ + จำนวนรอบที่ต้องอบ × เวลาอบ
    const baking = load.bakingPieces > 0 && load.bakingStartedAt
      ? Math.max(0, load.bakeMinutes - (nowMs - Date.parse(load.bakingStartedAt)) / 60_000)
      : 0;
    waitMinutes = Math.ceil(baking + Math.max(1, batchesNeeded) * load.bakeMinutes);
  }
  return {
    capacity: cap,
    currentLoad: Math.min(q, cap),
    remaining: Math.max(0, cap - q),
    cartPieces: c,
    afterLoad: Math.min(total, cap),
    exceeds,
    spillToNext: exceeds ? Math.min(c, total - cap) : 0,
    nextBatchLoad: Math.max(0, total - cap),
    batchesNeeded,
    waitMinutes,
  };
}

// ---------- ชนิดข้อมูล snapshot (ตรงกับ get_production_snapshot) ----------
export interface SnapshotItem {
  id: string; station: Station; name: string; quantity: number; ready_quantity: number;
  status: "queued" | "preparing" | "ready"; addons: string[];
  batches: { batch_no: number; status: BatchStatus; quantity: number }[];
}
export interface SnapshotQueue {
  queue_id: string; order_id: string; order_no: number; queue_no: number; business_date: string;
  status: QueueStatus; version: number; created_at: string; ready_at: string | null; completed_at: string | null;
  cake_status: StationStatus | null; drink_status: StationStatus | null; items: SnapshotItem[];
}
export interface ProductTotal { product_id: string | null; name: string; waiting: number; in_progress: number }
export interface SnapshotBatchItem { id: string; prep_id: string; order_id: string; queue_no: number; product_name: string; quantity: number }
export interface SnapshotBatch {
  id: string; batch_no: number; status: BatchStatus; capacity: number; started_at: string | null; load: number; items: SnapshotBatchItem[];
}
export interface PlanItem { prep_id: string; order_id: string; queue_no: number; product_id: string | null; product_name: string; quantity: number }
export interface PlanBatch {
  batch_id: string | null; batch_no: number; is_new: boolean; capacity: number;
  current_load: number; add_load: number; load_after: number; items: PlanItem[];
}
export interface ProductionSnapshot {
  server_time: string; business_date: string;
  settings: { batch_capacity: number; mix_flavors: boolean; bake_minutes: number | null; default_station: Station; queue_link_hours: number };
  queues: SnapshotQueue[]; cake_totals: ProductTotal[]; drink_totals: ProductTotal[]; batches: SnapshotBatch[];
  plan: { batches: PlanBatch[]; signature: string };
  counts: { active_queues: number; ready_for_pickup: number; preparing: number; queued: number };
  missing_queues: number;
}

export const EMPTY_SNAPSHOT: ProductionSnapshot = {
  server_time: "", business_date: "",
  settings: { batch_capacity: 22, mix_flavors: true, bake_minutes: null, default_station: "drink", queue_link_hours: 24 },
  queues: [], cake_totals: [], drink_totals: [], batches: [],
  plan: { batches: [], signature: "" },
  counts: { active_queues: 0, ready_for_pickup: 0, preparing: 0, queued: 0 }, missing_queues: 0,
};

/** DTO ของหน้าลูกค้า (ตรงกับ get_public_queue — ไม่มี id ภายในหรือข้อมูลการเงิน) */
export interface PublicQueue {
  queue_no: number; status: QueueStatus; ahead: number;
  cake_status: StationStatus | null; drink_status: StationStatus | null;
  items: { name: string; quantity: number; station: Station; addons: string[] }[];
  estimated_wait_minutes: number | null; shop_name: string | null; created_at: string; updated_at: string;
}

export const TOKEN_RE = /^[0-9a-f]{64}$/;
export const queueUrl = (origin: string, token: string) => `${origin.replace(/\/+$/, "")}/q/${token}`;

// ---------- optimistic update ของ snapshot (ใช้ทันทีที่กด แล้วค่อยยืนยันด้วยข้อมูลจากเซิร์ฟเวอร์) ----------
function recount(s: ProductionSnapshot): ProductionSnapshot {
  const active = s.queues.filter((q) => isActiveQueue(q.status));
  const drinkMap = new Map<string, ProductTotal>();
  for (const q of active) {
    if (q.status === "ready") continue;
    for (const i of q.items) {
      if (i.station !== "drink" || i.status === "ready") continue;
      const cur = drinkMap.get(i.name) ?? { product_id: null, name: i.name, waiting: 0, in_progress: 0 };
      if (i.status === "queued") cur.waiting += i.quantity; else cur.in_progress += i.quantity;
      drinkMap.set(i.name, cur);
    }
  }
  return {
    ...s,
    drink_totals: [...drinkMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    counts: {
      active_queues: active.length,
      ready_for_pickup: active.filter((q) => q.status === "ready").length,
      preparing: active.filter((q) => q.status === "preparing").length,
      queued: active.filter((q) => q.status === "queued").length,
    },
  };
}

export function applyStationOptimistic(s: ProductionSnapshot, orderId: string, station: Station, target: StationStatus): ProductionSnapshot {
  const queues = s.queues.map((q) => {
    if (q.order_id !== orderId || !isActiveQueue(q.status)) return q;
    const items = q.items.map((i) => (i.station === station ? { ...i, status: target, ready_quantity: target === "ready" ? i.quantity : 0 } : i));
    const cake = stationStatusOf(items.filter((i) => i.station === "cake").map((i) => i.status));
    const drink = stationStatusOf(items.filter((i) => i.station === "drink").map((i) => i.status));
    return { ...q, items, cake_status: cake, drink_status: drink, status: overallStatusOf(cake, drink) ?? q.status };
  });
  return recount({ ...s, queues });
}

export function applyHandoverOptimistic(s: ProductionSnapshot, orderId: string, to: "completed" | "ready", nowIso: string): ProductionSnapshot {
  const queues = s.queues.map((q) => {
    if (q.order_id !== orderId) return q;
    if (to === "completed") {
      const items = q.items.map((i) => ({ ...i, status: "ready" as const, ready_quantity: i.quantity }));
      return { ...q, items, status: "completed" as const, completed_at: nowIso, cake_status: q.cake_status ? "ready" as const : null, drink_status: q.drink_status ? "ready" as const : null };
    }
    return { ...q, status: "ready" as const, completed_at: null };
  });
  return recount({ ...s, queues });
}
