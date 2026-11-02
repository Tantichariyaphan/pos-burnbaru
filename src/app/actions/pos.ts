"use server";
import { z } from "zod";
import { authorize, db, fail, failText, type ActionResult } from "@/lib/actions";
import type { ShiftSummary } from "@/lib/shift";

const uuid = z.string().uuid();
const satang = z.number().int().min(0).max(1_000_000_000);

export async function openShift(input: { registerId: string; openingCashSatang: number }): Promise<ActionResult<{ shiftId: string }>> {
  const a = await authorize("pos");
  if ("error" in a) return failText(a.error);
  const p = z.object({ registerId: uuid, openingCashSatang: satang }).safeParse(input);
  if (!p.success) return failText("จำนวนเงินทอนตั้งต้นไม่ถูกต้อง");
  const supabase = await db();
  const { data, error } = await supabase.rpc("open_shift", {
    p_register_id: p.data.registerId, p_opening_cash_satang: p.data.openingCashSatang,
  });
  if (error) return fail(error.message);
  return { ok: true, data: { shiftId: data as string } };
}

export async function getShiftSummary(shiftId: string): Promise<ActionResult<ShiftSummary>> {
  const a = await authorize("pos");
  if ("error" in a) return failText(a.error);
  if (!uuid.safeParse(shiftId).success) return failText("ข้อมูลไม่ถูกต้อง");
  const supabase = await db();
  const { data, error } = await supabase.rpc("get_shift_summary", { p_shift_id: shiftId });
  if (error) return fail(error.message);
  return { ok: true, data: data as ShiftSummary };
}

export async function closeShift(input: { shiftId: string; countedCashSatang: number; note?: string }): Promise<ActionResult<ShiftSummary>> {
  const a = await authorize("pos");
  if ("error" in a) return failText(a.error);
  const p = z.object({ shiftId: uuid, countedCashSatang: satang, note: z.string().trim().max(500).optional() }).safeParse(input);
  if (!p.success) return failText("กรุณากรอกเงินสดที่นับได้ให้ถูกต้อง");
  const supabase = await db();
  const { data, error } = await supabase.rpc("close_shift", {
    p_shift_id: p.data.shiftId, p_counted_cash_satang: p.data.countedCashSatang, p_note: p.data.note ?? null,
  });
  if (error) return fail(error.message);
  return { ok: true, data: data as ShiftSummary };
}

const checkoutSchema = z.object({
  idempotencyKey: uuid,
  shiftId: uuid,
  items: z.array(z.object({
    product_id: uuid, quantity: z.number().int().min(1).max(99), addon_ids: z.array(uuid).max(20),
  })).min(1).max(100),
  discountId: uuid.nullable(),
  method: z.enum(["cash", "transfer"]),
  receivedSatang: z.number().int().positive().max(1_000_000_000),
  reference: z.string().trim().max(100).nullable().optional(),
  customerId: uuid.nullable().optional(),
});

/** ชำระเงิน: ราคา/ส่วนลด/ยอดรวมคำนวณใหม่ที่ฐานข้อมูล; ส่ง key เดิมซ้ำจะได้ออเดอร์เดิม ไม่ตัดเงินซ้ำ */
export async function checkout(input: z.infer<typeof checkoutSchema>): Promise<ActionResult<{ orderId: string }>> {
  const a = await authorize("pos");
  if ("error" in a) return failText(a.error);
  const p = checkoutSchema.safeParse(input);
  if (!p.success) return failText("ข้อมูลออเดอร์ไม่ถูกต้อง");
  const v = p.data;
  const supabase = await db();
  const { data, error } = await supabase.rpc("checkout_order", {
    p_idempotency_key: v.idempotencyKey, p_shift_id: v.shiftId, p_items: v.items, p_discount_id: v.discountId,
    p_method: v.method, p_received_satang: v.receivedSatang, p_reference: v.reference ?? null,
    p_customer_id: v.customerId ?? null, p_note: null,
  });
  if (error) return fail(error.message);
  return { ok: true, data: { orderId: data as string } };
}

export async function setPrepStatus(input: { orderId: string; status: "preparing" | "done" }): Promise<ActionResult> {
  const a = await authorize("pos");
  if ("error" in a) return failText(a.error);
  const p = z.object({ orderId: uuid, status: z.enum(["preparing", "done"]) }).safeParse(input);
  if (!p.success) return failText("ข้อมูลไม่ถูกต้อง");
  const supabase = await db();
  const { error } = await supabase.rpc("set_order_prep_status", { p_order_id: p.data.orderId, p_status: p.data.status, p_note: null });
  if (error) return fail(error.message);
  return { ok: true };
}
