"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ORDER_SELECT } from "@/lib/queries";
import { bangkokToday, formatTime } from "@/lib/time";
import { cartTotals, type CartDiscount, type CartLine } from "@/lib/cart";
import { formatOrderNo } from "@/lib/order-status";
import { friendlyError } from "@/lib/errors";
import { Badge, Button, Modal, Notice, cn } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { Addon, Category, Customer, Discount, Order, Product, ProductAddon, Register, Settings, Shift } from "@/types/db";
import { MenuPanel } from "./menu-panel";
import { OrderPanel } from "./order-panel";
import { PaidPanel } from "./paid-panel";
import { CheckoutDialog } from "./checkout-dialog";
import { CloseShiftDialog, OpenShiftOverlay } from "./shift-dialogs";
import { addProduct } from "@/lib/cart";
import { setQty, removeLine, toggleAddon } from "@/lib/cart";

export interface PosProps {
  denied: boolean;
  loadError: string | null;
  employee: { id: string; name: string; role: string };
  register: Register | null;
  shift: Shift | null;
  categories: Category[];
  products: Product[];
  addons: Addon[];
  productAddons: ProductAddon[];
  discounts: Discount[];
  customers: Customer[];
  settings: Settings;
  initialOrders: Order[];
}

type MobileTab = "menu" | "order" | "paid";

