"use server";
import { z } from "zod";
import { authorize, db, fail, failText, type ActionResult } from "@/lib/actions";
import { parseMemberQr } from "@/lib/member-qr";
import { newClaimToken } from "@/lib/claim-token";
import type { Json } from "@/types/db";

const uuid = z.string().uuid();
const phone = z.string().trim().min(8).max(20);

/** ค้นหาสมาชิกที่เคาน์เตอร์ (เบอร์/4 ตัวท้าย/เลขสมาชิก/ชื่อ) — ผ่านฟังก์ชันที่ตรวจสิทธิ์ ไม่อ่านตารางตรง */
export async function findMember(query: string): Promise<ActionResult<Json[]>> {
  const a = await authorize("pos");
  if ("error" in a) return failText(a.error);
  const q = z.string().trim().min(1).max(100).safeParse(query);
  if (!q.success) return { ok: true, data: [] };
  const { data, error } = await (await db()).rpc("pos_find_member", { p_query: q.data });
  if (error) return fail(error.message);
  return { ok: true, data: (data ?? []) as Json[] };
}

/** สแกน/วาง QR สมาชิก (BBM1...) ตรวจลายเซ็น+หมดอายุบนเซิร์ฟเวอร์ แล้วหาสมาชิกจาก qr_ref */
export async function memberByQr(raw: string): Promise<ActionResult<Json>> {
  const a = await authorize("pos");
  if ("error" in a) return failText(a.error);
  const secret = process.env.MEMBER_QR_SECRET;
  if (!secret) return failText("ยังไม่ได้ตั้งค่า MEMBER_QR_SECRET บนเซิร์ฟเวอร์");
  const r = parseMemberQr(String(raw ?? "").slice(0, 300), secret);
  if (!r.ok) return failText(r.reason === "EXPIRED" ? "QR สมาชิกหมดอายุ ให้ลูกค้าเปิดบัตรสมาชิกใหม่" : "QR สมาชิกไม่ถูกต้อง");
  const { data, error } = await (await db()).rpc("pos_member_by_qr_ref", { p_qr_ref: r.qrRef });
  if (error) return fail(error.message);
  if (!data) return failText("ไม่พบสมาชิกจาก QR นี้");
  return { ok: true, data: data as Json };
}

const summarySchema = z.object({
  customerId: uuid,
  items: z.array(z.object({ product_id: uuid, quantity: z.number().int().min(1).max(99), addon_ids: z.array(uuid).max(20) })).max(100),
  netSatang: z.number().int().min(0).max(1_000_000_000),
  grossSatang: z.number().int().min(0).max(1_000_000_000),
});

/** ตัวอย่างแต้ม/แสตมป์ที่จะได้ + คูปองที่ใช้ได้ (แสดงผลเท่านั้น ตัวเลขจริงคำนวณที่ฐานข้อมูลตอนชำระ) */
export async function memberSummary(input: z.infer<typeof summarySchema>): Promise<ActionResult<Json>> {
  const a = await authorize("pos");
  if ("error" in a) return failText(a.error);
  const p = summarySchema.safeParse(input);
  if (!p.success) return failText("ข้อมูลไม่ถูกต้อง");
  const { data, error } = await (await db()).rpc("pos_member_summary", {
    p_customer: p.data.customerId, p_items: p.data.items, p_net_satang: p.data.netSatang, p_gross_satang: p.data.grossSatang,
  });
  if (error) return fail(error.message);
  return { ok: true, data: data as Json };
}

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100), phone, birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  privacy: z.boolean(), marketing: z.boolean(), customerId: uuid.nullable().optional(),
});

export async function registerMember(input: z.infer<typeof registerSchema>): Promise<ActionResult<Json>> {
  const a = await authorize("pos");
  if ("error" in a) return failText(a.error);
  const p = registerSchema.safeParse(input);
  if (!p.success) return failText("กรุณากรอกชื่อและเบอร์โทรให้ถูกต้อง");
  const { data, error } = await (await db()).rpc("pos_register_member", {
    p_name: p.data.name, p_phone: p.data.phone, p_birthday: p.data.birthday ?? null,
    p_privacy: p.data.privacy, p_marketing: p.data.marketing, p_customer_id: p.data.customerId ?? null,
  });
  if (error) return fail(error.message);
  return { ok: true, data: data as Json };
}

export async function orderMembership(orderId: string): Promise<ActionResult<Json>> {
  const a = await authorize("pos");
  if ("error" in a) return failText(a.error);
  if (!uuid.safeParse(orderId).success) return failText("ข้อมูลไม่ถูกต้อง");
  const { data, error } = await (await db()).rpc("pos_order_membership", { p_order: orderId });
  if (error) return fail(error.message);
  return { ok: true, data: data as Json };
}

function liffUrl(token: string): string | null {
  const id = process.env.NEXT_PUBLIC_LIFF_ID;
  return id ? `https://liff.line.me/${id}?claim=${encodeURIComponent(token)}` : null;
}

const claimSchema = z.object({
  purpose: z.enum(["join", "link", "claim"]), customerId: uuid.nullable().optional(), orderId: uuid.nullable().optional(),
});

