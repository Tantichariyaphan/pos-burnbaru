import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyLineSignature } from "../../src/lib/line/signature";
import { verifyIdToken } from "../../src/lib/line/id-token";
import { pushMessage } from "../../src/lib/line/client";
import { buildNotification } from "../../src/lib/line/messages";

const secret = "channel-secret";
const body = JSON.stringify({ events: [{ type: "follow" }] });
const sig = createHmac("sha256", secret).update(body).digest("base64");

test("signature: ถูกต้อง/ผิด/ว่าง/ตัวอักษรเปลี่ยน", () => {
  assert.equal(verifyLineSignature(body, sig, secret), true);
  assert.equal(verifyLineSignature(body + " ", sig, secret), false);
  assert.equal(verifyLineSignature(body, sig, "other"), false);
  assert.equal(verifyLineSignature(body, null, secret), false);
  assert.equal(verifyLineSignature(body, "", secret), false);
  assert.equal(verifyLineSignature(body, "abc", secret), false);
  assert.equal(verifyLineSignature(body, sig, ""), false);
});

const res = (status: number, json: unknown) => (async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;

test("id-token: ผ่านเมื่อ LINE ยืนยัน และ aud ตรง", async () => {
  const u = await verifyIdToken("tok", "chan", res(200, { sub: "U123", name: "A", aud: "chan", exp: Math.floor(Date.now() / 1000) + 60 }));
  assert.deepEqual(u, { userId: "U123", name: "A", picture: null });
});
test("id-token: ปฏิเสธเมื่อ LINE ไม่ยืนยัน/aud ไม่ตรง/หมดอายุ/ไม่มี sub/เครือข่ายล้ม", async () => {
  assert.equal(await verifyIdToken("tok", "chan", res(400, { error: "x" })), null);
  assert.equal(await verifyIdToken("tok", "chan", res(200, { sub: "U1", aud: "other" })), null);
  assert.equal(await verifyIdToken("tok", "chan", res(200, { sub: "U1", aud: "chan", exp: 1 })), null);
  assert.equal(await verifyIdToken("tok", "chan", res(200, { name: "x" })), null);
  assert.equal(await verifyIdToken("tok", "chan", (async () => { throw new Error("down"); }) as unknown as typeof fetch), null);
  assert.equal(await verifyIdToken("", "chan", res(200, { sub: "U1" })), null);
});
test("id-token: ส่ง client_id และ id_token ไปที่ endpoint ของ LINE", async () => {
  let seen = { url: "", body: "" };
  const f = (async (url: string, init: RequestInit) => { seen = { url, body: String(init.body) }; return new Response(JSON.stringify({ sub: "U1" })); }) as unknown as typeof fetch;
  await verifyIdToken("abc", "chan", f);
  assert.equal(seen.url, "https://api.line.me/oauth2/v2.1/verify");
  assert.match(seen.body, /id_token=abc/);
  assert.match(seen.body, /client_id=chan/);
});

test("push: 200=สำเร็จ, 409=ถือว่าสำเร็จ (retry key ซ้ำ), 400=ไม่ลองใหม่, 429/500=ลองใหม่, เครือข่ายล้ม=ลองใหม่", async () => {
  const send = (f: typeof fetch) => pushMessage("t", "U1", [{ type: "text", text: "x" }], "key-1", f);
  assert.equal((await send(res(200, {}))).ok, true);
  assert.deepEqual(await send(res(409, {})), { ok: true, status: 409, retryable: false });
  assert.deepEqual(await send(res(400, {})), { ok: false, status: 400, retryable: false, error: "LINE 400" });
  assert.equal((await send(res(429, {}))).retryable, true);
  assert.equal((await send(res(503, {}))).retryable, true);
  assert.equal((await send((async () => { throw new Error("x"); }) as unknown as typeof fetch)).retryable, true);
});
test("push: ใส่ X-Line-Retry-Key และ Authorization", async () => {
  let h: Record<string, string> = {};
  const f = (async (_u: string, init: RequestInit) => { h = init.headers as Record<string, string>; return new Response("{}"); }) as unknown as typeof fetch;
  await pushMessage("TOKEN", "U1", [{ type: "text", text: "x" }], "rk-9", f);
  assert.equal(h["X-Line-Retry-Key"], "rk-9");
  assert.equal(h.Authorization, "Bearer TOKEN");
});

test("ข้อความแจ้งเตือน: ไม่รั่วโทเคน, แต่ละชนิดมีเนื้อหา, ยาวไม่เกินเพดาน", () => {
  const p = { points: 5, points_balance: 12, stamps: 1, stamps_balance: 3, title: "ลด 10%", expires_at: "2026-12-31T00:00:00Z", tier_name: "SIGNATURE" };
  for (const ev of ["member_registered", "first_purchase", "points_earned", "tier_upgraded", "coupon_issued", "birthday", "points_redeemed", "queue_ready", "coupon_expiring", "comeback", "unknown"]) {
    const m = buildNotification(ev, p, "อ้อม", "https://liff.line.me/1");
    assert.equal(m.length, 1);
    assert.ok(m[0].text.length > 5 && m[0].text.length <= 4900, ev);
  }
  assert.match(buildNotification("points_earned", p, "อ้อม", null)[0].text, /\+5 แต้ม/);
  assert.match(buildNotification("tier_upgraded", p, null, null)[0].text, /SIGNATURE/);
  assert.equal(buildNotification("queue_ready", p, "อ้อม", "https://liff.line.me/1")[0].text.includes("liff.line.me"), false);
  assert.ok(buildNotification("coupon_issued", { title: "x".repeat(9000) }, null, null)[0].text.length <= 4900);
});
