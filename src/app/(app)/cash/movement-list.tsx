"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { reverseMovement } from "@/app/actions/cash";
import { Badge, Button, Empty, Field, Modal, Notice, inputCls, newKey } from "@/components/ui";
import { formatBaht } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import type { CashMovement } from "@/types/db";

export function MovementList({ movements, names, reversed, canReverse }: { movements: CashMovement[]; names: Record<string, string>; reversed: string[]; canReverse: boolean }) {
  const router = useRouter();
  const done = new Set(reversed);
  const [target, setTarget] = useState<CashMovement | null>(null);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!target || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await reverseMovement({ idempotencyKey: key, movementId: target.id, reason });
      if (!r.ok) return setError(r.error);
      setTarget(null); router.refresh();
    } catch { setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กดอีกครั้งได้ (ไม่บันทึกซ้ำ)"); } finally { setBusy(false); }
  };

  if (movements.length === 0) return <Empty>ยังไม่มีรายการในช่วงนี้</Empty>;
  return (
    <>
      <div className="glass overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-stone-100/70 text-xs text-stone-500">
              <tr><th className="p-3">เวลา</th><th>ประเภท</th><th>เหตุผล</th><th>พนักงาน</th><th className="text-right">จำนวน</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-stone-200/70">
              {movements.map((m) => (
                <tr key={m.id} className={done.has(m.id) ? "text-stone-400 line-through decoration-stone-300" : ""}>
                  <td className="tnum whitespace-nowrap p-3">{formatDateTime(m.created_at)}</td>
                  <td className="space-x-1 py-3">
                    <Badge tone={m.direction === "in" ? "paid" : "refund"}>{m.direction === "in" ? "เข้า" : "ออก"}</Badge>
                    <Badge tone="neutral">{m.channel === "cash" ? "เงินสด" : "โอน"}</Badge>
                  </td>
                  <td className="py-3">{m.category}{m.note && <span className="block text-xs text-stone-500">{m.note}</span>}{m.reverses_id && <span className="block text-xs text-unpaid">รายการกลับรายการ</span>}</td>
                  <td className="py-3">{names[m.employee_id] ?? "-"}</td>
                  <td className={`tnum py-3 text-right font-semibold ${m.direction === "in" ? "text-paid" : "text-refund"}`}>{m.direction === "in" ? "+" : "−"}{formatBaht(m.amount_satang)}</td>
                  <td className="py-3 pr-3 text-right">
                    {canReverse && !m.reverses_id && !done.has(m.id) && (
                      <Button size="sm" onClick={() => { setTarget(m); setReason(""); setError(null); setKey(newKey()); }}>กลับรายการ</Button>
                    )}
                    {done.has(m.id) && <span className="text-xs">กลับรายการแล้ว</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Modal open={!!target} onClose={() => !busy && setTarget(null)} title="กลับรายการ"
        footer={<div className="flex items-center justify-end gap-2">
          {error && <div className="mr-auto flex-1"><Notice tone="error">{error}</Notice></div>}
          <Button onClick={() => setTarget(null)} disabled={busy}>ยกเลิก</Button>
          <Button variant="danger" disabled={!reason.trim() || busy} onClick={submit}>ยืนยันกลับรายการ</Button>
        </div>}>
        <div className="space-y-3">
          <Notice tone="info">ระบบจะสร้างรายการตรงข้ามอ้างอิงรายการเดิม (ไม่ลบ/ไม่แก้รายการเดิม) ผลต่อเงินสดจะลงในกะที่เปิดอยู่ตอนนี้</Notice>
          {target && <p className="text-sm">{target.direction === "in" ? "เงินเข้า" : "เงินออก"} {formatBaht(target.amount_satang)} — {target.category}</p>}
          <Field label="เหตุผลที่กลับรายการ (จำเป็น)"><input className={inputCls} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </Modal>
    </>
  );
}