export function PosClient(props: PosProps) {
  const { shift, register, settings, employee } = props;
  const router = useRouter();

  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountId, setDiscountId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>(props.initialOrders);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>("menu");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const discount: CartDiscount | null = useMemo(() => {
    const d = props.discounts.find((x) => x.id === discountId);
    return d ? { id: d.id, name: d.name, kind: d.kind, value: d.value } : null;
  }, [props.discounts, discountId]);
  const totals = useMemo(() => cartTotals(cart, discount), [cart, discount]);

  const showToast = useCallback((tone: "success" | "error", text: string) => {
    setToast({ tone, text });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === "error" ? 6000 : 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // ---------- ออเดอร์ที่ชำระแล้ว: โหลดใหม่เป็นระยะ (หลายเครื่อง/หลายคนใช้พร้อมกันได้) ----------
  const refreshing = useRef(false);
  const refreshOrders = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("orders").select(ORDER_SELECT)
        .eq("business_date", bangkokToday()).order("created_at", { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      setOrders(data as unknown as Order[]);
      setOrdersError(null);
    } catch (e) {
      setOrdersError(friendlyError(e instanceof Error ? e.message : String(e)));
    } finally {
      refreshing.current = false;
    }
  }, []);
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") void refreshOrders(); }, 8000);
    const onVis = () => { if (document.visibilityState === "visible") void refreshOrders(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [refreshOrders]);

  const nextOrderNo = useMemo(() => orders.reduce((m, o) => Math.max(m, o.order_no), 0) + 1, [orders]);
  const awaiting = orders.filter((o) => o.prep_status === "preparing").length;

  const canSell = !!shift && settings.sales_enabled;
  const clearOrder = () => { setCart([]); setDiscountId(null); };

  return (
    <div className="relative flex h-full flex-col">
      {/* แถบสถานะกะ */}
      <div className="glass no-print flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight text-[#6d0212]">{settings.shop_name === "Grandfa Farm Cafe & Resort" ? "BurnBaru" : settings.shop_name}</div>
          <div className="truncate text-xs text-stone-500">
            {register?.name ?? "ไม่มีเครื่อง POS"} · พนักงาน: {employee.name}
            {shift && <> · เปิดกะ {formatTime(shift.opened_at)}</>}
          </div>
        </div>
        {shift ? <Badge tone="paid">● กะกำลังเปิด</Badge> : <Badge tone="unpaid">ยังไม่เปิดกะ</Badge>}
        <div className="ml-auto flex items-center gap-2">
          {shift && (
            <Button size="sm" variant="secondary" onClick={() => setCloseOpen(true)}>
              <Icon name="clock" size={18} /> ปิดกะ
            </Button>
          )}
        </div>
      </div>

      {props.denied && <div className="px-3 pt-2"><Notice tone="warn">บัญชีของคุณไม่มีสิทธิ์เข้าหน้านั้น</Notice></div>}
      {props.loadError && <div className="px-3 pt-2"><Notice tone="error">โหลดข้อมูลไม่สำเร็จ: {friendlyError(props.loadError)}</Notice></div>}

      {/* พื้นที่ 3 คอลัมน์ — ไม่มีการเลื่อนแนวนอน แต่ละคอลัมน์เลื่อนแนวตั้งเอง */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 p-2.5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_minmax(0,0.95fr)]">
        <section className={cn("min-h-0", mobileTab === "menu" ? "block" : "hidden", "lg:block")} aria-label="เมนู">
          <MenuPanel
            categories={props.categories} products={props.products} cart={cart}
            salesEnabled={settings.sales_enabled}
            onAdd={(p) => setCart((c) => addProduct(c, { id: p.id, name: p.name, emoji: p.emoji, priceSatang: p.price_satang! }))}
          />
        </section>
        <section className={cn("min-h-0", mobileTab === "order" ? "block" : "hidden", "lg:block")} aria-label="ออเดอร์ปัจจุบัน">
          <OrderPanel
            orderNo={nextOrderNo} cart={cart} totals={totals} discount={discount} discounts={props.discounts}
            addons={props.addons} productAddons={props.productAddons} canCheckout={canSell}
            blockedReason={!shift ? "ยังไม่เปิดกะ" : !settings.sales_enabled ? "ยังไม่เปิดรับชำระเงิน" : null}
            onQty={(k, q) => setCart((c) => setQty(c, k, q))}
            onRemove={(k) => setCart((c) => removeLine(c, k))}
            onToggleAddon={(k, a) => setCart((c) => toggleAddon(c, k, a))}
            onDiscount={setDiscountId}
            onCancel={() => setCancelOpen(true)}
            onCheckout={() => setCheckoutOpen(true)}
          />
        </section>
        <section className={cn("min-h-0", mobileTab === "paid" ? "block" : "hidden", "lg:block")} aria-label="ออเดอร์ที่ชำระแล้ว">
          <PaidPanel orders={orders} error={ordersError} onChanged={refreshOrders} onToast={showToast} onOrdersChange={setOrders} />
        </section>
      </div>

      {/* แท็บสลับคอลัมน์ (จอเล็ก/มือถือ) */}
      <nav className="glass no-print safe-pb grid shrink-0 grid-cols-3 lg:hidden" aria-label="สลับส่วนของหน้าจอ">
        {([
          ["menu", "เมนู", null],
          ["order", `ออเดอร์${cart.length ? ` (${totals.itemCount})` : ""}`, null],
          ["paid", "ชำระแล้ว", awaiting],
        ] as const).map(([k, label, badge]) => (
          <button key={k} onClick={() => setMobileTab(k)} className={cn("min-h-12 text-sm font-medium", mobileTab === k ? "text-matcha-700" : "text-stone-500")}>
            {label}{badge ? <span className="ml-1 rounded-full bg-preparing px-1.5 text-xs text-white">{badge}</span> : null}
          </button>
        ))}
      </nav>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex justify-center px-4">
          <div className={cn("pointer-events-auto max-w-lg rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-lg", toast.tone === "error" ? "bg-refund" : "bg-matcha-800")} role="status">
            {toast.text}
          </div>
        </div>
      )}

      {!shift && <OpenShiftOverlay register={register} employeeName={employee.name} onOpened={() => router.refresh()} />}

      {shift && (
        <CheckoutDialog
          open={checkoutOpen} onClose={() => setCheckoutOpen(false)}
          shiftId={shift.id} cart={cart} totals={totals} discount={discount} orders={orders}
          customers={settings.customers_enabled ? props.customers : null}
          onPaid={() => { clearOrder(); void refreshOrders(); }}
        />
      )}
      {shift && (
        <CloseShiftDialog
          open={closeOpen} onClose={() => setCloseOpen(false)} shiftId={shift.id}
          onClosed={() => { clearOrder(); router.refresh(); }}
        />
      )}

      <Modal
        open={cancelOpen} onClose={() => setCancelOpen(false)} title="ยกเลิกออเดอร์นี้?"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCancelOpen(false)}>ไม่ยกเลิก</Button>
            <Button variant="danger" onClick={() => { clearOrder(); setCancelOpen(false); }}>ยกเลิกออเดอร์</Button>
          </div>
        }
      >
        <p className="text-stone-700">ล้างรายการทั้งหมดในออเดอร์ {formatOrderNo(nextOrderNo)} (ยังไม่ได้ชำระเงิน จึงไม่มีผลกับบัญชี)</p>
      </Modal>
    </div>
  );
}
