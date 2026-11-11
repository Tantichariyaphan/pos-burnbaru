import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, type Permission, type Role } from "@/lib/roles";

export interface CurrentEmployee { id: string; name: string; email: string | null; role: Role; active: boolean }

/** พนักงานที่ล็อกอินอยู่ (null = ยังไม่ล็อกอิน หรือไม่มีแถวพนักงาน) — เรียกซ้ำในคำขอเดียวกันใช้ผลเดิม */
export const getEmployee = cache(async (): Promise<CurrentEmployee | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase.from("employees").select("id,name,email,role,active").eq("id", auth.user.id).maybeSingle();
  return (data as CurrentEmployee | null) ?? null;
});

/** ใช้ใน Server Component: ไม่ผ่านสิทธิ์ → เด้งกลับหน้า POS */
export async function requirePermission(perm: Permission): Promise<CurrentEmployee> {
  const emp = await getEmployee();
  if (!emp) redirect("/login");
  if (!emp.active) redirect("/pending");
  if (!can(emp.role, perm)) redirect("/pos?denied=1");
  return emp;
}
