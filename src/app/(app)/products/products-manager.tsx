"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { moveItem, saveAddon, saveCategory, saveDiscount, saveProduct } from "@/app/actions/catalog";
import { Icon } from "@/components/icons";
import { Badge, Button, Empty, Field, Modal, Notice, cn, inputCls } from "@/components/ui";
import { bpToPercentLabel, formatBaht } from "@/lib/money";
import { satangToInput } from "@/lib/queries";
import type { ActionResult } from "@/lib/actions";
import type { Addon, Category, Discount, Product, ProductAddon } from "@/types/db";

type Tab = "products" | "categories" | "addons" | "discounts";

function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<ActionResult>, onOk: () => void) => {
    setBusy(true); setError(null);
    try {
      const r = await fn();
      if (!r.ok) return setError(r.error);
      onOk(); router.refresh();
    } catch { setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่"); } finally { setBusy(false); }
  };
  return { busy, error, setError, run, router };
}

function Mover({ table, id }: { table: "categories" | "products" | "addons"; id: string }) {
  const { run, busy } = useSave();
  return (
    <span className="inline-flex">
      <button aria-label="เลื่อนขึ้น" disabled={busy} onClick={() => run(() => moveItem({ table, id, dir: "up" }), () => {})} className="grid size-11 place-items-center rounded-lg active:bg-stone-200"><Icon name="up" size={18} /></button>
      <button aria-label="เลื่อนลง" disabled={busy} onClick={() => run(() => moveItem({ table, id, dir: "down" }), () => {})} className="grid size-11 place-items-center rounded-lg active:bg-stone-200"><Icon name="down" size={18} /></button>
    </span>
  );
}

const Check = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-6 accent-matcha-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>
);

export function ProductsManager(props: {
  categories: Category[]; products: Product[]; addons: Addon[]; productAddons: ProductAddon[]; discounts: Discount[]; salesEnabled: boolean;
}) {
  const [tab, setTab] = useState<Tab>("products");
  const missing = props.products.filter((p) => p.is_active && p.price_satang === null);
  return (
    <div className="space-y-4">
      {missing.length > 0 && (
        <Notice tone="warn">
          มี {missing.length} เมนูที่เปิดใช้งานแต่ยังไม่ตั้งราคา ({missing.slice(0, 6).map((m) => m.name).join(", ")}{missing.length > 6 ? "…" : ""}) — ยืนยันราคาที่ถูกต้องก่อน แล้วเจ้าของร้านจึงเปิดการขายได้ที่หน้า “ตั้งค่า”
          {props.salesEnabled && " (ขณะนี้เปิดขายอยู่ เมนูที่ไม่มีราคาจะขายไม่ได้)"}
        </Notice>
      )}
      <div className="flex flex-wrap gap-2" role="tablist">
        {([["products", "สินค้า"], ["categories", "หมวดหมู่"], ["addons", "ตัวเลือกเสริม"], ["discounts", "ส่วนลด"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("min-h-11 rounded-full border px-4 font-medium", tab === k ? "border-matcha-700 bg-matcha-700 text-white" : "border-stone-300 bg-white/80")}>{l}</button>
        ))}
      </div>
      {tab === "products" && <ProductsTab {...props} />}
      {tab === "categories" && <CategoriesTab categories={props.categories} />}
      {tab === "addons" && <AddonsTab addons={props.addons} products={props.products} productAddons={props.productAddons} />}
      {tab === "discounts" && <DiscountsTab discounts={props.discounts} />}
    </div>
  );
}

