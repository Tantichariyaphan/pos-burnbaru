"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, db, fail, failText, type ActionResult } from "@/lib/actions";

const uuid = z.string().uuid();
const qty = z.number().finite();

export async function saveInventoryItem(input: { id?: string; name: string; unit: string; lowStock: number; active: boolean }): Promise<ActionResult> {
  const a = await authorize("inventory");
  if ("error" in a) return failText(a.error);
  const p = z.object({
    id: uuid.optional(), name: z.string().trim().min(1).max(100), unit: z.string().trim().min(1).max(20),
    lowStock: qty.min(0).max(1_000_000), active: z.boolean(),
  }).safeParse(input);
  if (!p.success) return failText("ข้อมูลไม่ถูกต้อง");
  const supabase = await db();
  const row = { name: p.data.name, unit: p.data.unit, low_stock_level: p.data.lowStock, active: p.data.active };
  const { error } = p.data.id
    ? await supabase.from("inventory_items").update(row).eq("id", p.data.id)
    : await supabase.from("inventory_items").insert(row);
  if (error) return fail(error.message);
  revalidatePath("/inventory");
  return { ok: true };
}

export async function adjustStock(input: { itemId: string; kind: "receive" | "waste" | "adjust"; qty: number; note?: string }): Promise<ActionResult> {
  const a = await authorize("inventory");
  if ("error" in a) return failText(a.error);
  const p = z.object({
    itemId: uuid, kind: z.enum(["receive", "waste", "adjust"]), qty: qty.refine((n) => n !== 0).refine((n) => Math.abs(n) <= 1_000_000),
    note: z.string().trim().max(300).optional(),
  }).safeParse(input);
  if (!p.success) return failText("จำนวนไม่ถูกต้อง");
  const supabase = await db();
  const { error } = await supabase.rpc("adjust_stock", {
    p_item_id: p.data.itemId, p_kind: p.data.kind, p_qty: p.data.qty, p_note: p.data.note ?? null,
  });
  if (error) return fail(error.message);
  revalidatePath("/inventory");
  return { ok: true };
}

export async function saveRecipe(input: { productId: string; itemId: string; qtyPerUnit: number }): Promise<ActionResult> {
  const a = await authorize("inventory");
  if ("error" in a) return failText(a.error);
  const p = z.object({ productId: uuid, itemId: uuid, qtyPerUnit: qty.positive().max(1_000_000) }).safeParse(input);
  if (!p.success) return failText("จำนวนต่อหน่วยไม่ถูกต้อง");
  const supabase = await db();
  const { error } = await supabase.from("recipes").upsert(
    { product_id: p.data.productId, inventory_item_id: p.data.itemId, qty_per_unit: p.data.qtyPerUnit },
    { onConflict: "product_id,inventory_item_id" },
  );
  if (error) return fail(error.message);
  revalidatePath("/inventory");
  return { ok: true };
}

export async function deleteRecipe(input: { productId: string; itemId: string }): Promise<ActionResult> {
  const a = await authorize("inventory");
  if ("error" in a) return failText(a.error);
  const p = z.object({ productId: uuid, itemId: uuid }).safeParse(input);
  if (!p.success) return failText("ข้อมูลไม่ถูกต้อง");
  const supabase = await db();
  const { error } = await supabase.from("recipes").delete().eq("product_id", p.data.productId).eq("inventory_item_id", p.data.itemId);
  if (error) return fail(error.message);
  revalidatePath("/inventory");
  return { ok: true };
}
