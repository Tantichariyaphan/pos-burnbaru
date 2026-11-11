import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { encodeQr, qrSvgPath } from "../../src/lib/qr";

const sha = (m: boolean[][]) => createHash("sha256").update(m.map((r) => r.map((c) => (c ? 1 : 0)).join("")).join("\n")).digest("hex");

// golden hash: เมทริกซ์เหล่านี้ถอดรหัสกลับได้ถูกต้องด้วย OpenCV QRCodeDetector ตอนพัฒนา
const GOLDEN: [string, "L" | "M", number, string][] = [
  ["HELLO WORLD", "M", 1, "2d21897bf5a7ac606d02da07bdd5e7f02a8b90097f12404b1f7d764f18ef618c"],
  ["https://burnbaru-pos.vercel.app/q/" + "0123456789abcdef".repeat(4), "M", 6, "9d12941401710328c9df15c0c166227cfa217e7be78db151ac1eebe9c5789222"],
  ["https://example.com/q/abc", "L", 2, "49d2ebcfe0bcbddcf7248a14906190e6f283a168c4bf9f1f715bf0ee4ee190a1"],
  ["ร้านเค้ก BurnBaru ☕", "M", 3, "7c291187096c56dacb5f869f7becf019407979463470a4dddc25b8b2a7f5ec6b"],
];

test("QR: golden matrices (ตรวจถอดรหัสแล้ว) ไม่เปลี่ยน", () => {
  for (const [text, ecc, version, hash] of GOLDEN) {
    const q = encodeQr(text, ecc);
    assert.equal(q.version, version, text);
    assert.equal(q.size, version * 4 + 17);
    assert.equal(sha(q.modules), hash, text);
  }
});

test("QR: โครงสร้างพื้นฐาน (finder, timing, dark module) และ deterministic", () => {
  const q = encodeQr("https://x.test/q/abc", "M");
  const m = q.modules;
  for (const [ox, oy] of [[0, 0], [q.size - 7, 0], [0, q.size - 7]]) {
    for (let i = 0; i < 7; i++) {
      assert.equal(m[oy][ox + i], true); assert.equal(m[oy + 6][ox + i], true);
      assert.equal(m[oy + i][ox], true); assert.equal(m[oy + i][ox + 6], true);
    }
    assert.equal(m[oy + 3][ox + 3], true);   // จุดกลาง
    assert.equal(m[oy + 1][ox + 1], false);  // วงสว่างด้านใน
  }
  for (let i = 8; i < q.size - 8; i++) assert.equal(m[6][i], i % 2 === 0);   // timing
  assert.equal(m[q.size - 8][8], true);                                      // dark module
  assert.deepEqual(encodeQr("https://x.test/q/abc", "M").modules, m);
});

test("QR: เลือกเวอร์ชันตามความยาว และข้อความยาวเกินจะ throw", () => {
  assert.equal(encodeQr("a", "M").version, 1);
  assert.equal(encodeQr("a".repeat(14), "M").version, 1);
  assert.equal(encodeQr("a".repeat(15), "M").version, 2);
  assert.equal(encodeQr("a".repeat(213), "M").version, 10);
  assert.throws(() => encodeQr("a".repeat(214), "M"), RangeError);
  assert.equal(encodeQr("a".repeat(271), "L").version, 10);
});

test("QR: URL คิวจริง (~100 ตัวอักษร) พอดีในเวอร์ชัน ≤ 7 และ SVG path ถูกต้อง", () => {
  const q = encodeQr("https://burnbaru-pos.vercel.app/q/" + "a1".repeat(32), "M");
  assert.ok(q.version <= 7);
  const { d, dimension } = qrSvgPath(q, 4);
  assert.equal(dimension, q.size + 8);
  assert.match(d, /^M\d+ \d+h\d+v1h-\d+z/);
  // จำนวนพื้นที่สีเข้มใน path = จำนวนโมดูลสีเข้ม
  let dark = 0; for (const r of q.modules) for (const c of r) if (c) dark++;
  let area = 0; for (const mm of d.matchAll(/h(\d+)v1/g)) area += Number(mm[1]);
  assert.equal(area, dark);
});
