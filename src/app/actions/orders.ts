"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, db, fail, failText, type ActionResult } from "@/lib/actions";

export async function refundOrder(input: {
  idempotencyKey: string; orderId: string; amountSatang: number; method: "cash" | "transfer"; reason: string;
}): Promise<ActionResult> {
  const a = await authorize("orders.refund");
  if ("error" in a) return failText(a.error);
  const p = z.object({
    idempotencyKey: z.string().uuid(), orderId: z.string().uuid(),
    amountSatang: z.number().int().positive().max(1_000_000_000),
    method: z.enum(["cash", "transfer"]), reason: z.string().trim().min(1).max(500),
  }).safeParse(input);
  if (!p.success) return failText("กรุณากรอกจำนวนเงินและเหตุผลการคืนเงินให้ถูกต้อง");
  const supabase = await db();
  const { error } = await supabase.rpc("refund_order", {
    p_idempotency_key: p.data.idempotencyKey, p_order_id: p.data.orderId, p_amount_satang: p.data.amountSatang,
    p_method: p.data.method, p_reason: p.data.reason, p_shift_id: null,
  });
  if (error) return fail(error.message);
  revalidatePath("/orders");
  return { ok: true };
}
