import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, bangkokToday, formatDate, formatDateTime, isIsoDate } from "@/lib/time";
import { formatBaht } from "@/lib/money";
import { friendlyError } from "@/lib/errors";
import { formatOrderNo, METHOD_LABEL } from "@/lib/order-status";
import { DateFilter, PageBody, PageHeader } from "@/components/date-filter";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

interface Report {
  summary: { gross_satang: number; discounts_satang: number; refunds_satang: number; net_satang: number; order_count: number; discounted_order_count: number; avg_order_satang: number };
  by_payment: { method: "cash" | "transfer"; orders: number; amount_satang: number }[];
  refunds_by_method: { method: "cash" | "transfer"; count: number; amount_satang: number }[];
  by_product: { product_name: string; category_name: string; quantity: number; gross_satang: number }[];
  by_category: { category_name: string; quantity: number; gross_satang: number }[];
  by_employee: { employee_name: string; orders: number; gross_satang: number; discounts_satang: number }[];
  by_shift: { shift_id: string; opened_at: string; closed_at: string | null; status: string; opened_by: string; orders: number; gross_satang: number; discounts_satang: number; refunds_satang: number; expected_cash_satang: number | null; counted_cash_satang: number | null; variance_satang: number | null }[];
  discount_orders: { order_id: string; order_no: number; business_date: string; created_at: string; discount_name: string | null; discount_satang: number; subtotal_satang: number; total_satang: number }[];
  refund_history: { id: string; created_at: string; order_no: number; business_date: string; amount_satang: number; method: "cash" | "transfer"; reason: string; employee_name: string }[];
  movements: { cash_in_satang: number; cash_out_satang: number; transfer_in_satang: number; transfer_out_satang: number };
}

function Card({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" | "good" }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`tnum mt-1 text-2xl font-bold ${tone === "bad" ? "text-refund" : tone === "good" ? "text-matcha-800" : ""}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-stone-500">{hint}</div>}
    </div>
  );
}

