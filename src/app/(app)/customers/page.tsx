import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/date-filter";
import { Notice } from "@/components/ui";
import type { Customer, Settings } from "@/types/db";
import { CustomersManager } from "./customers-manager";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  await requirePermission("customers");
  const supabase = await createClient();
  const [c, s] = await Promise.all([
    supabase.from("customers").select("id,name,phone,note,active").order("name").limit(1000),
    supabase.from("settings").select("customers_enabled").maybeSingle(),
  ]);
  const enabled = (s.data as Pick<Settings, "customers_enabled"> | null)?.customers_enabled ?? false;
  return (
    <PageBody>
      <PageHeader title="ลูกค้า" subtitle="รายชื่อลูกค้าสำหรับผูกกับออเดอร์ (ไม่บังคับ)" />
      {!enabled && <Notice tone="info">ตัวเลือก “ลูกค้า” ในหน้าชำระเงินยังปิดอยู่ (เจ้าของร้านเปิดได้ที่หน้า “ตั้งค่า”) แต่เพิ่มรายชื่อไว้ล่วงหน้าได้</Notice>}
      <CustomersManager customers={(c.data as Customer[]) ?? []} />
    </PageBody>
  );
}
