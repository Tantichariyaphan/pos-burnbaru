import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * QR สมาชิกแบบหมดอายุเอง: BBM1.<qr_ref>.<exp>.<sig>
 * - qr_ref เป็นรหัสสุ่มแบบ opaque (ไม่ใช่ id ฐานข้อมูล/เบอร์โทร) ต่อสมาชิก, หมุนได้ด้วย member_rotate_qr
 * - sig = HMAC-SHA256(secret, "BBM1.<qr_ref>.<exp>") ตัดเหลือ 16 ไบต์ base64url — กันปลอม/แคปภาพเก่ามาใช้
 */
const PREFIX = "BBM1";
export const MEMBER_QR_TTL_SECONDS = 120;

const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest().subarray(0, 16).toString("base64url");

export function makeMemberQr(qrRef: string, secret: string, nowMs = Date.now(), ttlSeconds = MEMBER_QR_TTL_SECONDS) {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  const body = `${PREFIX}.${qrRef}.${exp}`;
  return { value: `${body}.${sign(secret, body)}`, expiresAt: exp * 1000 };
}

export type MemberQrResult = { ok: true; qrRef: string } | { ok: false; reason: "FORMAT" | "SIGNATURE" | "EXPIRED" };

export function parseMemberQr(raw: string, secret: string, nowMs = Date.now()): MemberQrResult {
  const parts = (raw ?? "").trim().split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX || !/^[A-Za-z0-9_-]{8,64}$/.test(parts[1]) || !/^\d{9,12}$/.test(parts[2])) {
    return { ok: false, reason: "FORMAT" };
  }
  const [, qrRef, exp, sig] = parts;
  const want = Buffer.from(sign(secret, `${PREFIX}.${qrRef}.${exp}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "SIGNATURE" };
  if (Number(exp) * 1000 < nowMs) return { ok: false, reason: "EXPIRED" };
  return { ok: true, qrRef };
}
