import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const emp = await getEmployee();
  if (!emp) redirect("/login");
  if (!emp.active) redirect("/pending");
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("shop_name").maybeSingle();
  return (
    <AppShell employee={{ name: emp.name, role: emp.role }} shopName={(data as { shop_name: string } | null)?.shop_name ?? "BurnBaru"}>
      {children}
    </AppShell>
  );
}
