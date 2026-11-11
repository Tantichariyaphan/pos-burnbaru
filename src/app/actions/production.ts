"use server";
import { z } from "zod";
import { authorize, db, fail, failText, type ActionResult } from "@/lib/actions";

const uuid = z.string().uuid();
const station = z.enum(["cake", "drink"]);
const version = z.number().int().min(0).max(1_000_000).nullable().optional();

export interface QueueResult { queue_id: string; order_id: string; status: string; version: number; changed: boolean }

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const supabase = await db();
  const { data, error } = await supabase.rpc(name, args);
  if (error) return fail(error.message);
  return { ok: true, data: data as T };
}

/** เปลี่ยนสถานะงานของสถานีหนึ่ง (เริ่มทำ / พร้อมแล้ว / ย้อนกลับ) — idempotent + ป้องกันการเขียนทับ (expectedVersion) */
export async function setStationStatus(input: {
  orderId: string; station: "cake" | "drink"; target: "queued" | "preparing" | "ready"; expectedVersion?: number | null;
}): Promise<ActionResult<QueueResult>> {
  const a = await authorize("production");
  if ("error" in a) return failText(a.error);
  const p = z.object({ orderId: uuid, station, target: z.enum(["queued", "preparing", "ready"]), expectedVersion: version }).safeParse(input);
  if (!p.success) return failText("ข้อมูลไม่ถูกต้อง");
  return rpc<QueueResult>("set_station_status", {
    p_order_id: p.data.orderId, p_station: p.data.station, p_target: p.data.target, p_expected_version: p.data.expectedVersion ?? null,
  });
}

/** ส่งมอบให้ลูกค้า (ยืนยันชัดเจน) — force = ส่งมอบแม้งานยังไม่ครบ */
export async function completeHandover(input: { orderId: string; expectedVersion?: number | null; force?: boolean }): Promise<ActionResult<QueueResult>> {
  const a = await authorize("production");
  if ("error" in a) return failText(a.error);
  const p = z.object({ orderId: uuid, expectedVersion: version, force: z.boolean().optional() }).safeParse(input);
  if (!p.success) return failText("ข้อมูลไม่ถูกต้อง");
  return rpc<QueueResult>("complete_handover", {
    p_order_id: p.data.orderId, p_expected_version: p.data.expectedVersion ?? null, p_force: p.data.force ?? false,
  });
}

export async function reopenHandover(input: { orderId: string; expectedVersion?: number | null }): Promise<ActionResult<QueueResult>> {
  const a = await authorize("production");
  if ("error" in a) return failText(a.error);
  const p = z.object({ orderId: uuid, expectedVersion: version }).safeParse(input);
  if (!p.success) return failText("ข้อมูลไม่ถูกต้อง");
  return rpc<QueueResult>("reopen_handover", { p_order_id: p.data.orderId, p_expected_version: p.data.expectedVersion ?? null });
}

/** ออเดอร์ที่ชำระแล้วแต่ยังไม่มีคิว (เช่น ชำระก่อนเปิดใช้ระบบคิว/สร้างคิวพลาด) — สร้างให้ (idempotent) */
export async function ensureQueue(orderId: string): Promise<ActionResult<{ queue_no: number; public_token: string } | null>> {
  const a = await authorize("production");
  if ("error" in a) return failText(a.error);
  if (!uuid.safeParse(orderId).success) return failText("ข้อมูลไม่ถูกต้อง");
  return rpc("ensure_order_queue", { p_order_id: orderId });
}

export async function repairQueues(): Promise<ActionResult<number>> {
  const a = await authorize("production");
  if ("error" in a) return failText(a.error);
  return rpc<number>("repair_missing_queues", {});
}

export async function confirmCakePlan(signature: string): Promise<ActionResult<{ applied: number }>> {
  const a = await authorize("production");
  if ("error" in a) return failText(a.error);
  const p = z.string().regex(/^[0-9a-f]{32}$/).safeParse(signature);
  if (!p.success) return failText("แผนไม่ถูกต้อง กรุณาโหลดใหม่");
  return rpc("confirm_cake_plan", { p_signature: p.data });
}

