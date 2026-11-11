"use client";
import { useEffect, useState } from "react";
import { closeShift, getShiftSummary, openShift } from "@/app/actions/pos";
import { Button, Modal, NumPad, Notice, Spinner } from "@/components/ui";
import { ShiftSummaryView } from "@/components/shift-summary";
import { bahtToSatang, formatBaht } from "@/lib/money";
import { cashVariance, type ShiftSummary } from "@/lib/shift";
import type { Register } from "@/types/db";

/** แสดงทับหน้า POS เมื่อยังไม่เปิดกะ */
export function OpenShiftOverlay({ register, employeeName, onOpened }: { register: Register | null; employeeName: string; onOpened: () => void }) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const satang = bahtToSatang(amount === "" ? "0" : amount);

  const submit = async () => {
    if (!register || satang === null || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await openShift({ registerId: register.id, openingCashSatang: satang });
      if (!r.ok) { setError(r.error); setConfirm(false); return; }
      onOpened();
    } catch {
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-stone-900/25 p-3 backdrop-blur-sm">
      <div className="glass w-full max-w-md rounded-3xl bg-white/90 p-5">
        <h2 className="text-xl font-semibold">เปิดกะ</h2>
        <p className="text-sm text-stone-600">{register?.name ?? "ไม่พบเครื่อง POS"} · พนักงาน: <b>{employeeName}</b></p>
        {!register ? (
          <div className="mt-4"><Notice tone="error">ยังไม่มีเครื่อง POS ที่ใช้งานได้ในระบบ</Notice></div>
        ) : (
          <>
            <div className="mt-4 flex items-baseline justify-between rounded-2xl border border-stone-300 bg-white px-4 py-2">
              <span className="text-sm text-stone-600">เงินทอนตั้งต้นในลิ้นชัก</span>
              <span className="tnum text-3xl font-semibold" data-testid="opening">฿{amount === "" ? "0" : amount}</span>
            </div>
            <div className="mt-3"><NumPad value={amount} onChange={(v) => { setAmount(v); setConfirm(false); }} /></div>
            {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
            {confirm ? (
              <div className="mt-3 space-y-2">
                <Notice tone="warn">ยืนยันนับเงินทอนตั้งต้น <b>{satang !== null ? formatBaht(satang) : "-"}</b> ถูกต้องแล้ว?</Notice>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => setConfirm(false)} disabled={busy}>แก้ไข</Button>
                  <Button variant="primary" size="lg" className="flex-[2]" onClick={submit} disabled={busy}>{busy ? <Spinner /> : "ยืนยันเปิดกะ"}</Button>
                </div>
              </div>
            ) : (
              <Button variant="primary" size="lg" className="mt-3 w-full" disabled={satang === null} onClick={() => setConfirm(true)}>
                เปิดกะ
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function CloseShiftDialog({ open, onClose, shiftId, onClosed }: { open: boolean; onClose: () => void; shiftId: string; onClosed: () => void }) {
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState<"count" | "confirm" | "done">("count");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [final, setFinal] = useState<ShiftSummary | null>(null);

  useEffect(() => {
    if (!open) return;
    setSummary(null); setLoadError(null); setCounted(""); setNote(""); setStep("count"); setError(null); setFinal(null);
    let alive = true;
    getShiftSummary(shiftId)
      .then((r) => { if (!alive) return; if (r.ok) setSummary(r.data!); else setLoadError(r.error); })
      .catch(() => alive && setLoadError("โหลดสรุปกะไม่สำเร็จ กรุณาลองใหม่"));
    return () => { alive = false; };
  }, [open, shiftId]);

  const countedSatang = counted === "" ? null : bahtToSatang(counted);
  const variance = summary && countedSatang !== null ? cashVariance(countedSatang, summary.expected_cash_satang) : null;

  const submit = async () => {
    if (countedSatang === null || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await closeShift({ shiftId, countedCashSatang: countedSatang, note: note.trim() || undefined });
      if (!r.ok) { setError(r.error); setStep("count"); return; }
      setFinal(r.data!); setStep("done");
    } catch {
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่ (ถ้ากะถูกปิดไปแล้วระบบจะแจ้งเมื่อกดอีกครั้ง)");
    } finally {
      setBusy(false);
    }
  };

  if (step === "done" && final) {
    return (
      <Modal open={open} onClose={() => { onClose(); onClosed(); }} wide title="ปิดกะเรียบร้อย" dismissable={false}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => window.print()}>พิมพ์สรุปกะ</Button>
            <Button variant="primary" size="lg" onClick={() => { onClose(); onClosed(); }}>เสร็จสิ้น</Button>
          </div>
        }
      >
        <ShiftSummaryView s={final} />
      </Modal>
    );
  }

  return (
    <Modal
      open={open} onClose={onClose} wide title={step === "confirm" ? "ยืนยันปิดกะ" : "ปิดกะ"} dismissable={!busy}
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && <div className="mr-auto min-w-0 flex-1"><Notice tone="error">{error}</Notice></div>}
          {step === "confirm" ? (
            <>
              <Button onClick={() => setStep("count")} disabled={busy}>แก้ไขตัวเลข</Button>
              <Button variant="primary" size="lg" onClick={submit} disabled={busy}>{busy ? <Spinner /> : "ยืนยันปิดกะ"}</Button>
            </>
          ) : (
            <>
              <Button onClick={onClose}>ยกเลิก</Button>
              <Button variant="primary" size="lg" disabled={countedSatang === null || !summary} onClick={() => setStep("confirm")}>ตรวจสอบและปิดกะ</Button>
            </>
          )}
        </div>
      }
    >
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {!summary && !loadError && <div className="grid place-items-center py-10 text-stone-500"><Spinner /></div>}
      {summary && (
        <div className="space-y-5">
          <ShiftSummaryView s={summary} />
          <div className="grid gap-4 border-t border-stone-200 pt-4 md:grid-cols-[1fr_320px]">
            <div className="space-y-3">
              <div className="flex items-baseline justify-between rounded-2xl border border-stone-300 bg-white px-4 py-2">
                <span className="text-sm text-stone-600">เงินสดที่นับได้จริง</span>
                <span className="tnum text-3xl font-semibold" data-testid="counted">฿{counted === "" ? "0" : counted}</span>
              </div>
              <div className="flex items-baseline justify-between rounded-2xl px-4 py-2" style={{ background: variance === null ? "#f5f5f4" : variance === 0 ? "#ecfdf5" : "#fff1f2" }}>
                <span className="text-sm text-stone-600">ส่วนต่าง (นับได้ − ควรมี {formatBaht(summary.expected_cash_satang)})</span>
                <span className={`tnum text-2xl font-bold ${variance === null ? "text-stone-400" : variance === 0 ? "text-paid" : "text-refund"}`} data-testid="variance">
                  {variance === null ? "—" : (variance > 0 ? "+" : "") + formatBaht(variance)}
                </span>
              </div>
              {step === "confirm" ? (
                <Notice tone={variance === 0 ? "success" : "warn"}>
                  {variance === 0
                    ? "เงินสดตรงกับระบบ ยืนยันปิดกะได้เลย — หลังปิดกะจะแก้ไขตัวเลขไม่ได้"
                    : `เงินสด${(variance ?? 0) > 0 ? "เกิน" : "ขาด"} ${formatBaht(Math.abs(variance ?? 0))} — ตรวจนับอีกครั้งก่อนยืนยัน หลังปิดกะจะแก้ไขตัวเลขไม่ได้`}
                </Notice>
              ) : (
                <input className="min-h-11 w-full rounded-xl border border-stone-300 bg-white/90 px-3" placeholder="หมายเหตุ (ไม่บังคับ) เช่น สาเหตุที่ส่วนต่าง" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              )}
            </div>
            {step === "count" && <NumPad value={counted} onChange={setCounted} />}
          </div>
        </div>
      )}
    </Modal>
  );
}
