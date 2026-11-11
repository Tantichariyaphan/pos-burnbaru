"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, db, fail, failText, type ActionResult } from "@/lib/actions";

export async function saveSettings(input: {
  shopName: string; receiptFooter: string; salesEnabled: boolean; inventoryEnabled: boolean; customersEnabled: boolean;
}): Promise<ActionResult> {
  const a = await authorize("settings");
  if ("error" in a) return failText(a.error);
  const p = z.object({
    shopName: z.string().trim().min(1).max(100), receiptFooter: z.string().trim().max(200),
    salesEnabled: z.boolean(), inventoryEnabled: z.boolean(), customersEnabled: z.boolean(),
  }).safeParse(input);
  if (!p.success) return failText("ข้อมูลไม่ถูกต้อง");
  const supabase = await db();

  if (p.data.salesEnabled) {
    // เปิดขายได้ก็ต่อเมื่อสินค้าที่เปิดใช้งานทุกชิ้นมีราคาแล้ว
    const { data, error } = await supabase.from("products").select("name").eq("is_active", true).is("price_satang", null);
    if (error) return fail(error.message);
    if (data && data.length > 0) {
      const names = (data as { name: string }[]).map((x) => x.name).slice(0, 6).join(", ");
      return failText(`ยังมีสินค้าที่ไม่ได้ตั้งราคา ${data.length} รายการ (${names}) — ตั้งราคาหรือปิดการใช้งานสินค้าเหล่านี้ในหน้า "สินค้า" ก่อนเปิดขาย`);
    }
  }
  const { error, count } = await supabase.from("settings").update({
    shop_name: p.data.shopName, receipt_footer: p.data.receiptFooter, sales_enabled: p.data.salesEnabled,
    inventory_enabled: p.data.inventoryEnabled, customers_enabled: p.data.customersEnabled,
  }, { count: "exact" }).eq("id", true);
  if (error) return fail(error.message);
  if (!count) return failText("คุณไม่มีสิทธิ์แก้ไขการตั้งค่า");
  revalidatePath("/", "layout");
  return { ok: true };
}
