import { z } from "zod";
import { dbFailure, failure, lineUserFromRequest, ok, svc } from "@/lib/liff-api";
import { hashClaimToken, isClaimToken } from "@/lib/claim-token";
import { makeMemberQr } from "@/lib/member-qr";

export const dynamic = "force-dynamic";

const SECTIONS = ["points", "stamps", "coupons", "rewards", "orders", "collection", "journey", "tiers"] as const;
const name = z.string().trim().min(1).max(100);
const phone = z.string().trim().min(8).max(20);
const birthday = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

const registerSchema = z.object({ name, phone, birthday, privacy: z.boolean(), marketing: z.boolean().default(false) });
const profileSchema = z.object({
  name: name.optional(), birthday, marketing: z.boolean().optional(), acceptPrivacy: z.boolean().optional(),
});
const claimSchema = z.object({
  token: z.string(), name: name.optional(), phone: phone.optional(), birthday,
  privacy: z.boolean().optional(), marketing: z.boolean().optional(),
});
const rewardSchema = z.object({ templateId: z.string().uuid(), key: z.string().min(8).max(100) });
const sectionSchema = z.object({ section: z.enum(SECTIONS), limit: z.number().int().min(1).max(100).default(30) });

/** POST /api/liff/<action> — ลูกค้าเรียกจาก LIFF; ยืนยันตัวตนด้วย LINE ID token ทุกครั้ง แล้วเรียกฟังก์ชัน liff_* ด้วย service role บนเซิร์ฟเวอร์ */
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const user = await lineUserFromRequest(req);
  if (!user) return failure("NOT_AUTHENTICATED");
  let body: unknown = {};
  try { body = await req.json(); } catch { body = {}; }
  const db = svc();

  switch (action) {
    case "me": {
      const { data, error } = await db.rpc("liff_get_member", { p_line_user_id: user.userId });
      return error ? dbFailure(error.message) : ok(data);
    }
    case "section": {
      const p = sectionSchema.safeParse(body);
      if (!p.success) return failure("VALIDATION_FAILED", 400, "ข้อมูลไม่ถูกต้อง");
      const { data, error } = await db.rpc("liff_section", { p_line_user_id: user.userId, p_section: p.data.section, p_limit: p.data.limit });
      return error ? dbFailure(error.message) : ok(data);
    }
    case "qr": {
      const secret = process.env.MEMBER_QR_SECRET;
      if (!secret) return failure("UNKNOWN_ERROR", 500, "ระบบ QR สมาชิกยังไม่ได้ตั้งค่า");
      const { data, error } = await db.rpc("liff_member_qr_ref", { p_line_user_id: user.userId });
      if (error) return dbFailure(error.message);
      const ref = (data as { qr_ref?: string } | null)?.qr_ref;
      if (!ref) return failure("MEMBER_NOT_FOUND");
      const q = makeMemberQr(ref, secret);
      return ok({ value: q.value, expires_at: q.expiresAt });
    }
    case "register": {
      const p = registerSchema.safeParse(body);
      if (!p.success) return failure("VALIDATION_FAILED", 400, "กรุณากรอกชื่อและเบอร์โทรให้ถูกต้อง");
      const { data, error } = await db.rpc("liff_register", {
        p_line_user_id: user.userId, p_line_name: user.name, p_line_picture: user.picture,
        p_name: p.data.name, p_phone: p.data.phone, p_birthday: p.data.birthday ?? null,
        p_privacy: p.data.privacy, p_marketing: p.data.marketing,
      });
      return error ? dbFailure(error.message) : ok(data, "registered", 201);
    }
    case "profile": {
      const p = profileSchema.safeParse(body);
      if (!p.success) return failure("VALIDATION_FAILED", 400, "ข้อมูลไม่ถูกต้อง");
      const { data, error } = await db.rpc("liff_update_profile", {
        p_line_user_id: user.userId, p_name: p.data.name ?? null, p_birthday: p.data.birthday ?? null,
        p_marketing: p.data.marketing ?? null, p_accept_privacy: p.data.acceptPrivacy ?? null,
      });
      return error ? dbFailure(error.message) : ok(data);
    }
    case "unlink": {
      const { error } = await db.rpc("liff_unlink", { p_line_user_id: user.userId });
      return error ? dbFailure(error.message) : ok(null);
    }
    case "reward-claim": {
      const p = rewardSchema.safeParse(body);
      if (!p.success) return failure("VALIDATION_FAILED", 400, "ข้อมูลไม่ถูกต้อง");
      const { data, error } = await db.rpc("liff_claim_reward", { p_line_user_id: user.userId, p_template: p.data.templateId, p_key: p.data.key });
      return error ? dbFailure(error.message) : ok(data, "claimed", 201);
    }
    case "claim": {
      const p = claimSchema.safeParse(body);
      if (!p.success || !isClaimToken(p.data.token)) return failure("CLAIM_INVALID");
      const { data, error } = await db.rpc("claim_consume", {
        p_token_hash: hashClaimToken(p.data.token), p_line_user_id: user.userId, p_line_name: user.name, p_line_picture: user.picture,
        p_name: p.data.name ?? null, p_phone: p.data.phone ?? null, p_birthday: p.data.birthday ?? null,
        p_privacy: p.data.privacy ?? null, p_marketing: p.data.marketing ?? null,
      });
      return error ? dbFailure(error.message) : ok(data);
    }
    default:
      return failure("VALIDATION_FAILED", 404, "ไม่พบบริการนี้");
  }
}
