import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth";
import { bangkokToday } from "@/lib/time";
import { ORDER_SELECT } from "@/lib/queries";
import type { Addon, Category, Customer, Discount, Order, Product, ProductAddon, Register, Settings, Shift } from "@/types/db";
import { PosClient } from "./pos-client";

export const dynamic = "force-dynamic";

export default async function PosPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const emp = await requirePermission("pos");
  const sp = await searchParams;
  const supabase = await createClient();

  const [reg, cats, prods, addons, pa, discounts, settings, orders] = await Promise.all([
    supabase.from("registers").select("id,name,active").eq("active", true).order("created_at").limit(1).maybeSingle(),
    supabase.from("categories").select("id,name,emoji,sort_order,active").eq("active", true).order("sort_order").order("name"),
    supabase.from("products").select("id,category_id,name,emoji,price_satang,is_active,is_available,sort_order").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("addons").select("id,name,price_satang,sort_order,active").eq("active", true).order("sort_order").order("name"),
    supabase.from("product_addons").select("product_id,addon_id"),
    supabase.from("discounts").select("id,name,kind,value,active").eq("active", true).order("name"),
    supabase.from("settings").select("shop_name,receipt_footer,sales_enabled,inventory_enabled,customers_enabled").maybeSingle(),
    supabase.from("orders").select(ORDER_SELECT).eq("business_date", bangkokToday()).order("created_at", { ascending: false }).limit(100),
  ]);

  const register = reg.data as Register | null;
  let shift: Shift | null = null;
  if (register) {
    const { data } = await supabase
      .from("shifts")
      .select("id,register_id,opened_by,opened_at,opening_cash_satang,status,closed_at,counted_cash_satang,expected_cash_satang,variance_satang,close_note")
      .eq("register_id", register.id).eq("status", "open").maybeSingle();
    shift = (data as Shift | null) ?? null;
  }
  const st = settings.data as Settings | null;
  let customers: Customer[] = [];
  if (st?.customers_enabled) {
    const { data } = await supabase.from("customers").select("id,name,phone,note,active").eq("active", true).order("name").limit(500);
    customers = (data as Customer[]) ?? [];
  }

  const loadError = [cats, prods, orders, settings].find((r) => r.error)?.error?.message;

  return (
    <PosClient
      key={shift?.id ?? "no-shift"}
      denied={sp.denied === "1"}
      loadError={loadError ?? null}
      employee={{ id: emp.id, name: emp.name, role: emp.role }}
      register={register}
      shift={shift}
      categories={(cats.data as Category[]) ?? []}
      products={(prods.data as Product[]) ?? []}
      addons={(addons.data as Addon[]) ?? []}
      productAddons={(pa.data as ProductAddon[]) ?? []}
      discounts={(discounts.data as Discount[]) ?? []}
      customers={customers}
      settings={st ?? { shop_name: "Grandfa Farm Cafe & Resort", receipt_footer: "", sales_enabled: false, inventory_enabled: false, customers_enabled: false }}
      initialOrders={(orders.data as unknown as Order[]) ?? []}
    />
  );
}
