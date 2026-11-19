/** ส่งข้อความผ่าน LINE Messaging API ด้วย fetch (ไม่มี dependency เพิ่ม) */
const API = "https://api.line.me/v2/bot/message";

export interface LineMessage { type: "text"; text: string }
export interface SendResult { ok: boolean; status: number; retryable: boolean; error?: string }

async function post(path: string, token: string, body: unknown, retryKey?: string, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  try {
    const res = await fetchImpl(`${API}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(retryKey ? { "X-Line-Retry-Key": retryKey } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (res.ok) return { ok: true, status: res.status, retryable: false };
    // 409 = เคยส่งด้วย retry key นี้แล้ว (ถือว่าสำเร็จ); 4xx อื่นไม่ลองใหม่; 429/5xx ลองใหม่ได้
    if (res.status === 409) return { ok: true, status: 409, retryable: false };
    return { ok: false, status: res.status, retryable: res.status === 429 || res.status >= 500, error: `LINE ${res.status}` };
  } catch {
    return { ok: false, status: 0, retryable: true, error: "LINE network error" };
  }
}

export const pushMessage = (token: string, to: string, messages: LineMessage[], retryKey: string, f?: typeof fetch) =>
  post("push", token, { to, messages }, retryKey, f);
export const replyMessage = (token: string, replyToken: string, messages: LineMessage[], f?: typeof fetch) =>
  post("reply", token, { replyToken, messages }, undefined, f);
