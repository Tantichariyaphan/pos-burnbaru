import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { bangkokToday } from "@/lib/time";
import { PageBody, PageHeader } from "@/components/date-filter";
import { Notice } from "@/components/ui";
import type { Json } from "@/types/db";
import { MembersClient } from "./members-client";

export const dynamic = "force-dynamic";

function daysAgo(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export default async function MembersPage() {
  const emp = await requirePermission("members");
  const supabase = await createClient();
  const today = bangkokToday();
  const [overview, members, loyalty, tiers, templates, keywords, discounts] = await Promise.all([
    supabase.rpc("members_overview", { p_from: daysAgo(today, 29), p_to: today }),
    supabase.from("member_profiles")
      .select("customer_id,member_no,points_balance,stamps_balance,joined_at,last_purchase_at,customers(name,phone,active),membership_tiers(name)")
      .order("joined_at", { ascending: false }).limit(300),
    supabase.from("loyalty_settings").select("*").maybeSingle(),
    supabase.from("membership_tiers").select("*").order("sort_order"),
    supabase.from("coupon_templates").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("chat_keywords").select("id,keyword,response_text,active").order("keyword").limit(500),
    supabase.from("discounts").select("id,name,kind,value").eq("active", true).order("name"),
  ]);
  const err = [overview, members, loyalty, tiers, templates, keywords].find((r) => r.error)?.error?.message;
  return (
    <PageBody>
      <PageHeader title="สมาชิก" subtitle="BURN BARU CLUB — ภาพรวม สมาชิก และการตั้งค่า" />
      {err && <Notice tone="error">โหลดข้อมูลไม่สำเร็จ — ตรวจสอบว่าได้รันไมเกรชัน 0005_membership.sql แล้ว ({err.slice(0, 120)})</Notice>}
      <MembersClient
        isOwner={emp.role === "owner"}
        from={daysAgo(today, 29)} to={today}
        overview={(overview.data as Json | null) ?? null}
        members={(members.data as unknown as never[]) ?? []}
        loyalty={(loyalty.data as Json | null) ?? null}
        tiers={(tiers.data as unknown as never[]) ?? []}
        templates={(templates.data as unknown as never[]) ?? []}
        keywords={(keywords.data as unknown as never[]) ?? []}
        discounts={(discounts.data as unknown as never[]) ?? []}
      />
    </PageBody>
  );
}