/** สร้าง QR ให้ลูกค้าสแกน (สมัคร/ผูก LINE/รับแต้มย้อนหลัง) — เก็บเฉพาะแฮชของโทเคนในฐานข้อมูล */
export async function createClaimQr(input: z.infer<typeof claimSchema>): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  const a = await authorize("pos");
  if ("error" in a) return failText(a.error);
  const p = claimSchema.safeParse(input);
  if (!p.success) return failText("ข้อมูลไม่ถูกต้อง");
  const t = newClaimToken();
  const url = liffUrl(t.token);
  if (!url) return failText("ยังไม่ได้ตั้งค่า NEXT_PUBLIC_LIFF_ID");
  const { data, error } = await (await db()).rpc("pos_create_claim", {
    p_token_hash: t.hash, p_purpose: p.data.purpose, p_customer: p.data.customerId ?? null, p_order: p.data.orderId ?? null,
  });
  if (error) return fail(error.message);
  return { ok: true, data: { url, expiresAt: data as string } };
}

/** ใช้คูปองที่ไม่ใช่ส่วนลด (เช่น แลกของฟรี) ที่เคาน์เตอร์ */
export async function redeemCoupon(input: { couponId: string; note?: string }): Promise<ActionResult> {
  const a = await authorize("pos");
  if ("error" in a) return failText(a.error);
  const p = z.object({ couponId: uuid, note: z.string().trim().max(300).optional() }).safeParse(input);
  if (!p.success) return failText("ข้อมูลไม่ถูกต้อง");
  const { error } = await (await db()).rpc("redeem_member_coupon", { p_coupon_id: p.data.couponId, p_note: p.data.note ?? null });
  return error ? fail(error.message) : { ok: true };
}

// ---------------- งานจัดการ (เจ้าของ/ผู้จัดการ) ----------------
const reason = z.string().trim().min(1).max(300);

export async function getMembersOverview(from: string, to: string): Promise<ActionResult<Json>> {
  const a = await authorize("members");
  if ("error" in a) return failText(a.error);
  const p = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse({ from, to });
  if (!p.success) return failText("ช่วงวันที่ไม่ถูกต้อง");
  const { data, error } = await (await db()).rpc("members_overview", { p_from: p.data.from, p_to: p.data.to });
  return error ? fail(error.message) : { ok: true, data: data as Json };
}

export async function getMemberDetail(customerId: string): Promise<ActionResult<Json>> {
  const a = await authorize("members");
  if ("error" in a) return failText(a.error);
  if (!uuid.safeParse(customerId).success) return failText("ข้อมูลไม่ถูกต้อง");
  const { data, error } = await (await db()).rpc("pos_member_detail", { p_customer: customerId });
  return error ? fail(error.message) : { ok: true, data: data as Json };
}

export async function adjustPoints(input: { customerId: string; currency: "points" | "stamps"; amount: number; reason: string; key: string }): Promise<ActionResult> {
  const a = await authorize("members");
  if ("error" in a) return failText(a.error);
  const p = z.object({ customerId: uuid, currency: z.enum(["points", "stamps"]), amount: z.number().int().min(-100000).max(100000).refine((n) => n !== 0), reason, key: z.string().min(8).max(100) }).safeParse(input);
  if (!p.success) return failText("กรุณาระบุจำนวนและเหตุผลให้ถูกต้อง");
  const { error } = await (await db()).rpc("member_adjust_points", {
    p_customer: p.data.customerId, p_currency: p.data.currency, p_amount: p.data.amount, p_reason: p.data.reason, p_key: p.data.key,
  });
  return error ? fail(error.message) : { ok: true };
}

export async function issueCoupon(input: { customerId: string; templateId: string; key: string }): Promise<ActionResult> {
  const a = await authorize("members");
  if ("error" in a) return failText(a.error);
  const p = z.object({ customerId: uuid, templateId: uuid, key: z.string().min(8).max(100) }).safeParse(input);
  if (!p.success) return failText("ข้อมูลไม่ถูกต้อง");
  const { error } = await (await db()).rpc("issue_manual_coupon", { p_customer: p.data.customerId, p_template: p.data.templateId, p_key: p.data.key });
  return error ? fail(error.message) : { ok: true };
}

export async function cancelCoupon(input: { couponId: string; reason: string }): Promise<ActionResult> {
  const a = await authorize("members");
  if ("error" in a) return failText(a.error);
  const p = z.object({ couponId: uuid, reason }).safeParse(input);
  if (!p.success) return failText("กรุณาระบุเหตุผล");
  const { error } = await (await db()).rpc("cancel_member_coupon", { p_coupon_id: p.data.couponId, p_reason: p.data.reason });
  return error ? fail(error.message) : { ok: true };
}

export async function unlinkLine(input: { customerId: string; reason: string }): Promise<ActionResult> {
  const a = await authorize("members");
  if ("error" in a) return failText(a.error);
  const p = z.object({ customerId: uuid, reason }).safeParse(input);
  if (!p.success) return failText("กรุณาระบุเหตุผล");
  const { error } = await (await db()).rpc("pos_unlink_line", { p_customer: p.data.customerId, p_reason: p.data.reason });
  return error ? fail(error.message) : { ok: true };
}

export async function rotateMemberQr(customerId: string): Promise<ActionResult> {
  const a = await authorize("members");
  if ("error" in a) return failText(a.error);
  if (!uuid.safeParse(customerId).success) return failText("ข้อมูลไม่ถูกต้อง");
  const { error } = await (await db()).rpc("member_rotate_qr", { p_customer: customerId });
  return error ? fail(error.message) : { ok: true };
}

export async function runReconcile(days: number): Promise<ActionResult<{ processed: number }>> {
  const a = await authorize("members");
  if ("error" in a) return failText(a.error);
  const p = z.number().int().min(1).max(60).safeParse(days);
  if (!p.success) return failText("จำนวนวันไม่ถูกต้อง");
  const { data, error } = await (await db()).rpc("membership_reconcile", { p_days: p.data });
  return error ? fail(error.message) : { ok: true, data: { processed: data as number } };
}
