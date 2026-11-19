import { createHash, randomBytes } from "node:crypto";

/** โทเคน Claim QR: สุ่ม 32 ไบต์ ส่งให้ลูกค้าเป็นข้อความใน URL; ฐานข้อมูลเก็บเฉพาะ sha256 (ไม่เก็บโทเคนจริง) */
export function newClaimToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashClaimToken(token) };
}
export const hashClaimToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const isClaimToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{43}$/.test(t);
