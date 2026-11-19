import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMemberQr, parseMemberQr } from "../../src/lib/member-qr";
import { hashClaimToken, isClaimToken, newClaimToken } from "../../src/lib/claim-token";
import { matchMessage, normalizeText } from "../../src/lib/chatbot";
import { dispatchOutbox } from "../../src/lib/outbox-dispatch";
import { isPublicPath } from "../../src/lib/supabase/middleware";
import { can } from "../../src/lib/roles";

const SECRET = "x".repeat(40);

test("member QR: สร้าง→ตรวจผ่าน, ไม่เปิดเผย id, หมดอายุ, ปลอม, เปลี่ยน ref, ผิดรูปแบบ", () => {
  const now = Date.now();
  const q = makeMemberQr("abcDEF12_-xy", SECRET, now, 120);
  assert.match(q.value, /^BBM1\.abcDEF12_-xy\.\d+\./);
  assert.deepEqual(parseMemberQr(q.value, SECRET, now + 60_000), { ok: true, qrRef: "abcDEF12_-xy" });
  assert.deepEqual(parseMemberQr(q.value, SECRET, now + 121_000), { ok: false, reason: "EXPIRED" });
  assert.deepEqual(parseMemberQr(q.value, "y".repeat(40), now), { ok: false, reason: "SIGNATURE" });
  const parts = q.value.split(".");
  assert.equal(parseMemberQr([parts[0], "otherRef12345", parts[2], parts[3]].join("."), SECRET, now).ok, false);
  assert.equal(parseMemberQr([parts[0], parts[1], String(Number(parts[2]) + 9999), parts[3]].join("."), SECRET, now).ok, false);
  for (const bad of ["", "BBM1", "BBM2.a.b.c", "BBM1.abc.123.sig", "x.y", null as unknown as string]) assert.equal(parseMemberQr(bad, SECRET).ok, false);
});

test("claim token: สุ่มไม่ซ้ำ, hash คงที่, ตรวจรูปแบบ", () => {
  const a = newClaimToken(); const b = newClaimToken();
  assert.notEqual(a.token, b.token);
  assert.equal(a.hash, hashClaimToken(a.token));
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.equal(isClaimToken(a.token), true);
  assert.equal(isClaimToken("short"), false);
  assert.equal(isClaimToken(undefined), false);
  assert.notEqual(a.hash, a.token);
});

test("chatbot: normalize / alias / ตรงทั้งหมด / ตรงบางส่วน / ไม่พบ", () => {
  const kw = [{ keyword: "เวลาเปิด", response_text: "เปิด 9-18" }, { keyword: "โปร", response_text: "โปรเดือนนี้" }, { keyword: "โปรโมชั่นพิเศษ", response_text: "พิเศษ" }];
  assert.equal(normalizeText("  Member   CARD "), "member card");
  assert.deepEqual(matchMessage("บัตรสมาชิก", kw), { kind: "intent", intent: "member_card" });
  assert.deepEqual(matchMessage(" MY POINTS", kw), { kind: "intent", intent: "points" });
  assert.deepEqual(matchMessage("คูปอง", kw), { kind: "intent", intent: "coupons" });
  assert.deepEqual(matchMessage("เวลาเปิด", kw), { kind: "keyword", text: "เปิด 9-18" });
  assert.deepEqual(matchMessage("ขอดูโปรโมชั่นพิเศษหน่อย", kw), { kind: "keyword", text: "พิเศษ" }); // ยาวสุดชนะ
  assert.deepEqual(matchMessage("มีโปรไหม", kw), { kind: "keyword", text: "โปรเดือนนี้" });
  assert.deepEqual(matchMessage("สวัสดีครับ", kw), { kind: "none" });
  assert.deepEqual(matchMessage("   ", kw), { kind: "none" });
});

function fakeDb(rows: unknown[]) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return fn === "outbox_claim" ? { data: rows, error: null } : { data: null, error: null }; } };
  return { db: db as never, calls };
}
const row = (id: string, line: string | null) => ({ id, category: "transactional", event_type: "points_earned", payload: { points: 1 }, attempts: 1, line_user_id: line, member_name: "A" });

test("outbox dispatch: ส่งสำเร็จ/ล้มเหลวแบบลองใหม่/ไม่มี LINE; ใช้ id เป็น retry key", async () => {
  const { db, calls } = fakeDb([row("a", "U1"), row("b", "U2"), row("c", null)]);
  const keys: string[] = [];
  const r = await dispatchOutbox(db, {
    token: "t", liffUrl: null,
    push: async (_t, to, _m, key) => { keys.push(key); return to === "U1" ? { ok: true, status: 200, retryable: false } : { ok: false, status: 500, retryable: true, error: "LINE 500" }; },
    build: () => [{ type: "text", text: "x" }],
  });
  assert.deepEqual(r, { claimed: 3, sent: 1, failed: 2 });
  assert.deepEqual(keys, ["a", "b"]);
  const done = calls.filter((c) => c.fn === "outbox_complete").map((c) => c.args);
  assert.deepEqual(done.map((d) => [d.p_id, d.p_ok, d.p_retryable]), [["a", true, false], ["b", false, true], ["c", false, false]]);
});
test("outbox dispatch: claim ล้มเหลว = ไม่ส่งอะไรและไม่ throw", async () => {
  const db = { rpc: async () => ({ data: null, error: { message: "x" } }) } as never;
  assert.deepEqual(await dispatchOutbox(db, { token: "t", liffUrl: null, push: async () => { throw new Error("no"); }, build: () => [] }), { claimed: 0, sent: 0, failed: 0 });
});

test("middleware: เส้นทางสาธารณะเฉพาะที่กำหนด", () => {
  for (const p of ["/q/abc", "/api/queue/abc", "/liff", "/liff/x", "/api/liff/me", "/api/line/webhook", "/api/cron/outbox"]) assert.equal(isPublicPath(p), true, p);
  for (const p of ["/pos", "/members", "/api/other", "/liffx", "/quiet", "/receipt/1", "/", "/api"]) assert.equal(isPublicPath(p), false, p);
});

test("สิทธิ์: members เฉพาะเจ้าของ/ผู้จัดการ", () => {
  assert.equal(can("owner", "members"), true);
  assert.equal(can("manager", "members"), true);
  assert.equal(can("cashier", "members"), false);
  assert.equal(can(null, "members"), false);
  assert.equal(can("cashier", "pos"), true);
});
