import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/date-filter";
import type { Settings } from "@/types/db";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePermission("settings");
  const supabase = await createClient();
  const [s, missing] = await Promise.all([
    supabase.from("settings").select("shop_name,receipt_footer,sales_enabled,inventory_enabled,customers_enabled").maybeSingle(),
    supabase.from("products").select("name").eq("is_active", true).is("price_satang", null),
  ]);
  return (
    <PageBody>
      <PageHeader title="ตั้งค่า" subtitle="เฉพาะเจ้าของร้าน" />
      <SettingsForm
        settings={(s.data as Settings | null) ?? { shop_name: "", receipt_footer: "", sales_enabled: false, inventory_enabled: false, customers_enabled: false }}
        missingPrices={((missing.data as { name: string }[]) ?? []).map((m) => m.name)}
      />
    </PageBody>
  );
}
