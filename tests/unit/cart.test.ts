import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addProduct, cartTotals, lineKey, removeLine, setQty, toCheckoutItems, toggleAddon, MAX_QTY,
  type CartAddon, type CartDiscount, type CartLine, type CartProduct,
} from "../../src/lib/cart";

const original: CartProduct = { id: "p-original", name: "Original", emoji: "🍰", priceSatang: 5900 };
const matcha: CartProduct = { id: "p-matcha", name: "Matcha", emoji: "🍵", priceSatang: 7900 };
const shot: CartAddon = { id: "a-shot", name: "เพิ่มช็อต", priceSatang: 1000 };
const sauce: CartAddon = { id: "a-sauce", name: "ราดซอส", priceSatang: 1500 };

test("แตะสินค้าเดิมซ้ำ = เพิ่มจำนวน ไม่เพิ่มบรรทัด", () => {
  let c: CartLine[] = [];
  c = addProduct(c, original);
  c = addProduct(c, original);
  c = addProduct(c, matcha);
  assert.equal(c.length, 2);
  assert.equal(c[0].qty, 2);
  assert.equal(cartTotals(c, null).subtotal, 5900 * 2 + 7900);
  assert.equal(cartTotals(c, null).itemCount, 3);
});

test("ไม่แก้ state เดิม (immutable)", () => {
  const c0 = addProduct([], original);
  const c1 = addProduct(c0, original);
  assert.equal(c0[0].qty, 1);
  assert.equal(c1[0].qty, 2);
});

test("จำนวนสูงสุด 99 และ setQty ≤ 0 = ลบบรรทัด", () => {
  let c = addProduct([], original);
  c = setQty(c, c[0].key, 500);
  assert.equal(c[0].qty, MAX_QTY);
  c = addProduct(c, original);
  assert.equal(c[0].qty, MAX_QTY);
  c = setQty(c, c[0].key, 0);
  assert.equal(c.length, 0);
});

test("ลดจำนวนด้วย − จนเหลือ 0 = ลบบรรทัด / removeLine", () => {
  let c = addProduct(addProduct([], original), matcha);
  c = setQty(c, c[0].key, c[0].qty - 1);
  assert.equal(c.length, 1);
  assert.equal(c[0].productId, "p-matcha");
  c = removeLine(c, c[0].key);
  assert.deepEqual(c, []);
});

test("ตัวเลือกเสริม: เปลี่ยนราคาต่อหน่วย และเปลี่ยน key", () => {
  let c = addProduct([], original);
  c = setQty(c, c[0].key, 2);
  c = toggleAddon(c, c[0].key, shot);
  assert.equal(c[0].key, lineKey("p-original", ["a-shot"]));
  assert.equal(cartTotals(c, null).subtotal, (5900 + 1000) * 2);
  c = toggleAddon(c, c[0].key, sauce);
  assert.equal(cartTotals(c, null).subtotal, (5900 + 1000 + 1500) * 2);
  c = toggleAddon(c, c[0].key, shot);   // ปิด shot
  assert.equal(c[0].addons.length, 1);
  assert.equal(c[0].addons[0].id, "a-sauce");
});

test("ตัวเลือกเสริม: key ไม่ขึ้นกับลำดับที่เลือก", () => {
  assert.equal(lineKey("p", ["b", "a"]), lineKey("p", ["a", "b"]));
});

test("เปิด/ปิดตัวเลือกเสริมจนเหมือนบรรทัดอื่น = รวมจำนวน", () => {
  let c = addProduct([], original);          // บรรทัด A: Original ×1
  c = toggleAddon(c, c[0].key, shot);        // A → Original+shot ×1
  c = addProduct(c, original);               // บรรทัด B: Original ×1 (ไม่มี addon)
  assert.equal(c.length, 2);
  c = toggleAddon(c, c[0].key, shot);        // A ปิด shot → เหมือน B → รวมเป็น ×2
  assert.equal(c.length, 1);
  assert.equal(c[0].qty, 2);
});

test("ส่วนลดอัปเดตตามตะกร้าทันที", () => {
  const ten: CartDiscount = { id: "d1", name: "ลด 10%", kind: "percent", value: 1000 };
  const fifty: CartDiscount = { id: "d2", name: "ลด 50 บาท", kind: "fixed", value: 5000 };
  let c = addProduct([], original);
  assert.deepEqual(cartTotals(c, ten), { subtotal: 5900, discount: 590, total: 5310, itemCount: 1 });
  c = addProduct(c, original);
  assert.equal(cartTotals(c, ten).total, 11800 - 1180);
  assert.equal(cartTotals(c, fifty).total, 11800 - 5000);
  assert.equal(cartTotals([], fifty).total, 0);
});

test("toCheckoutItems ไม่ส่งราคาไปเซิร์ฟเวอร์", () => {
  let c = addProduct([], original);
  c = toggleAddon(c, c[0].key, shot);
  const items = toCheckoutItems(c);
  assert.deepEqual(items, [{ product_id: "p-original", quantity: 1, addon_ids: ["a-shot"] }]);
  assert.ok(!JSON.stringify(items).includes("price"));
});
