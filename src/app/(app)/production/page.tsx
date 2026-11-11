import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_SNAPSHOT, type ProductionSnapshot } from "@/lib/production";
import { friendlyError } from "@/lib/errors";
import { ProductionClient, type ConfigData, type Mode } from "./production-client";

export const dynamic = "force-dynamic";

const MODES: Mode[] = ["split", "cake", "drink", "all"];

/**
 * งานผลิต (KDS): เปิดได้หลายเครื่องพร้อมกัน
 *   /production                → แยกจอ เค้ก + เครื่องดื่ม
 *   /production?station=cake   → เครื่องที่ตั้งไว้ที่สถานีเค้ก/เตาอบ
 *   /production?station=drink  → เครื่องที่ตั้งไว้ที่สถานีเครื่องดื่ม
 *   /production?station=all    → ทุกออเดอร์ (จุดส่งมอบ)
 */
export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ station?: string }> }) {
  const emp = await requirePermission("production");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_production_snapshot");

  const canConfigure = can(emp.role, "production.settings");
  let config: ConfigData | null = null;
  if (canConfigure) {
    const [cats, prods, cs, ps] = await Promise.all([
      supabase.from("categories").select("id,name").order("sort_order").order("name"),
      supabase.from("products").select("id,name,category_id,is_active").eq("is_active", true).order("name"),
      supabase.from("category_stations").select("category_id,station"),
      supabase.from("product_stations").select("product_id,station"),
    ]);
    config = {
      categories: (cats.data as ConfigData["categories"]) ?? [],
      products: (prods.data as ConfigData["products"]) ?? [],
      categoryStations: Object.fromEntries(((cs.data as { category_id: string; station: "cake" | "drink" }[] | null) ?? []).map((r) => [r.category_id, r.station])),
      productStations: Object.fromEntries(((ps.data as { product_id: string; station: "cake" | "drink" }[] | null) ?? []).map((r) => [r.product_id, r.station])),
    };
  }
  const mode = MODES.includes(sp.station as Mode) ? (sp.station as Mode) : "split";

  return (
    <ProductionClient
      initial={error || !data ? EMPTY_SNAPSHOT : (data as ProductionSnapshot)}
      loadError={error ? friendlyError(error.message) : null}
      initialMode={mode}
      canConfigure={canConfigure}
      config={config}
      employeeName={emp.name}
    />
  );
}
