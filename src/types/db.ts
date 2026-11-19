import type { Role } from "@/lib/roles";
import type { PaymentStatus, PrepStatus } from "@/lib/order-status";
import type { DiscountKind } from "@/lib/money";
import type { OrderQueueInfo } from "@/lib/queries";

export interface Employee { id: string; name: string; email: string | null; role: Role; active: boolean; created_at: string }
export interface Register { id: string; name: string; active: boolean }
export interface Category { id: string; name: string; emoji: string | null; sort_order: number; active: boolean }
export interface Product {
  id: string; category_id: string; name: string; emoji: string | null; price_satang: number | null;
  is_active: boolean; is_available: boolean; sort_order: number;
}
export interface Addon { id: string; name: string; price_satang: number; sort_order: number; active: boolean }
export interface ProductAddon { product_id: string; addon_id: string }
export interface Discount { id: string; name: string; kind: DiscountKind; value: number; active: boolean }
export interface Customer { id: string; name: string; phone: string | null; note: string | null; active: boolean }
export interface Settings {
  shop_name: string; receipt_footer: string; sales_enabled: boolean; inventory_enabled: boolean; customers_enabled: boolean;
}
export interface Shift {
  id: string; register_id: string; opened_by: string; opened_at: string; opening_cash_satang: number;
  status: "open" | "closed"; closed_at: string | null; counted_cash_satang: number | null;
  expected_cash_satang: number | null; variance_satang: number | null; close_note: string | null;
}
export interface OrderItem {
  id: string; product_name: string; category_name: string; unit_price_satang: number;
  addons: { id: string; name: string; price_satang: number }[]; addon_unit_satang: number;
  quantity: number; line_total_satang: number;
}
export interface Payment { method: "cash" | "transfer"; amount_satang: number; received_satang: number; change_satang: number; reference: string | null }
export interface Order {
  id: string; order_no: number; business_date: string; subtotal_satang: number; discount_name: string | null;
  discount_satang: number; total_satang: number; payment_status: PaymentStatus; prep_status: PrepStatus;
  created_at: string; prepared_at: string | null; employee_id: string;
  order_items: OrderItem[]; payments: Payment[];
  /** ข้อมูลคิว (ส่วนเสริม — ไม่มีถ้าออเดอร์เก่าก่อนเปิดใช้ระบบคิว หรือยังไม่ได้ apply migration 0004) */
  queue?: OrderQueueInfo | null;
}
export interface CashMovement {
  id: string; shift_id: string | null; direction: "in" | "out"; channel: "cash" | "transfer"; amount_satang: number;
  category: string; note: string | null; employee_id: string; reverses_id: string | null; created_at: string;
}
export interface InventoryItem { id: string; name: string; unit: string; qty_on_hand: number; low_stock_level: number; active: boolean }
export interface StockMovement { id: string; inventory_item_id: string; kind: string; qty_delta: number; note: string | null; created_at: string }

// ---- สมาชิก (migration 0005) ----
export type Json = Record<string, unknown>;
export interface MemberCard {
  customer_id: string; member_no: string; name: string; phone: string | null; birthday: string | null;
  tier_code: string | null; tier_name: string | null; points: number; stamps: number; stamps_lifetime: number;
  joined_at: string; last_purchase_at: string | null; marketing_consent: boolean; privacy_accepted: boolean;
  active: boolean; has_line: boolean;
}
export interface MemberCouponChoice {
  id: string; code: string; title: string; expires_at: string; usable: boolean; min_spend_satang: number | null;
  discount: { name: string; kind: DiscountKind; value: number } | null;
}
export interface MemberSummary {
  member: MemberCard; enabled: boolean; points_enabled: boolean;
  preview: { basis_satang: number; points: number; stamps: number };
  tier: { current?: { code: string; name: string }; next?: { name: string; remaining_satang: number } | null } & Json;
  stamps: { enabled: boolean; balance: number; per_reward: number };
  coupons: MemberCouponChoice[];
}
