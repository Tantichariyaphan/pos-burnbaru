import type { Role } from "@/lib/roles";
import type { PaymentStatus, PrepStatus } from "@/lib/order-status";
import type { DiscountKind } from "@/lib/money";

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
}
export interface CashMovement {
  id: string; shift_id: string | null; direction: "in" | "out"; channel: "cash" | "transfer"; amount_satang: number;
  category: string; note: string | null; employee_id: string; reverses_id: string | null; created_at: string;
}
export interface InventoryItem { id: string; name: string; unit: string; qty_on_hand: number; low_stock_level: number; active: boolean }
export interface StockMovement { id: string; inventory_item_id: string; kind: string; qty_delta: number; note: string | null; created_at: string }
