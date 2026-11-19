import { createHmac, timingSafeEqual } from "node:crypto";

/** ตรวจ x-line-signature = base64(HMAC-SHA256(channelSecret, rawBody)) ด้วยการเทียบแบบเวลาคงที่ */
export function verifyLineSignature(rawBody: string, signature: string | null | undefined, channelSecret: string): boolean {
  if (!signature || !channelSecret) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest();
  let given: Buffer;
  try { given = Buffer.from(signature, "base64"); } catch { return false; }
  return given.length === expected.length && timingSafeEqual(given, expected);
}
