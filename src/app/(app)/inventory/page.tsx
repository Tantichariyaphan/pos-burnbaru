import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/date-filter";
import { Notice } from "@/components/ui";
import type { InventoryItem, Product, Settings, StockMovement } from "@/types/db";
import { InventoryManager } from "./inventory-manager";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  await requirePermission("inventory");
  const supabase = await createClient();
  const [i, r, p, m, s] = await Promise.all([
    supabase.from("inventory_items").select("id,name,unit,qty_on_hand,low_stock_level,active").order("name"),
    supabase.from("recipes").select("product_id,inventory_item_id,qty_per_unit"),
    supabase.from("products").select("id,name,emoji,category_id,price_satang,is_active,is_available,sort_order").order("name"),
    supabase.from("stock_movements").select("id,inventory_item_id,kind,qty_delta,note,created_at").order("created_at", { ascending: false }).limit(60),
    supabase.from("settings").select("inventory_enabled").maybeSingle(),
  ]);
  const enabled = (s.data as Pick<Settings, "inventory_enabled"> | null)?.inventory_enabled ?? false;
  return (
    <PageBody>
      <PageHeader title="สต็อก" subtitle="วัตถุดิบ สูตรตัดสต็อกต่อเมนู และประวัติการเคลื่อนไหว" />
      {!enabled && <Notice tone="warn">ยังไม่เปิดใช้การตัดสต็อกอัตโนมัติ (เปิดได้ที่หน้า “ตั้งค่า”) — ตอนนี้ยังรับของ/ปรับยอดได้ แต่การขายจะไม่ตัดสต็อก</Notice>}
      <InventoryManager
        items={(i.data as InventoryItem[]) ?? []}
        recipes={(r.data as { product_id: string; inventory_item_id: string; qty_per_unit: number }[]) ?? []}
        products={(p.data as Product[]) ?? []}
        movements={(m.data as StockMovement[]) ?? []}
      />
    </PageBody>
  );
}
