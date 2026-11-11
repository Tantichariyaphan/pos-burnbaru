"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, db, fail, failText, type ActionResult } from "@/lib/actions";

export async function saveCustomer(input: { id?: string; name: string; phone?: string; note?: string; active: boolean }): Promise<ActionResult> {
  const a = await authorize("customers");
  if ("error" in a) return failText(a.error);
  const p = z.object({
    id: z.string().uuid().optional(), name: z.string().trim().min(1, "กรุณากรอกชื่อ").max(100),
    phone: z.string().trim().max(30).optional(), note: z.string().trim().max(500).optional(), active: z.boolean(),
  }).safeParse(input);
  if (!p.success) return failText(p.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const supabase = await db();
  const row = { name: p.data.name, phone: p.data.phone || null, note: p.data.note || null, active: p.data.active };
  const { error } = p.data.id
    ? await supabase.from("customers").update(row).eq("id", p.data.id)
    : await supabase.from("customers").insert(row);
  if (error) return fail(error.message);
  revalidatePath("/customers");
  return { ok: true };
}
