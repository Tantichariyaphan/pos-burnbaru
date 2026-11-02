"use client";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Empty, cn, inputCls } from "@/components/ui";
import { formatBaht } from "@/lib/money";
import type { CartLine } from "@/lib/cart";
import type { Category, Product } from "@/types/db";

export function MenuPanel({
  categories, products, cart, salesEnabled, onAdd,
}: { categories: Category[]; products: Product[]; cart: CartLine[]; salesEnabled: boolean; onAdd: (p: Product) => void }) {
  const [cat, setCat] = useState<string>("all");
  const [q, setQ] = useState("");

  const qtyByProduct = useMemo(() => {
    const m = new Map<string, number>();
    cart.forEach((l) => m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty));
    return m;
  }, [cart]);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return products
      .filter((p) => catById.has(p.category_id))
      .filter((p) => cat === "all" || p.category_id === cat)
      .filter((p) => !term || p.name.toLowerCase().includes(term));
  }, [products, cat, q, catById]);

  return (
    <div className="glass flex h-full min-h-0 flex-col rounded-3xl">
      <div className="flex items-center gap-2 px-3 pt-3">
        <h2 className="text-base font-semibold">🍵 เมนู</h2>
        <div className="relative ml-auto w-full max-w-[220px]">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            className={cn(inputCls, "pl-9")} placeholder="ค้นหาเมนู" value={q} onChange={(e) => setQ(e.target.value)}
            aria-label="ค้นหาเมนู" enterKeyHint="search"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-3 py-2.5" role="tablist" aria-label="หมวดหมู่">
        {[{ id: "all", name: "ทั้งหมด", emoji: null as string | null }, ...categories].map((c) => (
          <button
            key={c.id} role="tab" aria-selected={cat === c.id} onClick={() => setCat(c.id)}
            className={cn(
              "min-h-11 rounded-full border px-4 text-sm font-medium",
              cat === c.id ? "border-matcha-700 bg-matcha-700 text-white" : "border-stone-300 bg-white/80 text-stone-700 active:bg-stone-100",
            )}
          >
            {c.emoji ? `${c.emoji} ` : ""}{c.name}
          </button>
        ))}
      </div>

      <div className="scroll-y min-h-0 flex-1 px-3 pb-3">
        {!salesEnabled && (
          <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            ยังไม่เปิดรับชำระเงิน — เจ้าของร้านต้องยืนยันราคาเมนูแล้วเปิดการขายในหน้า “ตั้งค่า”
          </div>
        )}
        {visible.length === 0 ? (
          <Empty>{products.length === 0 ? "ยังไม่มีสินค้า — เพิ่มได้ที่หน้า “สินค้า”" : "ไม่พบเมนูที่ค้นหา"}</Empty>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(138px,1fr))] gap-2.5">
            {visible.map((p) => {
              const noPrice = p.price_satang === null;
              const soldOut = !p.is_available;
              const disabled = noPrice || soldOut;
              const n = qtyByProduct.get(p.id) ?? 0;
              return (
                <button
                  key={p.id} disabled={disabled} onClick={() => onAdd(p)}
                  aria-label={`${p.name} ${noPrice ? "ยังไม่ตั้งราคา" : formatBaht(p.price_satang!)}`}
                  className={cn(
                    "relative flex min-h-[116px] flex-col items-center justify-center gap-1 rounded-2xl border bg-white/85 p-2 text-center transition-transform",
                    disabled ? "border-stone-200 opacity-55" : "border-stone-200 active:scale-[0.97] active:bg-matcha-50",
                    n > 0 && "border-matcha-500 ring-2 ring-matcha-200",
                  )}
                >
                  <span className="text-4xl leading-none">{p.emoji ?? "🍽️"}</span>
                  <span className="line-clamp-2 text-[15px] font-medium leading-tight">{p.name}</span>
                  <span className="tnum text-sm font-semibold text-matcha-700">
                    {noPrice ? <span className="text-xs font-normal text-unpaid">ยังไม่ตั้งราคา</span> : formatBaht(p.price_satang!)}
                  </span>
                  {soldOut && <span className="absolute right-1.5 top-1.5 rounded-full bg-stone-700 px-2 py-0.5 text-[11px] text-white">หมด</span>}
                  {n > 0 && (
                    <span className="absolute left-1.5 top-1.5 grid min-w-6 place-items-center rounded-full bg-matcha-700 px-1.5 text-xs font-semibold text-white">{n}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
