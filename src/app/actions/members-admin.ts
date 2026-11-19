"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, db, fail, failText, type ActionResult } from "@/lib/actions";

const uuid = z.string().uuid();
const done = (): ActionResult => { revalidatePath("/members"); return { ok: true }; };

const loyaltySchema = z.object({
  membership_enabled: z.boolean(), points_enabled: z.boolean(),
  satang_per_point: z.number().int().positive().max(10_000_000).nullable(),
  earn_basis: z.enum(["net_after_discount", "gross_before_discount"]),
  tier_rolling_months: z.number().int().min(1).max(60), tier_downgrade_enabled: z.boolean(),
  stamps_enabled: z.boolean(), stamps_per_reward: z.number().int().min(1).max(1000),
  stamp_station: z.enum(["cake", "drink"]), stamp_reward_title: z.string().trim().min(1).max(120),
  stamp_reward_expire_days: z.number().int().min(1).max(3650),
  welcome_coupon_template_id: uuid.nullable(), birthday_coupon_template_id: uuid.nullable(),
  claim_qr_minutes: z.number().int().min(1).max(1440), claim_order_window_hours: z.number().int().min(1).max(720),
  comeback_days: z.number().int().positive().max(3650).nullable(), marketing_cap_days: z.number().int().min(0).max(365),
});

/** ตั้งค่าโปรแกรมสมาชิก — เจ้าของร้านเท่านั้น (RLS บังคับซ้ำ); ตัวเลขธุรกิจที่ยังไม่อนุมัติปล่อยว่างได้ */
export async function saveLoyaltySettings(input: z.infer<typeof loyaltySchema>): Promise<ActionResult> {
  const a = await authorize("settings");
  if ("error" in a) return failText(a.error);
  const p = loyaltySchema.safeParse(input);
  if (!p.success) return failText("ค่าที่กรอกไม่ถูกต้อง");
  if (p.data.points_enabled && p.data.satang_per_point === null) return failText("ต้องกำหนดอัตราแต้ม (กี่บาทต่อ 1 แต้ม) ก่อนเปิดระบบแต้ม");
  const { error } = await (await db()).from("loyalty_settings").update(p.data).eq("id", true);
  return error ? fail(error.message) : done();
}

const tierSchema = z.object({
  id: uuid, name: z.string().trim().min(1).max(60), minRollingSpendSatang: z.number().int().min(0).max(1_000_000_000_00).nullable(),
  benefits: z.array(z.string().trim().min(1).max(200)).max(20), active: z.boolean(),
});
export async function saveTier(input: z.infer<typeof tierSchema>): Promise<ActionResult> {
  const a = await authorize("settings");
  if ("error" in a) return failText(a.error);
  const p = tierSchema.safeParse(input);
  if (!p.success) return failText("ค่าที่กรอกไม่ถูกต้อง");
  const { error } = await (await db()).from("membership_tiers").update({
    name: p.data.name, min_rolling_spend_satang: p.data.minRollingSpendSatang, benefits: p.data.benefits, active: p.data.active,
  }).eq("id", p.data.id);
  return error ? fail(error.message) : done();
}

const templateSchema = z.object({
  id: uuid.nullable(), title: z.string().trim().min(1).max(120), description: z.string().trim().max(500).nullable(),
  source: z.enum(["reward", "birthday", "holiday", "promotion", "welcome", "manual"]),
  discountId: uuid.nullable(), pointCost: z.number().int().positive().max(1_000_000).nullable(),
  minSpendSatang: z.number().int().positive().max(100_000_000).nullable(),
  expireDays: z.number().int().positive().max(3650).nullable(), expireAt: z.string().datetime({ offset: true }).nullable(),
  quantityLimit: z.number().int().positive().max(1_000_000).nullable(), active: z.boolean(),
});
/** สร้าง/แก้แม่แบบคูปอง (CRUD อย่างเดียว — การออกคูปองจริงทำที่ฟังก์ชันฐานข้อมูลเท่านั้น) */
export async function saveCouponTemplate(input: z.infer<typeof templateSchema>): Promise<ActionResult> {
  const a = await authorize("members");
  if ("error" in a) return failText(a.error);
  const p = templateSchema.safeParse(input);
  if (!p.success) return failText("ค่าที่กรอกไม่ถูกต้อง");
  const v = p.data;
  if (v.expireDays === null && v.expireAt === null) return failText("ต้องกำหนดวันหมดอายุ (กี่วันหลังได้รับ หรือวันที่แน่นอน)");
  const row = {
    title: v.title, description: v.description, source: v.source, discount_id: v.discountId, point_cost: v.pointCost,
    min_spend_satang: v.minSpendSatang, expire_days: v.expireDays, expire_at: v.expireAt, quantity_limit: v.quantityLimit, active: v.active,
  };
  const supabase = await db();
  const { error } = v.id
    ? await supabase.from("coupon_templates").update(row).eq("id", v.id)
    : await supabase.from("coupon_templates").insert({ ...row, created_by: a.emp.id });
  return error ? fail(error.message) : done();
}

const keywordSchema = z.object({ id: uuid.nullable(), keyword: z.string().trim().min(1).max(100), responseText: z.string().trim().min(1).max(2000), active: z.boolean() });
export async function saveKeyword(input: z.infer<typeof keywordSchema>): Promise<ActionResult> {
  const a = await authorize("members");
  if ("error" in a) return failText(a.error);
  const p = keywordSchema.safeParse(input);
  if (!p.success) return failText("ค่าที่กรอกไม่ถูกต้อง");
  const row = { keyword: p.data.keyword, response_text: p.data.responseText, active: p.data.active };
  const supabase = await db();
  const { error } = p.data.id ? await supabase.from("chat_keywords").update(row).eq("id", p.data.id) : await supabase.from("chat_keywords").insert(row);
  return error ? fail(error.message) : done();
}

export async function deleteKeyword(id: string): Promise<ActionResult> {
  const a = await authorize("members");
  if ("error" in a) return failText(a.error);
  if (!uuid.safeParse(id).success) return failText("ข้อมูลไม่ถูกต้อง");
  const { error } = await (await db()).from("chat_keywords").delete().eq("id", id);
  return error ? fail(error.message) : done();
}
