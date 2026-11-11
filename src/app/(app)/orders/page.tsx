import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, bangkokToday, isIsoDate } from "@/lib/time";
import { ORDER_SELECT } from "@/lib/queries";
import { can } from "@/lib/roles";
import { DateFilter, PageBody, PageHeader } from "@/components/date-filter";
import { Notice } from "@/components/ui";
import type { Order } from "@/types/db";
import { OrdersTable } from "./orders-table";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const emp = await requirePermission("pos");
  const sp = await searchParams;
  const today = bangkokToday();
  const from = isIsoDate(sp.from) ? sp.from : today;
  const to = isIsoDate(sp.to) && sp.to >= from ? sp.to : from;
  const supabase = await createClient();
  const { data, error } = await supabase.from("orders").select(ORDER_SELECT)
    .gte("business_date", from).lte("business_date", to).order("created_at", { ascending: false }).limit(300);
  const orders = (data as unknown as Order[]) ?? [];
  const ids = orders.map((o) => o.id);
  const refunded: Record<string, number> = {};
  if (ids.length) {
    const { data: rf } = await supabase.from("refunds").select("order_id,amount_satang").in("order_id", ids);
    (rf as { order_id: string; amount_satang: number }[] | null)?.forEach((r) => { refunded[r.order_id] = (refunded[r.order_id] ?? 0) + r.amount_satang; });
  }
  const isCashier = emp.role === "cashier";
  return (
    <PageBody>
      <PageHeader title="ประวัติออเดอร์" subtitle={isCashier ? "แคชเชียร์ดูได้เฉพาะออเดอร์ของวันนี้" : "ออเดอร์ที่ชำระแล้วทั้งหมด (สูงสุด 300 รายการล่าสุดในช่วงที่เลือก)"} />
      {!isCashier && (
        <DateFilter action="/orders" from={from} to={to} presets={[{ label: "วันนี้", from: today, to: today }, { label: "เมื่อวาน", from: addDays(today, -1), to: addDays(today, -1) }, { label: "7 วัน", from: addDays(today, -6), to: today }]} />
      )}
      {error && <Notice tone="error">โหลดข้อมูลไม่สำเร็จ: {error.message}</Notice>}
      <OrdersTable orders={orders} refunded={refunded} canRefund={can(emp.role, "orders.refund")} />
    </PageBody>
  );
}
