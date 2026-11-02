import { test } from "node:test";
import assert from "node:assert/strict";
import { bahtToSatang, bpToPercentLabel, calcChange, calcDiscount, formatBaht, quickCashAmounts, MAX_SATANG } from "../../src/lib/money";

test("formatBaht: จำนวนเต็มไม่แสดงทศนิยม, มีเศษแสดง 2 ตำแหน่ง, คั่นหลักพัน", () => {
  assert.equal(formatBaht(5900), "฿59");
  assert.equal(formatBaht(5950), "฿59.50");
  assert.equal(formatBaht(5), "฿0.05");
  assert.equal(formatBaht(0), "฿0");
  assert.equal(formatBaht(123456), "฿1,234.56");
  assert.equal(formatBaht(100000000), "฿1,000,000");
  assert.equal(formatBaht(-1050), "-฿10.50");
  assert.equal(formatBaht(5900, { decimals: "always" }), "฿59.00");
  assert.equal(formatBaht(5900, { symbol: false }), "59");
});

test("bahtToSatang: แปลงจากสตริงโดยไม่ผ่าน float", () => {
  assert.equal(bahtToSatang("59"), 5900);
  assert.equal(bahtToSatang("59.5"), 5950);
  assert.equal(bahtToSatang("59.05"), 5905);
  assert.equal(bahtToSatang("0.1"), 10);
  assert.equal(bahtToSatang("1,250.75"), 125075);
  assert.equal(bahtToSatang("฿40"), 4000);
  assert.equal(bahtToSatang(79), 7900);
  assert.equal(bahtToSatang(" 12 "), 1200);
  // 19.99 * 100 ใน float = 1998.9999999999998 → ต้องได้ 1999 เป๊ะ
  assert.equal(bahtToSatang("19.99"), 1999);
  assert.equal(bahtToSatang("1.15"), 115);
});

test("bahtToSatang: ปฏิเสธข้อมูลคลุมเครือ", () => {
  for (const bad of ["", "  ", "abc", "-5", "1.234", "1,23", "1,2345", ".5", "5.", "1e3", "NaN", "12 บาท", null, undefined]) {
    assert.equal(bahtToSatang(bad as never), null, `ควรปฏิเสธ ${String(bad)}`);
  }
  assert.equal(bahtToSatang("1000000"), MAX_SATANG);
  assert.equal(bahtToSatang("1000000.01"), null);
});

test("calcDiscount: เปอร์เซ็นต์ปัดครึ่งขึ้น (ตรงกับ SQL calc_discount)", () => {
  assert.equal(calcDiscount(5900, "percent", 1000), 590);
  assert.equal(calcDiscount(1005, "percent", 1000), 101); // 100.5 → 101
  assert.equal(calcDiscount(1004, "percent", 1000), 100); // 100.4 → 100
  assert.equal(calcDiscount(1006, "percent", 1000), 101); // 100.6 → 101
  assert.equal(calcDiscount(333, "percent", 3333), 111);  // 33.33% ของ 333 = 110.99 → 111
  assert.equal(calcDiscount(5900, "percent", 10000), 5900);
  assert.equal(calcDiscount(5900, "percent", 0), 0);
});

test("calcDiscount: ส่วนลดคงที่ไม่เกินยอดรวม และต้องเป็นจำนวนเต็มไม่ติดลบ", () => {
  assert.equal(calcDiscount(3000, "fixed", 5000), 3000);
  assert.equal(calcDiscount(8000, "fixed", 5000), 5000);
  assert.throws(() => calcDiscount(100.5, "fixed", 10), RangeError);
  assert.throws(() => calcDiscount(100, "fixed", -1), RangeError);
});

test("calcChange / quickCashAmounts", () => {
  assert.equal(calcChange(20000, 19700), 300);
  assert.equal(calcChange(100, 500), 0);
  assert.deepEqual(quickCashAmounts(19700), [19700, 20000, 50000, 100000]);
  assert.deepEqual(quickCashAmounts(10000), [10000, 50000, 100000]);
  assert.deepEqual(quickCashAmounts(5900), [5900, 6000, 10000, 50000, 100000]);
  assert.ok(quickCashAmounts(5900).every((n) => n >= 5900));
});

test("bpToPercentLabel", () => {
  assert.equal(bpToPercentLabel(1000), "10%");
  assert.equal(bpToPercentLabel(1250), "12.5%");
  assert.equal(bpToPercentLabel(333), "3.33%");
});