export async function startBatch(batchId: string): Promise<ActionResult<{ status: string; changed: boolean }>> {
  const a = await authorize("production");
  if ("error" in a) return failText(a.error);
  if (!uuid.safeParse(batchId).success) return failText("ข้อมูลไม่ถูกต้อง");
  return rpc("start_batch", { p_batch_id: batchId });
}
export async function completeBatch(batchId: string): Promise<ActionResult<{ status: string; changed: boolean }>> {
  const a = await authorize("production");
  if ("error" in a) return failText(a.error);
  if (!uuid.safeParse(batchId).success) return failText("ข้อมูลไม่ถูกต้อง");
  return rpc("complete_batch", { p_batch_id: batchId });
}
export async function cancelBatch(batchId: string): Promise<ActionResult<{ status: string; changed: boolean }>> {
  const a = await authorize("production");
  if ("error" in a) return failText(a.error);
  if (!uuid.safeParse(batchId).success) return failText("ข้อมูลไม่ถูกต้อง");
  return rpc("cancel_batch", { p_batch_id: batchId });
}

/** ปรับแผนด้วยมือ (เฉพาะรอบที่ยังไม่เริ่มอบ): ย้ายไปรอบอื่น หรือถอดออกจากแผน (targetBatchId = null) */
export async function moveAllocation(input: { batchItemId: string; targetBatchId: string | null; quantity: number }): Promise<ActionResult> {
  const a = await authorize("production");
  if ("error" in a) return failText(a.error);
  const p = z.object({ batchItemId: uuid, targetBatchId: uuid.nullable(), quantity: z.number().int().min(1).max(500) }).safeParse(input);
  if (!p.success) return failText("ข้อมูลไม่ถูกต้อง");
  return rpc("move_batch_allocation", { p_batch_item_id: p.data.batchItemId, p_target_batch_id: p.data.targetBatchId, p_qty: p.data.quantity });
}

// ---------- ตั้งค่า (ผู้จัดการ/เจ้าของ) ----------
export async function saveProductionSettings(input: {
  batchCapacity: number; mixFlavors: boolean; bakeMinutes: number | null; defaultStation: "cake" | "drink"; queueLinkHours: number;
}): Promise<ActionResult> {
  const a = await authorize("production.settings");
  if ("error" in a) return failText(a.error);
  const p = z.object({
    batchCapacity: z.number().int().min(1).max(200), mixFlavors: z.boolean(),
    bakeMinutes: z.number().int().min(1).max(600).nullable(), defaultStation: station,
    queueLinkHours: z.number().int().min(1).max(168),
  }).safeParse(input);
  if (!p.success) return failText("ค่าตั้งค่าไม่ถูกต้อง (ความจุ 1–200, เวลาอบ 1–600 นาที, ลิงก์คิว 1–168 ชม.)");
  const supabase = await db();
  const { error } = await supabase.from("production_settings").update({
    batch_capacity: p.data.batchCapacity, mix_flavors: p.data.mixFlavors, bake_minutes: p.data.bakeMinutes,
    default_station: p.data.defaultStation, queue_link_hours: p.data.queueLinkHours,
  }).eq("id", true);
  if (error) return fail(error.message);
  return { ok: true };
}

/** กำหนดสถานีของหมวด/สินค้า (station = null → ลบการกำหนด ใช้ค่าเริ่มต้น/หมวด) */
export async function saveStationRoute(input: { kind: "category" | "product"; id: string; station: "cake" | "drink" | null }): Promise<ActionResult> {
  const a = await authorize("production.settings");
  if ("error" in a) return failText(a.error);
  const p = z.object({ kind: z.enum(["category", "product"]), id: uuid, station: station.nullable() }).safeParse(input);
  if (!p.success) return failText("ข้อมูลไม่ถูกต้อง");
  const supabase = await db();
  const table = p.data.kind === "category" ? "category_stations" : "product_stations";
  const col = p.data.kind === "category" ? "category_id" : "product_id";
  if (p.data.station === null) {
    const { error } = await supabase.from(table).delete().eq(col, p.data.id);
    if (error) return fail(error.message);
  } else {
    const { error } = await supabase.from(table).upsert({ [col]: p.data.id, station: p.data.station }, { onConflict: col });
    if (error) return fail(error.message);
  }
  return { ok: true };
}
