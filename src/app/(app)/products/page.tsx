import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/date-filter";
import type { Addon, Category, Discount, Product, ProductAddon, Settings } from "@/types/db";
import { ProductsManager } from "./products-manager";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  await requirePermission("products");
  const supabase = await createClient();
  const [c, p, a, pa, d, s] = await Promise.all([
    supabase.from("categories").select("id,name,emoji,sort_order,active").order("sort_order").order("name"),
    supabase.from("products").select("id,category_id,name,emoji,price_satang,is_active,is_available,sort_order").order("sort_order").order("name"),
    supabase.from("addons").select("id,name,price_satang,sort_order,active").order("sort_order").order("name"),
    supabase.from("product_addons").select("product_id,addon_id"),
    supabase.from("discounts").select("id,name,kind,value,active").order("name"),
    supabase.from("settings").select("sales_enabled").maybeSingle(),
  ]);
  return (
    <PageBody>
      <PageHeader title="สินค้า" subtitle="เมนู หมวดหมู่ ตัวเลือกเสริม และส่วนลด — แก้ไขได้ทั้งหมด ประวัติบิลเก่าไม่เปลี่ยน" />
      <ProductsManager
        categories={(c.data as Category[]) ?? []} products={(p.data as Product[]) ?? []} addons={(a.data as Addon[]) ?? []}
        productAddons={(pa.data as ProductAddon[]) ?? []} discounts={(d.data as Discount[]) ?? []}
        salesEnabled={(s.data as Pick<Settings, "sales_enabled"> | null)?.sales_enabled ?? false}
      />
    </PageBody>
  );
}
