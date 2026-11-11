import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/date-filter";
import type { Employee } from "@/types/db";
import { EmployeesManager } from "./employees-manager";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const me = await requirePermission("employees");
  const supabase = await createClient();
  const { data } = await supabase.from("employees").select("id,name,email,role,active,created_at").order("created_at");
  return (
    <PageBody>
      <PageHeader title="พนักงาน" subtitle="สร้างบัญชี กำหนดบทบาท และเปิด/ปิดการใช้งาน" />
      <EmployeesManager employees={(data as Employee[]) ?? []} meId={me.id} />
    </PageBody>
  );
}
