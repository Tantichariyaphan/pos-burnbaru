/** ตรวจ LIFF ID token กับ LINE (POST /oauth2/v2.1/verify) แล้วคืน LINE userId (sub) — ไม่เชื่อ userId ที่ client ส่งมาเอง */
export interface VerifiedLineUser { userId: string; name: string | null; picture: string | null }

export async function verifyIdToken(
  idToken: string, loginChannelId: string, fetchImpl: typeof fetch = fetch,
): Promise<VerifiedLineUser | null> {
  if (!idToken || idToken.length > 4096 || !loginChannelId) return null;
  try {
    const res = await fetchImpl("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: loginChannelId }).toString(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { sub?: string; name?: string; picture?: string; aud?: string; exp?: number };
    if (!j.sub || typeof j.sub !== "string") return null;
    if (j.aud && j.aud !== loginChannelId) return null;
    if (typeof j.exp === "number" && j.exp * 1000 < Date.now()) return null;
    return { userId: j.sub, name: j.name ?? null, picture: j.picture ?? null };
  } catch {
    return null;
  }
}
