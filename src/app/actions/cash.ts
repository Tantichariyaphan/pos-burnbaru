"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, db, fail, failText, type ActionResult } from "@/lib/actions";

const uuid = z.string().uuid();

export async function recordMovement(input: {
  idempotencyKey: string; direction: "in" | "out"; channel: "cash" | "transfer";
  amountSatang: number; category: string; note?: string; shiftId?: string | null;
}): Promise<ActionResult> {
  const a = await authorize("cash");
  if ("error" in a) return failText(a.error);
  const p = z.object({
    idempotencyKey: uuid, direction: z.enum(["in", "out"]), channel: z.enum(["cash", "transfer"]),
    amountSatang: z.number().int().positive().max(1_000_000_000),
    category: z.string().trim().min(1).max(100), note: z.string().trim().max(500).optional(),
    shiftId: uuid.nullable().optional(),
  }).safeParse(input);
  if (!p.success) return failText("กรุณากรอกจำนวนเงินและเหตุผลให้ถูกต้อง");
  const v = p.data;
  const supabase = await db();
  const { error } = await supabase.rpc("record_cash_movement", {
    p_idempotency_key: v.idempotencyKey, p_direction: v.direction, p_channel: v.channel,
    p_amount_satang: v.amountSatang, p_category: v.category, p_note: v.note ?? null, p_shift_id: v.shiftId ?? null,
  });
  if (error) return fail(error.message);
  revalidatePath("/cash");
  return { ok: true };
}

export async function reverseMovement(input: { idempotencyKey: string; movementId: string; reason: string }): Promise<ActionResult> {
  const a = await authorize("cash.reverse");
  if ("error" in a) return failText(a.error);
  const p = z.object({ idempotencyKey: uuid, movementId: uuid, reason: z.string().trim().min(1).max(500) }).safeParse(input);
  if (!p.success) return failText("กรุณาระบุเหตุผล");
  const supabase = await db();
  const { error } = await supabase.rpc("reverse_cash_movement", {
    p_idempotency_key: p.data.idempotencyKey, p_movement_id: p.data.movementId, p_reason: p.data.reason, p_shift_id: null,
  });
  if (error) return fail(error.message);
  revalidatePath("/cash");
  return { ok: true };
}
