import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, bangkokToday, isIsoDate } from "@/lib/time";
import { can } from "@/lib/roles";
import { DateFilter, PageBody, PageHeader } from "@/components/date-filter";
import { Notice } from "@/components/ui";
import { formatBaht } from "@/lib/money";
import type { CashMovement, Employee, Shift } from "@/types/db";
import type { ShiftSummary } from "@/lib/shift";
import { CashForm } from "./cash-form";
import { MovementList } from "./movement-list";

export const dynamic = "force-dynamic";

export default async function CashPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const emp = await requirePermission("cash");
  const sp = await searchParams;
  const today = bangkokToday();
  const isCashier = emp.role === "cashier";
  const from = !isCashier && isIsoDate(sp.from) ? sp.from : today;
  const to = !isCashier && isIsoDate(sp.to) && sp.to >= from ? sp.to : from;

  const supabase = await createClient();
  const { data: shiftRow } = await supabase.from("shifts").select("id,status,opened_at,opening_cash_satang").eq("status", "open").limit(1).maybeSingle();
  const shift = shiftRow as Pick<Shift, "id" | "status" | "opened_at" | "opening_cash_satang"> | null;
  let summary: ShiftSummary | null = null;
  if (shift) {
    const { data } = await supabase.rpc("get_shift_summary", { p_shift_id: shift.id });
    summary = (data as ShiftSummary | null) ?? null;
  }

  // ช่วงเวลาตามเขตเวลากรุงเทพ (UTC+7)
  const { data: mv, error } = await supabase.from("cash_movements")
    .select("id,shift_id,direction,channel,amount_satang,category,note,employee_id,reverses_id,created_at")
    .gte("created_at", `${from}T00:00:00+07:00`).lt("created_at", `${addDays(to, 1)}T00:00:00+07:00`)
    .order("created_at", { ascending: false }).limit(500);
  const movements = (mv as CashMovement[]) ?? [];
  const { data: emps } = await supabase.from("employees").select("id,name");
  const names: Record<string, string> = {};
  (emps as Pick<Employee, "id" | "name">[] | null)?.forEach((e) => { names[e.id] = e.name; });
  names[emp.id] = emp.name;
  const reversed = new Set(movements.filter((m) => m.reverses_id).map((m) => m.reverses_id as string));

  return (
    <PageBody>
      <PageHeader title="เงินเข้า-ออก" subtitle="บันทึกเงินที่เข้า/ออกจากร้าน — รายจ่ายไม่นับเป็นยอดขาย" />
      {summary ? (
        <div className="glass flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3">
          <span className="text-sm text-stone-600">เงินสดที่ควรมีในลิ้นชักตอนนี้</span>
          <span className="tnum text-2xl font-bold text-matcha-800">{formatBaht(summary.expected_cash_satang)}</span>
        </div>
      ) : (
        <Notice tone="warn">ยังไม่เปิดกะ — บันทึกได้เฉพาะรายการ “โอนเงิน” (รายการเงินสดต้องเปิดกะก่อนที่หน้า POS)</Notice>
      )}
      <CashForm shiftId={shift?.id ?? null} />
      {!isCashier && <DateFilter action="/cash" from={from} to={to} presets={[{ label: "วันนี้", from: today, to: today }, { label: "7 วัน", from: addDays(today, -6), to: today }]} />}
      {error && <Notice tone="error">โหลดรายการไม่สำเร็จ: {error.message}</Notice>}
      <MovementList movements={movements} names={names} reversed={Array.from(reversed)} canReverse={can(emp.role, "cash.reverse")} />
    </PageBody>
  );
}
