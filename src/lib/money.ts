/**
 * เงินทั้งหมดในระบบเป็น "สตางค์" (จำนวนเต็ม) — 1 บาท = 100 สตางค์
 * ห้ามใช้ float คำนวณเงิน การแปลงข้อความ → สตางค์ทำจากสตริงโดยตรง
 */

/** ยอดสูงสุดต่อรายการที่ยอมรับ (฿1,000,000) ให้ตรงกับ constraint ในฐานข้อมูล */
export const MAX_SATANG = 100_000_000;

function group(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** แสดงเป็นบาท: 5900 → "฿59", 5950 → "฿59.50", 123456 → "฿1,234.56" */
export function formatBaht(satang: number, opts: { symbol?: boolean; decimals?: "auto" | "always" } = {}): string {
  const { symbol = true, decimals = "auto" } = opts;
  const neg = satang < 0;
  const abs = Math.abs(Math.trunc(satang));
  const baht = Math.trunc(abs / 100);
  const frac = abs % 100;
  let body = group(baht);
  if (frac !== 0 || decimals === "always") body += "." + String(frac).padStart(2, "0");
  return (neg ? "-" : "") + (symbol ? "฿" : "") + body;
}

/**
 * แปลงข้อความที่คนพิมพ์ ("59", "59.5", "1,250.75", "฿40") เป็นสตางค์
 * คืน null ถ้าคลุมเครือ: ติดลบ, ทศนิยมเกิน 2 ตำแหน่ง, คอมมาผิดที่, ไม่ใช่ตัวเลข, เกิน MAX_SATANG
 */
export function bahtToSatang(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (s.startsWith("฿")) s = s.slice(1).trim();
  if (s === "") return null;
  if (s.includes(",")) {
    if (!/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) return null;
    s = s.replace(/,/g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const satang = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(satang) || satang > MAX_SATANG) return null;
  return satang;
}

export type DiscountKind = "percent" | "fixed";

/**
 * ส่วนลด — ต้องตรงกับ public.calc_discount() ในฐานข้อมูลทุกประการ
 *  percent: value เป็น basis points (1000 = 10%) ปัดเศษครึ่งขึ้น ด้วยเลขจำนวนเต็ม
 *  fixed:   value เป็นสตางค์ และไม่เกินยอดรวม
 */
export function calcDiscount(subtotal: number, kind: DiscountKind, value: number): number {
  if (!Number.isInteger(subtotal) || !Number.isInteger(value) || subtotal < 0 || value < 0) {
    throw new RangeError("subtotal และ value ต้องเป็นจำนวนเต็มสตางค์ที่ไม่ติดลบ");
  }
  if (kind === "percent") return Math.floor((subtotal * value + 5000) / 10000);
  return Math.min(value, subtotal);
}

/** เงินทอน = รับมา − ยอด (ติดลบไม่ได้) */
export function calcChange(received: number, total: number): number {
  return Math.max(0, received - total);
}

/** ปุ่มลัดรับเงินสด: ยอดพอดี + ปัดขึ้นเป็นแบงก์ 20/50/100/500/1000 (ไม่ซ้ำ) */
export function quickCashAmounts(total: number): number[] {
  const out = new Set<number>([total]);
  for (const note of [2000, 5000, 10000, 50000, 100000]) {
    out.add(Math.ceil(total / note) * note);
  }
  return [...out].sort((a, b) => a - b).slice(0, 5);
}

/** แสดงเปอร์เซ็นต์จาก basis points: 1000 → "10%", 1250 → "12.5%" */
export function bpToPercentLabel(bp: number): string {
  const p = bp / 100;
  return (Number.isInteger(p) ? String(p) : p.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")) + "%";
}
