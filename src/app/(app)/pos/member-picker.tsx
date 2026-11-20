"use client";
import { useEffect, useRef, useState } from "react";
import { findMember, memberByQr, memberSummary, registerMember } from "@/app/actions/members";
import { ClaimQr } from "@/components/claim-qr";
import { Button, Field, Notice, cn, inputCls } from "@/components/ui";
import { formatBaht } from "@/lib/money";
import type { CartLine } from "@/lib/cart";
import { toCheckoutItems } from "@/lib/cart";
import type { MemberCard, MemberSummary } from "@/types/db";

type Mode = "search" | "register";

/**
 * เลือกสมาชิกในหน้าชำระเงิน: ค้นหา/วาง QR/สมัครใหม่/ลูกค้าทั่วไป (Guest)
 * ตัวเลขแต้มที่แสดงเป็น "ตัวอย่าง" จากฐานข้อมูล — ค่าจริงคำนวณตอนชำระเงินที่เซิร์ฟเวอร์
 */
export function MemberPicker({
  cart, netSatang, grossSatang, hasManualDiscount, summary, onSummary, couponId, onCoupon, disabled,
}: {
  cart: CartLine[]; netSatang: number; grossSatang: number; hasManualDiscount: boolean;
  summary: MemberSummary | null; onSummary: (s: MemberSummary | null) => void;
  couponId: string | null; onCoupon: (id: string | null) => void; disabled?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("search");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MemberCard[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(summary?.member.customer_id ?? null);
  const seq = useRef(0);

  // อัปเดตตัวอย่างแต้ม/คูปองเมื่อสมาชิกหรือยอดเปลี่ยน
  useEffect(() => {
    if (!memberId) return;
    const mine = ++seq.current;
    void (async () => {
      const r = await memberSummary({ customerId: memberId, items: toCheckoutItems(cart), netSatang, grossSatang });
      if (mine !== seq.current) return;
      if (!r.ok) { setError(r.error); return; }
      setError(null);
      const s = r.data as unknown as MemberSummary;
      onSummary(s);
      if (couponId && !s.coupons.some((c) => c.id === couponId && c.usable)) onCoupon(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, netSatang, grossSatang, cart]);

  const clear = () => { seq.current++; setMemberId(null); onSummary(null); onCoupon(null); setResults(null); setQ(""); setError(null); };

  const search = async () => {
    const text = q.trim();
    if (!text) return;
    setBusy(true); setError(null);
    const r = text.startsWith("BBM1.") ? await memberByQr(text) : await findMember(text);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    const list = (Array.isArray(r.data) ? r.data : [r.data]) as unknown as MemberCard[];
    if (list.length === 1 && text.startsWith("BBM1.")) { pick(list[0]); return; }
    setResults(list);
  };
  const pick = (m: MemberCard) => { setMemberId(m.customer_id); setResults(null); setError(null); };

  if (summary) {
    const m = summary.member;
    const p = summary.preview;
    return (
      <div className="mt-4 rounded-2xl border border-matcha-700/30 bg-matcha-50 p-3 text-sm" data-testid="member-selected">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{m.name}</div>
            <div className="text-stone-600">{m.member_no} · {m.tier_name ?? "—"}{m.has_line ? " · ผูก LINE แล้ว" : ""}</div>
          </div>
          <Button size="sm" onClick={clear} disabled={disabled}>เปลี่ยน</Button>
        </div>
        {!m.has_line && <ClaimQr purpose="link" customerId={m.customer_id} label="QR ผูกบัญชี LINE (ให้ลูกค้าสแกน)" />}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-stone-700">
          {summary.points_enabled && <span>แต้มสะสม <b className="tnum">{m.points}</b></span>}
          {summary.stamps.enabled && <span>แสตมป์ <b className="tnum">{summary.stamps.balance}/{summary.stamps.per_reward}</b></span>}
        </div>
        {(p.points > 0 || p.stamps > 0) && (
          <div className="mt-2 rounded-xl bg-white/80 px-3 py-2 text-matcha-800">
            ออเดอร์นี้จะได้{p.points > 0 && <> <b className="tnum">+{p.points}</b> แต้ม</>}{p.points > 0 && p.stamps > 0 && " และ"}{p.stamps > 0 && <> <b className="tnum">+{p.stamps}</b> แสตมป์</>}
          </div>
        )}
        {summary.coupons.length > 0 && (
          <fieldset className="mt-2" disabled={disabled}>
            <legend className="mb-1 font-medium text-stone-700">คูปองของสมาชิก</legend>
            {hasManualDiscount && <p className="mb-1 text-xs text-amber-700">เลือกส่วนลดของร้านไว้แล้ว — ใช้ร่วมกับคูปองไม่ได้</p>}
            <ul className="space-y-1">
              {summary.coupons.map((c) => {
                const selectable = c.usable && c.discount !== null && !hasManualDiscount;
                return (
                  <li key={c.id}>
                    <label className={cn("flex min-h-11 items-center gap-2 rounded-xl border bg-white/80 px-3", selectable ? "border-stone-300" : "border-stone-200 text-stone-400")}>
                      <input type="radio" name="member-coupon" className="size-5 accent-matcha-700" disabled={!selectable}
                        checked={couponId === c.id} onChange={() => onCoupon(c.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{c.title}</span>
                        <span className="block text-xs">
                          {c.discount === null ? "ใช้ที่เคาน์เตอร์ (ไม่ใช่ส่วนลด)" : !c.usable && c.min_spend_satang ? `ขั้นต่ำ ${formatBaht(c.min_spend_satang)}` : `หมดอายุ ${new Date(c.expires_at).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })}`}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {couponId && <button type="button" className="mt-1 text-xs text-stone-600 underline" onClick={() => onCoupon(null)}>ไม่ใช้คูปอง</button>}
          </fieldset>
        )}
      </div>
    );
  }

  if (mode === "register") {
    return <RegisterForm disabled={disabled} onBack={() => setMode("search")} onDone={(m) => { setMode("search"); pick(m); }} />;
  }

  return (
    <div className="mt-4 text-sm">
      <span className="mb-1 block font-medium text-stone-700">สมาชิก (ไม่บังคับ — ไม่เลือก = ลูกค้าทั่วไป)</span>
      <div className="flex gap-2">
        <input className={inputCls} value={q} placeholder="เบอร์โทร / 4 ตัวท้าย / BB-00001 / ชื่อ / วางรหัส QR" disabled={disabled}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} />
        <Button onClick={search} disabled={busy || disabled || !q.trim()}>{busy ? "…" : "ค้นหา"}</Button>
      </div>
      {error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}
      {results && (
        <ul className="mt-2 space-y-1">
          {results.length === 0 && <li className="text-stone-500">ไม่พบสมาชิก</li>}
          {results.map((m) => (
            <li key={m.customer_id}>
              <button type="button" onClick={() => pick(m)} className="flex min-h-11 w-full items-center justify-between rounded-xl border border-stone-300 bg-white/80 px-3 text-left active:bg-stone-100">
                <span className="truncate">{m.name} <span className="text-stone-500">· {m.member_no}</span></span>
                <span className="text-xs text-stone-500">{m.tier_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="mt-2 text-sm font-medium text-matcha-700 underline" onClick={() => setMode("register")} disabled={disabled}>+ สมัครสมาชิกใหม่ที่เคาน์เตอร์</button>
    </div>
  );
}

function RegisterForm({ onBack, onDone, disabled }: { onBack: () => void; onDone: (m: MemberCard) => void; disabled?: boolean }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError(null);
    const r = await registerMember({ name, phone, birthday: birthday || null, privacy, marketing });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onDone(r.data as unknown as MemberCard);
  };
  return (
    <div className="mt-4 space-y-2 rounded-2xl border border-stone-300 bg-white/80 p-3 text-sm">
      <div className="font-semibold">สมัครสมาชิกใหม่</div>
      <Field label="ชื่อ"><input className={inputCls} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="เบอร์โทร"><input className={inputCls} inputMode="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label="วันเกิด (ไม่บังคับ — ตั้งแล้วลูกค้าแก้เองไม่ได้)"><input className={inputCls} type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} /></Field>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 size-5 accent-matcha-700" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} /><span>ลูกค้ารับทราบและยอมรับนโยบายความเป็นส่วนตัว (จำเป็น)</span></label>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 size-5 accent-matcha-700" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /><span>ยินยอมรับข่าวสาร/โปรโมชันทาง LINE (ไม่บังคับ)</span></label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={onBack} disabled={busy}>ยกเลิก</Button>
        <Button variant="primary" onClick={submit} disabled={busy || disabled || !name.trim() || !phone.trim() || !privacy}>{busy ? "กำลังบันทึก…" : "สมัครและเลือก"}</Button>
      </div>
    </div>
  );
}
