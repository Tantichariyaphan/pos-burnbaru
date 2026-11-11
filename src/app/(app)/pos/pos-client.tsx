"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ORDER_SELECT, fetchQueuesFor, type QueueReader } from "@/lib/queries";
import { fetchCakeLoad } from "@/lib/production-client";
import { useSyncedResource } from "@/lib/use-synced";
import { cakeForecast, resolveStation, type CakeLoad, type StationRoutes } from "@/lib/production";
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
import { QueueQrDialog } from "./queue-qr-dialog";
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
  /** ส่วนเสริมระบบคิว/ผลิต (ไม่มีถ้ายังไม่ได้ apply migration 0004) */
  routes: StationRoutes;
  initialCakeLoad: CakeLoad | null;
}

interface PosLive { orders: Order[]; cakeLoad: CakeLoad | null }

type MobileTab = "menu" | "order" | "paid";

export function PosClient(props: PosProps) {
  const { shift, register, settings, employee } = props;
  const router = useRouter();

  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountId, setDiscountId] = useState<string | null>(null);
  const [qrOrder, setQrOrder] = useState<Order | null>(null);
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

  // ---------- ออเดอร์ที่ชำระแล้ว + ภาระงานเค้ก: โหลดใหม่เป็นระยะ (หลายเครื่อง/หลายคนใช้พร้อมกันได้) ----------
  // ใช้ SyncController: ผล polling ที่เริ่มก่อนกดปุ่ม/ตอบช้า จะไม่ทับสถานะที่เพิ่งเปลี่ยน (บั๊ก DONE ต้องกดซ้ำ)
  const supabase = useMemo(() => createClient(), []);
  const fetchLive = useCallback(async (): Promise<PosLive> => {
    const { data, error } = await supabase
      .from("orders").select(ORDER_SELECT)
      .eq("business_date", bangkokToday()).order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    const list = data as unknown as Order[];
    const [queues, cakeLoad] = await Promise.all([
      fetchQueuesFor(supabase as unknown as QueueReader, list.map((o) => o.id)),
      fetchCakeLoad(supabase),
    ]);
    return { orders: list.map((o) => ({ ...o, queue: queues[o.id] ?? null })), cakeLoad };
  }, [supabase]);
  const live = useSyncedResource<PosLive>({ orders: props.initialOrders, cakeLoad: props.initialCakeLoad }, fetchLive, {
    intervalMs: 8000, errorMessage: (e) => friendlyError(e instanceof Error ? e.message : String(e)),
  });
  const orders = live.data.orders;
  const ordersError = live.error;
  const setOrders = useCallback(
    (fn: (o: Order[]) => Order[]) => live.setData((d) => ({ ...d, orders: fn(d.orders) })),
    [live],
  );
  const refreshOrders = live.refresh;

  // ตัวเตือนความจุรอบอบ: เฉพาะเค้กในตะกร้า (สถานีตามที่ร้านกำหนด) — เป็นข้อมูลวางแผน ไม่บล็อกการขาย
  const cartCakePieces = useMemo(
    () => cart.reduce((n, l) => {
      const p = props.products.find((x) => x.id === l.productId);
      return p && resolveStation(p.id, p.category_id, props.routes) === "cake" ? n + l.qty : n;
    }, 0),
    [cart, props.products, props.routes],
  );
  const cakeLoad = live.data.cakeLoad;
  const forecast = useMemo(() => (cakeLoad ? cakeForecast(cakeLoad, cartCakePieces, Date.now()) : null), [cakeLoad, cartCakePieces]);

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
        {cakeLoad && (
          <Link href="/production" className="flex min-h-11 items-center gap-2 rounded-xl bg-white/70 px-3 text-sm active:bg-stone-100" data-testid="queue-summary">
            <span className="font-semibold">คิวรอ <span className="tnum">{cakeLoad.activeQueues}</span></span>
            <span className="text-amber-900">🍰 รอบอบ <span className="tnum font-semibold">{Math.min(cakeLoad.queuedPieces, cakeLoad.capacity)}/{cakeLoad.capacity}</span></span>
            {cakeLoad.byProduct.length > 0 && (
              <span className="hidden text-xs text-stone-600 xl:inline">{cakeLoad.byProduct.map((b) => `${b.name} ${b.waiting + b.in_progress}`).join(" · ")}</span>
            )}
          </Link>
        )}
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
            addons={props.addons} productAddons={props.productAddons} canCheckout={canSell} forecast={forecast}
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
          <PaidPanel orders={orders} error={ordersError} setOrders={setOrders} track={live.track} onToast={showToast} onShowQr={setQrOrder} />
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

      {qrOrder?.queue && (
        <QueueQrDialog
          open onClose={() => setQrOrder(null)} queueNo={qrOrder.queue.queue_no} token={qrOrder.queue.public_token}
          orderLabel={`ออเดอร์ ${formatOrderNo(qrOrder.order_no)}`}
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