function ProductsTab({ categories, products }: { categories: Category[]; products: Product[] }) {
  const [edit, setEdit] = useState<Partial<Product> | null>(null);
  const [priceText, setPriceText] = useState("");
  const { busy, error, setError, run } = useSave();
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? "-";
  const open = (p: Partial<Product>) => { setEdit(p); setPriceText(p.price_satang != null ? satangToInput(p.price_satang) : ""); setError(null); };

  return (
    <div className="space-y-3">
      <Button variant="primary" onClick={() => open({ category_id: categories[0]?.id, is_active: true, is_available: true, emoji: "" })} disabled={categories.length === 0}>
        <Icon name="plus" size={18} /> เพิ่มสินค้า
      </Button>
      {categories.length === 0 && <Notice tone="info">เพิ่มหมวดหมู่ก่อน</Notice>}
      {categories.map((c) => {
        const list = products.filter((p) => p.category_id === c.id);
        return (
          <section key={c.id} className="glass rounded-2xl p-3">
            <h2 className="mb-1 font-semibold">{c.emoji} {c.name} {!c.active && <Badge tone="neutral">ปิดใช้งาน</Badge>}</h2>
            {list.length === 0 ? <p className="py-2 text-sm text-stone-500">ยังไม่มีสินค้าในหมวดนี้</p> : (
              <ul className="divide-y divide-stone-200/70">
                {list.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-1">
                    <span className="w-8 text-center text-2xl">{p.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="flex flex-wrap gap-1 text-xs">
                        {p.price_satang === null ? <Badge tone="unpaid">ยังไม่ตั้งราคา</Badge> : <span className="tnum text-stone-600">{formatBaht(p.price_satang)}</span>}
                        {!p.is_active && <Badge tone="neutral">ปิดใช้งาน</Badge>}
                        {p.is_active && !p.is_available && <Badge tone="refund">หมด</Badge>}
                      </div>
                    </div>
                    <Mover table="products" id={p.id} />
                    <Button size="sm" onClick={() => open(p)}>แก้ไข</Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "แก้ไขสินค้า" : "เพิ่มสินค้า"}
        footer={<div className="flex items-center justify-end gap-2">
          {error && <div className="mr-auto flex-1"><Notice tone="error">{error}</Notice></div>}
          <Button onClick={() => setEdit(null)}>ยกเลิก</Button>
          <Button variant="primary" disabled={busy || !edit?.name?.trim()} onClick={() => edit && run(() => saveProduct({
            id: edit.id, categoryId: edit.category_id!, name: edit.name ?? "", emoji: edit.emoji ?? "", priceBaht: priceText,
            isActive: edit.is_active ?? true, isAvailable: edit.is_available ?? true,
          }), () => setEdit(null))}>บันทึก</Button>
        </div>}>
        {edit && (
          <div className="space-y-3">
            <Field label="หมวดหมู่">
              <select className={inputCls} value={edit.category_id} onChange={(e) => setEdit({ ...edit, category_id: e.target.value })}>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-[96px_1fr] gap-3">
              <Field label="อีโมจิ"><input className={cn(inputCls, "text-center text-2xl")} value={edit.emoji ?? ""} maxLength={8} onChange={(e) => setEdit({ ...edit, emoji: e.target.value })} /></Field>
              <Field label="ชื่อสินค้า"><input className={inputCls} value={edit.name ?? ""} maxLength={100} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            </div>
            <Field label="ราคา (บาท)" hint="เว้นว่าง = ยังไม่ตั้งราคา (ขายไม่ได้) — ตัวอย่าง 59 หรือ 59.50">
              <input className={inputCls} inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value)} />
            </Field>
            <Check label="เปิดใช้งาน (แสดงในหน้า POS)" checked={edit.is_active ?? true} onChange={(v) => setEdit({ ...edit, is_active: v })} />
            <Check label="มีของพร้อมขาย (ปิด = ขึ้นว่า “หมด”)" checked={edit.is_available ?? true} onChange={(v) => setEdit({ ...edit, is_available: v })} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function CategoriesTab({ categories }: { categories: Category[] }) {
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  const { busy, error, setError, run } = useSave();
  return (
    <div className="space-y-3">
      <Button variant="primary" onClick={() => { setEdit({ active: true, emoji: "" }); setError(null); }}><Icon name="plus" size={18} /> เพิ่มหมวดหมู่</Button>
      {categories.length === 0 ? <Empty>ยังไม่มีหมวดหมู่</Empty> : (
        <ul className="glass divide-y divide-stone-200/70 rounded-2xl px-3">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-1">
              <span className="w-8 text-center text-2xl">{c.emoji}</span>
              <span className="flex-1 font-medium">{c.name} {!c.active && <Badge tone="neutral">ปิดใช้งาน</Badge>}</span>
              <Mover table="categories" id={c.id} />
              <Button size="sm" onClick={() => { setEdit(c); setError(null); }}>แก้ไข</Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "แก้ไขหมวดหมู่" : "เพิ่มหมวดหมู่"}
        footer={<div className="flex items-center justify-end gap-2">
          {error && <div className="mr-auto flex-1"><Notice tone="error">{error}</Notice></div>}
          <Button onClick={() => setEdit(null)}>ยกเลิก</Button>
          <Button variant="primary" disabled={busy || !edit?.name?.trim()} onClick={() => edit && run(() => saveCategory({ id: edit.id, name: edit.name ?? "", emoji: edit.emoji ?? "", active: edit.active ?? true }), () => setEdit(null))}>บันทึก</Button>
        </div>}>
        {edit && (
          <div className="space-y-3">
            <div className="grid grid-cols-[96px_1fr] gap-3">
              <Field label="อีโมจิ"><input className={cn(inputCls, "text-center text-2xl")} value={edit.emoji ?? ""} maxLength={8} onChange={(e) => setEdit({ ...edit, emoji: e.target.value })} /></Field>
              <Field label="ชื่อหมวดหมู่"><input className={inputCls} value={edit.name ?? ""} maxLength={100} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            </div>
            <Check label="เปิดใช้งาน" checked={edit.active ?? true} onChange={(v) => setEdit({ ...edit, active: v })} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function AddonsTab({ addons, products, productAddons }: { addons: Addon[]; products: Product[]; productAddons: ProductAddon[] }) {
  const [edit, setEdit] = useState<(Partial<Addon> & { productIds: string[]; priceText: string }) | null>(null);
  const { busy, error, setError, run } = useSave();
  const linked = (id: string) => productAddons.filter((x) => x.addon_id === id).map((x) => x.product_id);
  return (
    <div className="space-y-3">
      <Button variant="primary" onClick={() => { setEdit({ active: true, productIds: [], priceText: "" }); setError(null); }}><Icon name="plus" size={18} /> เพิ่มตัวเลือกเสริม</Button>
      {addons.length === 0 ? <Empty>ยังไม่มีตัวเลือกเสริม (เช่น เพิ่มช็อต, ท็อปปิ้ง)</Empty> : (
        <ul className="glass divide-y divide-stone-200/70 rounded-2xl px-3">
          {addons.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-1">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{a.name} {!a.active && <Badge tone="neutral">ปิดใช้งาน</Badge>}</div>
                <div className="text-xs text-stone-500"><span className="tnum">+{formatBaht(a.price_satang)}</span> · ใช้กับ {linked(a.id).length} สินค้า</div>
              </div>
              <Mover table="addons" id={a.id} />
              <Button size="sm" onClick={() => { setEdit({ ...a, productIds: linked(a.id), priceText: satangToInput(a.price_satang) }); setError(null); }}>แก้ไข</Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "แก้ไขตัวเลือกเสริม" : "เพิ่มตัวเลือกเสริม"}
        footer={<div className="flex items-center justify-end gap-2">
          {error && <div className="mr-auto flex-1"><Notice tone="error">{error}</Notice></div>}
          <Button onClick={() => setEdit(null)}>ยกเลิก</Button>
          <Button variant="primary" disabled={busy || !edit?.name?.trim()} onClick={() => edit && run(() => saveAddon({ id: edit.id, name: edit.name ?? "", priceBaht: edit.priceText, active: edit.active ?? true, productIds: edit.productIds }), () => setEdit(null))}>บันทึก</Button>
        </div>}>
        {edit && (
          <div className="space-y-3">
            <Field label="ชื่อ"><input className={inputCls} value={edit.name ?? ""} maxLength={100} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="ราคาที่เพิ่ม (บาท)"><input className={inputCls} inputMode="decimal" value={edit.priceText} onChange={(e) => setEdit({ ...edit, priceText: e.target.value })} /></Field>
            <Check label="เปิดใช้งาน" checked={edit.active ?? true} onChange={(v) => setEdit({ ...edit, active: v })} />
            <div>
              <div className="mb-1 text-sm font-medium">ใช้กับสินค้า</div>
              <div className="grid gap-x-4 sm:grid-cols-2">
                {products.map((p) => (
                  <Check key={p.id} label={`${p.emoji ?? ""} ${p.name}`} checked={edit.productIds.includes(p.id)}
                    onChange={(v) => setEdit({ ...edit, productIds: v ? [...edit.productIds, p.id] : edit.productIds.filter((x) => x !== p.id) })} />
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function DiscountsTab({ discounts }: { discounts: Discount[] }) {
  const [edit, setEdit] = useState<(Partial<Discount> & { amountText: string }) | null>(null);
  const { busy, error, setError, run } = useSave();
  return (
    <div className="space-y-3">
      <Button variant="primary" onClick={() => { setEdit({ kind: "percent", active: true, amountText: "" }); setError(null); }}><Icon name="plus" size={18} /> เพิ่มส่วนลด</Button>
      {discounts.length === 0 ? <Empty>ยังไม่มีส่วนลด</Empty> : (
        <ul className="glass divide-y divide-stone-200/70 rounded-2xl px-3">
          {discounts.map((d) => (
            <li key={d.id} className="flex items-center gap-2 py-2">
              <div className="flex-1">
                <div className="font-medium">{d.name} {!d.active && <Badge tone="neutral">ปิดใช้งาน</Badge>}</div>
                <div className="tnum text-xs text-stone-500">{d.kind === "percent" ? bpToPercentLabel(d.value) : formatBaht(d.value)}</div>
              </div>
              <Button size="sm" onClick={() => { setEdit({ ...d, amountText: d.kind === "percent" ? String(d.value / 100) : satangToInput(d.value) }); setError(null); }}>แก้ไข</Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "แก้ไขส่วนลด" : "เพิ่มส่วนลด"}
        footer={<div className="flex items-center justify-end gap-2">
          {error && <div className="mr-auto flex-1"><Notice tone="error">{error}</Notice></div>}
          <Button onClick={() => setEdit(null)}>ยกเลิก</Button>
          <Button variant="primary" disabled={busy || !edit?.name?.trim()} onClick={() => edit && run(() => saveDiscount({ id: edit.id, name: edit.name ?? "", kind: edit.kind ?? "percent", amount: edit.amountText, active: edit.active ?? true }), () => setEdit(null))}>บันทึก</Button>
        </div>}>
        {edit && (
          <div className="space-y-3">
            <Field label="ชื่อส่วนลด"><input className={inputCls} value={edit.name ?? ""} maxLength={100} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="ประเภท">
              <select className={inputCls} value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as "percent" | "fixed" })}>
                <option value="percent">เปอร์เซ็นต์ (%)</option><option value="fixed">จำนวนเงิน (บาท)</option>
              </select>
            </Field>
            <Field label={edit.kind === "percent" ? "เปอร์เซ็นต์ (เช่น 10 หรือ 12.5)" : "จำนวนเงิน (บาท)"}>
              <input className={inputCls} inputMode="decimal" value={edit.amountText} onChange={(e) => setEdit({ ...edit, amountText: e.target.value })} />
            </Field>
            <Check label="เปิดใช้งาน" checked={edit.active ?? true} onChange={(v) => setEdit({ ...edit, active: v })} />
          </div>
        )}
      </Modal>
    </div>
  );
}
