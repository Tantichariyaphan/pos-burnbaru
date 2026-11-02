"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { adjustStock, deleteRecipe, saveInventoryItem, saveRecipe } from "@/app/actions/inventory";
import { Icon } from "@/components/icons";
import { Badge, Button, Empty, Field, Modal, Notice, cn, inputCls } from "@/components/ui";
import { formatDateTime } from "@/lib/time";
import type { ActionResult } from "@/lib/actions";
import type { InventoryItem, Product, StockMovement } from "@/types/db";

type Recipe = { product_id: string; inventory_item_id: string; qty_per_unit: number };
const KIND: Record<string, string> = { receive: "รับของ", sale: "ขาย", waste: "ของเสีย", adjust: "ปรับยอด" };
const num = (n: number) => Number(n).toLocaleString("th-TH", { maximumFractionDigits: 3 });

export function InventoryManager({ items, recipes, products, movements }: { items: InventoryItem[]; recipes: Recipe[]; products: Product[]; movements: StockMovement[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itemEdit, setItemEdit] = useState<Partial<InventoryItem> & { lowText: string } | null>(null);
  const [adj, setAdj] = useState<{ item: InventoryItem; kind: "receive" | "waste" | "adjust"; qty: string; note: string } | null>(null);
  const [recipeItem, setRecipeItem] = useState<InventoryItem | null>(null);
  const [rp, setRp] = useState({ productId: "", qty: "" });

  const run = async (fn: () => Promise<ActionResult>, ok: () => void) => {
    setBusy(true); setError(null);
    try { const r = await fn(); if (!r.ok) return setError(r.error); ok(); router.refresh(); }
    catch { setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่"); } finally { setBusy(false); }
  };
  const nameOf = (id: string) => items.find((i) => i.id === id)?.name ?? "-";
  const toNum = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? NaN : Number(s));

  return (
    <div className="space-y-4">
      <Button variant="primary" onClick={() => { setItemEdit({ unit: "หน่วย", active: true, lowText: "0" }); setError(null); }}><Icon name="plus" size={18} /> เพิ่มวัตถุดิบ</Button>
      {items.length === 0 ? <Empty>ยังไม่มีวัตถุดิบ</Empty> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {items.map((i) => {
            const low = i.qty_on_hand <= i.low_stock_level && i.low_stock_level > 0;
            const rs = recipes.filter((r) => r.inventory_item_id === i.id);
            return (
              <li key={i.id} className="glass rounded-2xl p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{i.name} {!i.active && <Badge tone="neutral">ปิดใช้งาน</Badge>} {low && <Badge tone="unpaid">ใกล้หมด</Badge>}</div>
                    <div className={cn("tnum text-2xl font-bold", i.qty_on_hand < 0 && "text-refund")}>{num(i.qty_on_hand)} <span className="text-sm font-normal text-stone-500">{i.unit}</span></div>
                    <div className="text-xs text-stone-500">แจ้งเตือนเมื่อเหลือ ≤ {num(i.low_stock_level)}</div>
                  </div>
                  <Button size="sm" onClick={() => { setItemEdit({ ...i, lowText: String(i.low_stock_level) }); setError(null); }}>แก้ไข</Button>
                </div>
                {rs.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-stone-600">
                    {rs.map((r) => (
                      <li key={r.product_id} className="flex items-center justify-between">
                        <span>{products.find((p) => p.id === r.product_id)?.name} ใช้ {num(r.qty_per_unit)} {i.unit}/ชิ้น</span>
                        <button className="min-h-9 px-2 text-refund" onClick={() => run(() => deleteRecipe({ productId: r.product_id, itemId: i.id }), () => {})}>ลบสูตร</button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => { setAdj({ item: i, kind: "receive", qty: "", note: "" }); setError(null); }}>รับของ / ปรับยอด</Button>
                  <Button size="sm" onClick={() => { setRecipeItem(i); setRp({ productId: products[0]?.id ?? "", qty: "" }); setError(null); }}>ผูกสูตรเมนู</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="glass rounded-2xl p-3">
        <h2 className="mb-2 font-semibold">ความเคลื่อนไหวล่าสุด</h2>
        {movements.length === 0 ? <p className="text-sm text-stone-500">ยังไม่มีรายการ</p> : (
          <ul className="divide-y divide-stone-200/70 text-sm">
            {movements.map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-1.5">
                <span className="tnum w-36 shrink-0 text-xs text-stone-500">{formatDateTime(m.created_at)}</span>
                <span className="flex-1">{nameOf(m.inventory_item_id)} · {KIND[m.kind] ?? m.kind}{m.note ? ` (${m.note})` : ""}</span>
                <span className={cn("tnum font-semibold", m.qty_delta < 0 ? "text-refund" : "text-paid")}>{m.qty_delta > 0 ? "+" : ""}{num(m.qty_delta)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal open={!!itemEdit} onClose={() => setItemEdit(null)} title={itemEdit?.id ? "แก้ไขวัตถุดิบ" : "เพิ่มวัตถุดิบ"}
        footer={<div className="flex items-center justify-end gap-2">{error && <div className="mr-auto flex-1"><Notice tone="error">{error}</Notice></div>}
          <Button onClick={() => setItemEdit(null)}>ยกเลิก</Button>
          <Button variant="primary" disabled={busy || !itemEdit?.name?.trim() || Number.isNaN(toNum(itemEdit?.lowText ?? ""))}
            onClick={() => itemEdit && run(() => saveInventoryItem({ id: itemEdit.id, name: itemEdit.name ?? "", unit: itemEdit.unit ?? "หน่วย", lowStock: toNum(itemEdit.lowText), active: itemEdit.active ?? true }), () => setItemEdit(null))}>บันทึก</Button></div>}>
        {itemEdit && <div className="space-y-3">
          <Field label="ชื่อวัตถุดิบ"><input className={inputCls} value={itemEdit.name ?? ""} onChange={(e) => setItemEdit({ ...itemEdit, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="หน่วย"><input className={inputCls} value={itemEdit.unit ?? ""} onChange={(e) => setItemEdit({ ...itemEdit, unit: e.target.value })} /></Field>
            <Field label="แจ้งเตือนเมื่อเหลือ ≤"><input className={inputCls} inputMode="decimal" value={itemEdit.lowText} onChange={(e) => setItemEdit({ ...itemEdit, lowText: e.target.value })} /></Field>
          </div>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-6 accent-matcha-700" checked={itemEdit.active ?? true} onChange={(e) => setItemEdit({ ...itemEdit, active: e.target.checked })} />เปิดใช้งาน</label>
          <p className="text-xs text-stone-500">ยอดคงเหลือแก้ผ่าน “รับของ / ปรับยอด” เท่านั้น เพื่อให้มีประวัติทุกครั้ง</p>
        </div>}
      </Modal>

      <Modal open={!!adj} onClose={() => setAdj(null)} title={adj ? `ปรับสต็อก: ${adj.item.name}` : ""}
        footer={<div className="flex items-center justify-end gap-2">{error && <div className="mr-auto flex-1"><Notice tone="error">{error}</Notice></div>}
          <Button onClick={() => setAdj(null)}>ยกเลิก</Button>
          <Button variant="primary" disabled={busy || !adj || Number.isNaN(toNum(adj.qty)) || toNum(adj.qty) === 0}
            onClick={() => adj && run(() => adjustStock({ itemId: adj.item.id, kind: adj.kind, qty: toNum(adj.qty), note: adj.note || undefined }), () => setAdj(null))}>บันทึก</Button></div>}>
        {adj && <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {([["receive", "รับของเข้า"], ["waste", "ของเสีย"], ["adjust", "ปรับยอด ±"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setAdj({ ...adj, kind: k })} className={cn("min-h-12 rounded-xl border text-sm font-medium", adj.kind === k ? "border-matcha-700 bg-matcha-700 text-white" : "border-stone-300 bg-white")}>{l}</button>
            ))}
          </div>
          <Field label={`จำนวน (${adj.item.unit})`} hint={adj.kind === "adjust" ? "ใส่ค่าบวกเพื่อเพิ่ม ค่าลบเพื่อลด" : "ใส่จำนวนเป็นบวก"}>
            <input className={inputCls} inputMode="decimal" value={adj.qty} onChange={(e) => setAdj({ ...adj, qty: e.target.value })} />
          </Field>
          <Field label="หมายเหตุ (ไม่บังคับ)"><input className={inputCls} value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></Field>
        </div>}
      </Modal>

      <Modal open={!!recipeItem} onClose={() => setRecipeItem(null)} title={recipeItem ? `สูตรตัดสต็อก: ${recipeItem.name}` : ""}
        footer={<div className="flex items-center justify-end gap-2">{error && <div className="mr-auto flex-1"><Notice tone="error">{error}</Notice></div>}
          <Button onClick={() => setRecipeItem(null)}>ยกเลิก</Button>
          <Button variant="primary" disabled={busy || !rp.productId || !(toNum(rp.qty) > 0)}
            onClick={() => recipeItem && run(() => saveRecipe({ productId: rp.productId, itemId: recipeItem.id, qtyPerUnit: toNum(rp.qty) }), () => setRecipeItem(null))}>บันทึก</Button></div>}>
        <div className="space-y-3">
          <Notice tone="info">เมื่อเปิดใช้สต็อก การขาย 1 ชิ้นของเมนูนี้จะตัดวัตถุดิบตามจำนวนที่ระบุ (ตัดครั้งเดียวตอนชำระเงิน)</Notice>
          <Field label="เมนู"><select className={inputCls} value={rp.productId} onChange={(e) => setRp({ ...rp, productId: e.target.value })}>{products.map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}</select></Field>
          <Field label={`ใช้ต่อ 1 ชิ้น (${recipeItem?.unit ?? ""})`}><input className={inputCls} inputMode="decimal" value={rp.qty} onChange={(e) => setRp({ ...rp, qty: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
