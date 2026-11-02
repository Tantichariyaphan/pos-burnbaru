import { calcDiscount, type DiscountKind } from "./money";

/** ตะกร้า (ฝั่งหน้าจอ) — ยังไม่ใช่ข้อมูลการเงิน ราคาจริงคำนวณใหม่ที่เซิร์ฟเวอร์ตอนชำระเงินเสมอ */

export const MAX_QTY = 99;

export interface CartAddon { id: string; name: string; priceSatang: number }

export interface CartLine {
  key: string;            // productId + addon ids (เรียงแล้ว) — ใช้รวมบรรทัดที่เหมือนกัน
  productId: string;
  name: string;
  emoji: string | null;
  unitPriceSatang: number;
  qty: number;
  addons: CartAddon[];
}

export interface CartProduct { id: string; name: string; emoji: string | null; priceSatang: number }

export interface CartDiscount { id: string; name: string; kind: DiscountKind; value: number }

export function lineKey(productId: string, addonIds: string[]): string {
  return [productId, ...[...addonIds].sort()].join("|");
}

/** แตะสินค้า 1 ครั้ง = +1 (บรรทัดที่ไม่มีตัวเลือกเสริม) */
export function addProduct(lines: CartLine[], p: CartProduct): CartLine[] {
  const key = lineKey(p.id, []);
  const i = lines.findIndex((l) => l.key === key);
  if (i >= 0) {
    return lines.map((l, idx) => (idx === i ? { ...l, qty: Math.min(MAX_QTY, l.qty + 1) } : l));
  }
  return [
    ...lines,
    { key, productId: p.id, name: p.name, emoji: p.emoji, unitPriceSatang: p.priceSatang, qty: 1, addons: [] },
  ];
}

export function setQty(lines: CartLine[], key: string, qty: number): CartLine[] {
  if (!Number.isFinite(qty) || qty <= 0) return lines.filter((l) => l.key !== key);
  const q = Math.min(MAX_QTY, Math.floor(qty));
  return lines.map((l) => (l.key === key ? { ...l, qty: q } : l));
}

export function removeLine(lines: CartLine[], key: string): CartLine[] {
  return lines.filter((l) => l.key !== key);
}

/** เปิด/ปิดตัวเลือกเสริมของบรรทัด — ถ้ากลายเป็นบรรทัดเดียวกับที่มีอยู่แล้วจะรวมจำนวนให้ */
export function toggleAddon(lines: CartLine[], key: string, addon: CartAddon): CartLine[] {
  const target = lines.find((l) => l.key === key);
  if (!target) return lines;
  const has = target.addons.some((a) => a.id === addon.id);
  const addons = has ? target.addons.filter((a) => a.id !== addon.id) : [...target.addons, addon];
  const newKey = lineKey(target.productId, addons.map((a) => a.id));
  const updated: CartLine = { ...target, key: newKey, addons };
  const others = lines.filter((l) => l.key !== key);
  const dup = others.find((l) => l.key === newKey);
  if (dup) {
    const merged = { ...dup, qty: Math.min(MAX_QTY, dup.qty + updated.qty) };
    // คงตำแหน่งของบรรทัดที่ถูกแก้
    return lines.flatMap((l) => (l.key === key ? [merged] : l.key === newKey ? [] : [l]));
  }
  return lines.map((l) => (l.key === key ? updated : l));
}

export function lineUnitTotal(l: CartLine): number {
  return l.unitPriceSatang + l.addons.reduce((s, a) => s + a.priceSatang, 0);
}
export function lineTotal(l: CartLine): number {
  return lineUnitTotal(l) * l.qty;
}

export interface CartTotals { subtotal: number; discount: number; total: number; itemCount: number }

export function cartTotals(lines: CartLine[], discount: CartDiscount | null): CartTotals {
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const d = discount ? calcDiscount(subtotal, discount.kind, discount.value) : 0;
  return {
    subtotal,
    discount: d,
    total: subtotal - d,
    itemCount: lines.reduce((s, l) => s + l.qty, 0),
  };
}

/** รูปแบบที่ส่งให้ checkout_order (ไม่ส่งราคา — เซิร์ฟเวอร์คำนวณเอง) */
export function toCheckoutItems(lines: CartLine[]) {
  return lines.map((l) => ({
    product_id: l.productId,
    quantity: l.qty,
    addon_ids: l.addons.map((a) => a.id),
  }));
}
