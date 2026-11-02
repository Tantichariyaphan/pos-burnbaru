import { formatBaht } from "@/lib/money";
import type { ShiftSummary } from "@/lib/shift";
import { cn } from "@/components/ui";

function Row({ label, value, sign, strong, tone }: { label: string; value: number; sign?: "+" | "−" | "="; strong?: boolean; tone?: "good" | "bad" }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1.5", strong && "border-t border-stone-300 pt-2 font-semibold")}>
      <span className="text-stone-700">{sign && <span className="mr-1.5 inline-block w-3 text-stone-400">{sign}</span>}{label}</span>
      <span className={cn("tnum", tone === "bad" && "text-refund", tone === "good" && "text-paid")}>{formatBaht(value)}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</h3>
      <div className="divide-y divide-stone-200/70 text-sm">{children}</div>
    </section>
  );
}

/** สรุปกะ — ใช้นิยามเดียวกับรายงาน/ใบเสร็จ (ดู lib/shift.ts) */
export function ShiftSummaryView({ s, showCount = true }: { s: ShiftSummary; showCount?: boolean }) {
  const variance = s.variance_satang;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Section title="เงินสดในลิ้นชัก">
        <Row label="เงินทอนตั้งต้น" value={s.opening_cash_satang} />
        <Row label="ยอดขายเงินสด" value={s.cash_sales_satang} sign="+" />
        <Row label="เงินสดเข้า" value={s.cash_in_satang} sign="+" />
        <Row label="เงินสดออก" value={s.cash_out_satang} sign="−" />
        <Row label="คืนเงินสด" value={s.cash_refunds_satang} sign="−" />
        <Row label="เงินสดที่ควรมี" value={s.expected_cash_satang} sign="=" strong />
        {s.counted_cash_satang !== undefined && <Row label="เงินสดที่นับได้" value={s.counted_cash_satang} />}
        {variance !== undefined && (
          <Row label="ส่วนต่าง (นับได้ − ควรมี)" value={variance} strong tone={variance === 0 ? "good" : "bad"} />
        )}
      </Section>
      <div className="space-y-5">
        <Section title="ยอดขาย">
          <Row label="ยอดขายรวม (ก่อนลด)" value={s.total_sales_satang} />
          <Row label="ส่วนลด" value={s.discounts_satang} sign="−" />
          <Row label="คืนเงิน" value={s.refunds_satang} sign="−" />
          <Row label="ยอดขายสุทธิ" value={s.net_sales_satang} sign="=" strong />
        </Section>
        <Section title="ช่องทางรับชำระ (ไม่รวมเงินโอนในลิ้นชัก)">
          <Row label="เงินสด" value={s.cash_payments_satang} />
          <Row label="เงินโอน" value={s.transfer_payments_satang} />
          {showCount && (
            <div className="flex justify-between py-1.5"><span className="text-stone-700">จำนวนออเดอร์</span><span className="tnum">{s.order_count}</span></div>
          )}
        </Section>
      </div>
    </div>
  );
}
