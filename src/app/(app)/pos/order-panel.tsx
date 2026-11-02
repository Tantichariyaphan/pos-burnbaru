"use client";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, Button, Empty, cn } from "@/components/ui";
import { bpToPercentLabel, formatBaht } from "@/lib/money";
import { lineTotal, lineUnitTotal, type CartAddon, type CartDiscount, type CartLine, type CartTotals } from "@/lib/cart";
import { formatOrderNo } from "@/lib/order-status";
import type { Addon, Discount, ProductAddon } from "@/types/db";

export function OrderPanel({
  orderNo, cart, totals, discount, discounts, addons, productAddons, canCheckout, blockedReason,
  onQty, onRemove, onToggleAddon, onDiscount, onCancel, onCheckout,
}: {
  orderNo: number; cart: CartLine[]; totals: CartTotals; discount: CartDiscount | null; discounts: Discount[];
  addons: Addon[]; productAddons: ProductAddon[]; canCheckout: boolean; blockedReason: string | null;
  onQty: (key: string, qty: number) => void; onRemove: (key: string) => void;
  onToggleAddon: (key: string, a: CartAddon) => void; onDiscount: (id: string | null) => void;
  onCancel: () => void; onCheckout: () => void;
}) {
  const [openAddons, setOpenAddons] = useState<string | null>(null);
  const [discOpen, setDiscOpen] = useState(false);
  const addonsFor = (productId: string) => {
    const ids = new Set(productAddons.filter((pa) => pa.product_id === productId).map((pa) => pa.addon_id));
    return addons.filter((a) => ids.has(a.id));
  };

  return (
    <div className="glass flex h-full min-h-0 flex-col rounded-3xl">
      <div className="flex items-center gap-2 px-3 pt-3">
        <h2 className="text-base font-semibold">🧾 ออเดอร์ปัจจุบัน</h2>
        <span className="tnum text-base font-semibold text-stone-700">{formatOrderNo(orderNo)}</span>
        <span className="ml-auto"><Badge tone="unpaid">ยังไม่ชำระ</Badge></span>
      </div>

      <div className="scroll-y min-h-0 flex-1 px-3 py-2">
        {cart.length === 0 ? (
          <Empty>แตะเมนูทางซ้ายเพื่อเพิ่มรายการ</Empty>
        ) : (
          <ul className="space-y-2">
            {cart.map((l) => {
              const opts = addonsFor(l.productId);
              return (
                <li key={l.key} className="rounded-2xl border border-stone-200 bg-white/85 p-2.5">
                  <div className="flex items-start gap-2">
                    <span className="text-2xl leading-none">{l.emoji ?? "🍽️"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium leading-tight">{l.name}</div>
                      <div className="tnum text-xs text-stone-500">{formatBaht(lineUnitTotal(l))} / ชิ้น</div>
                      {l.addons.length > 0 && <div className="text-xs text-matcha-700">+ {l.addons.map((a) => a.name).join(", ")}</div>}
                    </div>
                    <button onClick={() => onRemove(l.key)} aria-label={`ลบ ${l.name}`} className="-mr-1 -mt-1 grid size-11 place-items-center rounded-full text-stone-400 active:bg-rose-50 active:text-refund">
                      <Icon name="trash" size={20} />
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex items-center rounded-xl border border-stone-300 bg-white">
                      <button onClick={() => onQty(l.key, l.qty - 1)} aria-label="ลดจำนวน" className="grid size-11 place-items-center rounded-l-xl active:bg-stone-200"><Icon name="minus" size={20} /></button>
                      <span className="tnum w-9 text-center text-lg font-semibold" aria-live="polite">{l.qty}</span>
                      <button onClick={() => onQty(l.key, l.qty + 1)} aria-label="เพิ่มจำนวน" className="grid size-11 place-items-center rounded-r-xl active:bg-stone-200"><Icon name="plus" size={20} /></button>
                    </div>
                    {opts.length > 0 && (
                      <button
                        onClick={() => setOpenAddons(openAddons === l.key ? null : l.key)}
                        className="min-h-11 rounded-xl px-2 text-sm text-matcha-700 active:bg-matcha-50"
                      >
                        ตัวเลือกเสริม
                      </button>
                    )}
                    <span className="tnum ml-auto text-lg font-semibold">{formatBaht(lineTotal(l))}</span>
                  </div>
                  {openAddons === l.key && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {opts.map((a) => {
                        const on = l.addons.some((x) => x.id === a.id);
                        return (
                          <button
                            key={a.id} aria-pressed={on}
                            onClick={() => {
                              onToggleAddon(l.key, { id: a.id, name: a.name, priceSatang: a.price_satang });
                              setOpenAddons(null);
                            }}
                            className={cn("min-h-11 rounded-full border px-3 text-sm", on ? "border-matcha-700 bg-matcha-700 text-white" : "border-stone-300 bg-white")}
                          >
                            {a.name} {a.price_satang > 0 && <span className="tnum">+{formatBaht(a.price_satang)}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* สรุปยอด + ปุ่มคิดเงิน */}
      <div className="border-t border-stone-200/70 px-3 pb-3 pt-2">
        {discounts.length > 0 && cart.length > 0 && (
          <div className="mb-1">
            {discount ? (
              <div className="flex items-center justify-between rounded-xl bg-green-50 px-3 py-1.5 text-sm">
                <span>ส่วนลด: <b>{discount.name}</b> {discount.kind === "percent" ? `(${bpToPercentLabel(discount.value)})` : ""}</span>
                <button onClick={() => onDiscount(null)} className="min-h-9 px-2 text-refund">เอาออก</button>
              </div>
            ) : (
              <button onClick={() => setDiscOpen((v) => !v)} className="min-h-11 w-full rounded-xl border border-dashed border-stone-300 text-sm text-stone-600 active:bg-stone-100">
                + ใส่ส่วนลด
              </button>
            )}
            {discOpen && !discount && (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {discounts.map((d) => (
                  <button key={d.id} onClick={() => { onDiscount(d.id); setDiscOpen(false); }} className="min-h-11 rounded-full border border-stone-300 bg-white px-3 text-sm active:bg-stone-100">
                    {d.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <dl className="space-y-0.5 text-sm">
          {totals.discount > 0 && (
            <>
              <div className="flex justify-between text-stone-600"><dt>รวมรายการ</dt><dd className="tnum">{formatBaht(totals.subtotal)}</dd></div>
              <div className="flex justify-between text-paid"><dt>ส่วนลด</dt><dd className="tnum">−{formatBaht(totals.discount)}</dd></div>
            </>
          )}
          <div className="flex items-baseline justify-between pt-1">
            <dt className="font-semibold">ยอดที่ต้องชำระ</dt>
            <dd className="tnum text-3xl font-bold text-matcha-800" data-testid="total">{formatBaht(totals.total)}</dd>
          </div>
        </dl>
        {blockedReason && cart.length > 0 && <p className="mt-1 text-xs text-unpaid">{blockedReason} — คิดเงินไม่ได้</p>}
        <div className="mt-2 flex gap-2">
          <Button variant="danger" size="lg" className="!px-4" disabled={cart.length === 0} onClick={onCancel} aria-label="ยกเลิกออเดอร์">
            <Icon name="x" size={22} />
          </Button>
          <Button variant="primary" size="lg" className="flex-1" disabled={cart.length === 0 || totals.total <= 0 || !canCheckout} onClick={onCheckout}>
            คิดเงิน {cart.length > 0 && <span className="tnum">{formatBaht(totals.total)}</span>}
          </Button>
        </div>
      </div>
    </div>
  );
}