function Table({ title, head, rows, empty = "ไม่มีข้อมูลในช่วงนี้", note }: { title: string; head: string[]; rows: (string | number)[][]; empty?: string; note?: string }) {
  return (
    <section className="glass overflow-hidden rounded-2xl">
      <div className="px-4 pt-3"><h2 className="font-semibold">{title}</h2>{note && <p className="text-xs text-stone-500">{note}</p>}</div>
      <div className="overflow-x-auto p-2">
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead className="text-xs text-stone-500"><tr>{head.map((h, i) => <th key={h} className={`px-2 py-1.5 ${i > 0 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-stone-200/70">
            {rows.length === 0 ? <tr><td colSpan={head.length} className="px-2 py-4 text-center text-stone-500">{empty}</td></tr> :
              rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`px-2 py-2 ${j > 0 ? "tnum text-right" : ""}`}>{c}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requirePermission("reports");
  const sp = await searchParams;
  const today = bangkokToday();
  const from = isIsoDate(sp.from) ? sp.from : today;
  const to = isIsoDate(sp.to) && sp.to >= from ? sp.to : from;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sales_report", { p_from: from, p_to: to });
  const r = data as Report | null;
  const b = formatBaht;

  return (
    <PageBody>
      <PageHeader title="รายงานยอดขาย" subtitle={from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`} />
      <DateFilter action="/reports" from={from} to={to} presets={[
        { label: "วันนี้", from: today, to: today }, { label: "เมื่อวาน", from: addDays(today, -1), to: addDays(today, -1) },
        { label: "7 วัน", from: addDays(today, -6), to: today }, { label: "30 วัน", from: addDays(today, -29), to: today },
      ]} />
      {error && <Notice tone="error">{friendlyError(error.message)}</Notice>}
      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card label="ยอดขายรวม (ก่อนลด)" value={b(r.summary.gross_satang)} hint={`${r.summary.order_count} ออเดอร์`} />
            <Card label="ส่วนลด" value={"−" + b(r.summary.discounts_satang)} hint={`${r.summary.discounted_order_count} ออเดอร์ที่มีส่วนลด`} />
            <Card label="คืนเงิน" value={"−" + b(r.summary.refunds_satang)} tone={r.summary.refunds_satang > 0 ? "bad" : undefined} />
            <Card label="ยอดขายสุทธิ" value={b(r.summary.net_satang)} tone="good" hint="= ยอดขาย − ส่วนลด − คืนเงิน" />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card label="จำนวนออเดอร์" value={String(r.summary.order_count)} />
            <Card label="เฉลี่ยต่อออเดอร์" value={b(r.summary.avg_order_satang)} hint="(ยอดขาย − ส่วนลด) ÷ ออเดอร์" />
            <Card label="เงินเข้า / ออก (เงินสด)" value={`${b(r.movements.cash_in_satang)} / ${b(r.movements.cash_out_satang)}`} hint="ไม่นับเป็นยอดขาย" />
            <Card label="เงินเข้า / ออก (โอน)" value={`${b(r.movements.transfer_in_satang)} / ${b(r.movements.transfer_out_satang)}`} hint="ไม่นับเป็นยอดขาย" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Table title="ยอดขายตามช่องทางชำระ" head={["ช่องทาง", "ออเดอร์", "ยอด"]}
              rows={r.by_payment.map((x) => [METHOD_LABEL[x.method], x.orders, b(x.amount_satang)])} />
            <Table title="คืนเงินตามช่องทาง" head={["ช่องทาง", "ครั้ง", "ยอด"]}
              rows={r.refunds_by_method.map((x) => [METHOD_LABEL[x.method], x.count, b(x.amount_satang)])} />
            <Table title="ยอดขายตามหมวดหมู่" head={["หมวด", "จำนวน", "ยอด"]} note="ยอดก่อนส่วนลด/คืนเงิน (ส่วนลดและคืนเงินคิดระดับออเดอร์)"
              rows={r.by_category.map((x) => [x.category_name, x.quantity, b(x.gross_satang)])} />
            <Table title="ยอดขายตามพนักงาน" head={["พนักงาน", "ออเดอร์", "ยอดขาย", "ส่วนลด"]}
              rows={r.by_employee.map((x) => [x.employee_name, x.orders, b(x.gross_satang), b(x.discounts_satang)])} />
          </div>
          <Table title="ยอดขายตามสินค้า" head={["สินค้า", "หมวด", "จำนวน", "ยอด"]} note="ใช้ชื่อและราคา ณ เวลาที่ขาย (แก้สินค้าภายหลังไม่เปลี่ยนรายงานเก่า)"
            rows={r.by_product.map((x) => [x.product_name, x.category_name, x.quantity, b(x.gross_satang)])} />
          <Table title="ยอดขายตามกะ" head={["เปิดกะ", "พนักงาน", "ออเดอร์", "ยอดขาย", "ส่วนลด", "คืนเงิน", "เงินสดควรมี", "นับได้", "ส่วนต่าง"]}
            rows={r.by_shift.map((x) => [formatDateTime(x.opened_at) + (x.status === "open" ? " (เปิดอยู่)" : ""), x.opened_by, x.orders, b(x.gross_satang), b(x.discounts_satang), b(x.refunds_satang),
              x.expected_cash_satang === null ? "-" : b(x.expected_cash_satang), x.counted_cash_satang === null ? "-" : b(x.counted_cash_satang), x.variance_satang === null ? "-" : b(x.variance_satang)])} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Table title="ออเดอร์ที่มีส่วนลด" head={["ออเดอร์", "ส่วนลด", "ลด", "ยอดสุทธิ"]}
              rows={r.discount_orders.map((x) => [`${formatOrderNo(x.order_no)} · ${formatDate(x.business_date)}`, x.discount_name ?? "-", "−" + b(x.discount_satang), b(x.total_satang)])} />
            <Table title="ประวัติการคืนเงิน" head={["ออเดอร์", "เหตุผล", "ช่องทาง", "ยอด"]}
              rows={r.refund_history.map((x) => [`${formatOrderNo(x.order_no)} · ${formatDateTime(x.created_at)}`, `${x.reason} (${x.employee_name})`, METHOD_LABEL[x.method], b(x.amount_satang)])} />
          </div>
        </>
      )}
    </PageBody>
  );
}
