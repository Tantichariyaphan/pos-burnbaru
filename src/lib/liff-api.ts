import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lineConfig } from "@/lib/line/config";
import { verifyIdToken, type VerifiedLineUser } from "@/lib/line/id-token";
import { errorCode, friendlyError } from "@/lib/errors";

/** รูปแบบตอบกลับมาตรฐานของ API ฝั่งลูกค้า: {success,data,message} | {success:false,error,code,message} */
export const ok = (data: unknown, message = "ok", status = 200) =>
  NextResponse.json({ success: true, data, message }, { status, headers: { "Cache-Control": "no-store" } });

const STATUS: Record<string, number> = {
  NOT_AUTHENTICATED: 401, MEMBER_NOT_FOUND: 404, TEMPLATE_NOT_FOUND: 404, CLAIM_INVALID: 404,
  PHONE_ALREADY_MEMBER: 409, LINE_ALREADY_LINKED: 409, CLAIM_USED: 409, CLAIM_EXPIRED: 409,
};

export function failure(code: string, status?: number, message?: string) {
  return NextResponse.json(
    { success: false, error: code, code, message: message ?? friendlyError(code) },
    { status: status ?? STATUS[code] ?? 422, headers: { "Cache-Control": "no-store" } },
  );
}

/** แปลงข้อผิดพลาดจากฐานข้อมูลเป็นรหัสธุรกิจ (ไม่เปิดเผย SQL); ข้อผิดพลาดที่ไม่รู้จักเป็น 500 */
export function dbFailure(message: string | null | undefined) {
  const code = errorCode(message);
  if (code && code !== "DATABASE") return failure(code);
  return failure("UNKNOWN_ERROR", 500, "ทำรายการไม่สำเร็จ กรุณาลองใหม่");
}

export async function lineUserFromRequest(req: Request): Promise<VerifiedLineUser | null> {
  const cfg = lineConfig();
  if (!cfg) return null;
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? verifyIdToken(m[1], cfg.loginChannelId) : null;
}

export const svc = () => createAdminClient();
