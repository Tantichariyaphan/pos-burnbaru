"use client";
import { ClaimQr } from "@/components/claim-qr";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adjustPoints, cancelCoupon, getMemberDetail, getMembersOverview, issueCoupon, rotateMemberQr, runReconcile, unlinkLine,
} from "@/app/actions/members";
import { deleteKeyword, saveCouponTemplate, saveKeyword, saveLoyaltySettings, saveTier } from "@/app/actions/members-admin";
import { Badge, Button, Empty, Field, Notice, cn, inputCls, newKey } from "@/components/ui";
import { formatBaht } from "@/lib/money";
import type { Json, MemberCard } from "@/types/db";

interface MemberRow {
  customer_id: string; member_no: string; points_balance: number; stamps_balance: number; joined_at: string; last_purchase_at: string | null;
  customers: { name: string; phone: string | null; active: boolean } | null; membership_tiers: { name: string } | null;
}
interface Tier { id: string; code: string; name: string; min_rolling_spend_satang: number | null; benefits: string[]; active: boolean }
interface Template {
  id: string; title: string; description: string | null; source: string; discount_id: string | null; point_cost: number | null;
  min_spend_satang: number | null; expire_days: number | null; expire_at: string | null; quantity_limit: number | null; active: boolean;
}
interface Keyword { id: string; keyword: string; response_text: string; active: boolean }
interface Discount { id: string; name: string; kind: string; value: number }
type Loyalty = Record<string, unknown> & {
  membership_enabled: boolean; points_enabled: boolean; satang_per_point: number | null; earn_basis: string; tier_rolling_months: number;
  tier_downgrade_enabled: boolean; stamps_enabled: boolean; stamps_per_reward: number; stamp_station: string; stamp_reward_title: string;
  stamp_reward_expire_days: number; welcome_coupon_template_id: string | null; birthday_coupon_template_id: string | null;
  claim_qr_minutes: number; claim_order_window_hours: number; comeback_days: number | null; marketing_cap_days: number;
};

type Tab = "overview" | "members" | "settings" | "templates" | "keywords";
const TABS: [Tab, string][] = [["overview", "ภาพรวม"], ["members", "สมาชิก"], ["settings", "ตั้งค่าโปรแกรม"], ["templates", "คูปอง/รางวัล"], ["keywords", "ข้อความตอบกลับ"]];

export function MembersClient(props: {
  isOwner: boolean; from: string; to: string; overview: Json | null; members: MemberRow[]; loyalty: Json | null;
  tiers: Tier[]; templates: Template[]; keywords: Keyword[]; discounts: Discount[];
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const loyalty = props.loyalty as Loyalty | null;
  return (
    <div className="space-y-4">
      {loyalty && !loyalty.membership_enabled && (
        <Notice tone="info">ระบบสมาชิก<b>ยังปิดอยู่</b> — การขายทำงานตามปกติและยังไม่ให้แต้ม/แสตมป์ เจ้าของร้านเปิดได้ในแท็บ “ตั้งค่าโปรแกรม” หลังตั้งค่า LINE ครบ</Notice>
      )}
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("min-h-11 rounded-full px-4 font-medium", tab === k ? "bg-matcha-700 text-white" : "border border-stone-300 bg-white/80")}>{l}</button>
        ))}
      </div>
      {tab === "overview" && <Overview initial={props.overview} from={props.from} to={props.to} />}
      {tab === "members" && <Members rows={props.members} templates={props.templates} />}
      {tab === "settings" && loyalty && <Settings loyalty={loyalty} tiers={props.tiers} templates={props.templates} isOwner={props.isOwner} />}
      {tab === "templates" && <Templates templates={props.templates} discounts={props.discounts} tiers={props.tiers} />}
      {tab === "keywords" && <Keywords rows={props.keywords} />}
    </div>
  );
}

/* ---------------- ภาพรวม / KPI ---------------- */
function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return <div className="rounded-2xl border border-stone-200 bg-white/80 p-3"><div className="text-xs text-stone-500">{label}</div><div className="tnum text-2xl font-bold">{value}</div>{hint && <div className="text-xs text-stone-500">{hint}</div>}</div>;
}

function Overview({ initial, from, to }: { initial: Json | null; from: string; to: string }) {
  const [f, setF] = useState(from); const [t, setT] = useState(to);
  const [o, setO] = useState<Record<string, unknown> | null>(initial);
  const [msg, setMsg] = useState<string | null>(null); const [pending, start] = useTransition();
  const n = (k: string) => Number(o?.[k] ?? 0);
  const load = () => start(async () => { const r = await getMembersOverview(f, t); if (r.ok) { setO(r.data as Json); setMsg(null); } else setMsg(r.error); });
  const reconcile = () => start(async () => { const r = await runReconcile(7); setMsg(r.ok ? `ประมวลผลย้อนหลัง ${r.data!.processed} ออเดอร์` : r.error); });
  const totalOrders = n("member_orders") + n("nonmember_orders");
  const tiers = (o?.tier_distribution as { name: string; members: number }[] | undefined) ?? [];
  const notif = (o?.notifications as Record<string, number> | undefined) ?? {};
  if (!o) return <Empty>ยังไม่มีข้อมูล (ตรวจสอบว่ารันไมเกรชันแล้ว)</Empty>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="จาก"><input type="date" className={inputCls} value={f} onChange={(e) => setF(e.target.value)} /></Field>
        <Field label="ถึง"><input type="date" className={inputCls} value={t} onChange={(e) => setT(e.target.value)} /></Field>
        <Button variant="primary" onClick={load} disabled={pending}>ดูรายงาน</Button>
        <Button onClick={reconcile} disabled={pending} title="ประมวลผลออเดอร์ 7 วันล่าสุดที่ยังไม่ผ่านระบบสมาชิก">ซ่อมออเดอร์ที่ตกหล่น (7 วัน)</Button>
      </div>
      {msg && <Notice tone="info">{msg}</Notice>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="สมาชิกทั้งหมด" value={n("total_members")} />
        <Stat label="ผูก LINE แล้ว" value={n("linked_members")} hint={n("total_members") ? `${Math.round((n("linked_members") / n("total_members")) * 100)}%` : undefined} />
        <Stat label="สมาชิกใหม่ในช่วง" value={n("new_members")} />
        <Stat label="สมาชิกที่ซื้อในช่วง" value={n("active_members")} />
        <Stat label="ซื้อซ้ำ (≥2 ออเดอร์)" value={n("repeat_members")} hint={n("active_members") ? `${Math.round((n("repeat_members") / n("active_members")) * 100)}% ของผู้ซื้อ` : undefined} />
        <Stat label="ยอดขายจากสมาชิก" value={formatBaht(n("member_sales_satang"))} hint={`${n("member_orders")} ออเดอร์`} />
        <Stat label="สัดส่วนออเดอร์สมาชิก" value={totalOrders ? `${Math.round((n("member_orders") / totalOrders) * 100)}%` : "—"} hint={`ไม่ใช่สมาชิก ${n("nonmember_orders")} ออเดอร์`} />
        <Stat label="เลื่อนระดับ" value={n("tier_upgrades")} />
        <Stat label="แต้มที่ออก" value={n("points_issued")} />
        <Stat label="แต้มที่ใช้แลก" value={n("points_redeemed")} />
        <Stat label="แต้มคงค้างทั้งระบบ" value={n("points_outstanding")} />
        <Stat label="คูปองออก / ใช้" value={`${n("coupons_issued")} / ${n("coupons_used")}`} hint={n("coupons_issued") ? `อัตราใช้ ${Math.round((n("coupons_used") / n("coupons_issued")) * 100)}%` : undefined} />
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white/80 p-3">
        <div className="mb-1 text-sm font-semibold">สมาชิกตามระดับ</div>
        <div className="flex flex-wrap gap-3 text-sm">{tiers.map((x) => <span key={x.name}>{x.name}: <b className="tnum">{x.members}</b></span>)}</div>
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white/80 p-3 text-sm">
        <div className="mb-1 font-semibold">การแจ้งเตือน LINE ในช่วง</div>
        {Object.keys(notif).length === 0 ? "—" : Object.entries(notif).map(([k, v]) => <span key={k} className="mr-3">{k}: <b className="tnum">{v}</b></span>)}
      </div>
    </div>
  );
}

/* ---------------- สมาชิก + รายละเอียด ---------------- */
interface Detail {
  member: MemberCard; tier: { current?: { name: string } | null };
  ledger: { currency: string; kind: string; amount: number; balance_after: number; note: string | null; created_at: string }[];
  coupons: { id: string; title: string; status: string; expires_at: string; source: string }[];
  orders: { id: string; order_no: number; created_at: string; total_satang: number; payment_status: string; points_earned: number; stamps_earned: number; via: string }[];
}

function Members({ rows, templates }: { rows: MemberRow[]; templates: Template[] }) {
  const [q, setQ] = useState(""); const [sel, setSel] = useState<string | null>(null);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.member_no} ${r.customers?.name ?? ""} ${r.customers?.phone ?? ""}`.toLowerCase().includes(s)) : rows;
  }, [rows, q]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <input className={inputCls} placeholder="ค้นหา ชื่อ / เบอร์ / เลขสมาชิก" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="mt-2 max-h-[65vh] divide-y divide-stone-200 overflow-auto rounded-2xl border border-stone-200 bg-white/80">
          {list.length === 0 && <li className="p-4 text-stone-500">ไม่พบสมาชิก</li>}
          {list.map((r) => (
            <li key={r.customer_id}>
              <button onClick={() => setSel(r.customer_id)} className={cn("flex min-h-14 w-full items-center justify-between gap-2 px-3 text-left active:bg-stone-100", sel === r.customer_id && "bg-matcha-50")}>
                <span className="min-w-0"><span className="block truncate font-medium">{r.customers?.name}</span><span className="block text-xs text-stone-500">{r.member_no} · {r.customers?.phone ?? "—"}</span></span>
                <span className="shrink-0 text-right text-xs"><Badge tone="neutral">{r.membership_tiers?.name ?? "—"}</Badge><span className="block tnum mt-1">{r.points_balance} แต้ม · {r.stamps_balance} ดวง</span></span>
              </button>
            </li>
          ))}
        </ul>
        {rows.length >= 300 && <p className="mt-1 text-xs text-stone-500">แสดง 300 รายล่าสุด — ใช้ช่องค้นหาที่หน้า POS สำหรับสมาชิกรายอื่น</p>}
      </div>
      <div>{sel ? <MemberDetail key={sel} id={sel} templates={templates} /> : <Empty>เลือกสมาชิกเพื่อดูรายละเอียด</Empty>}</div>
    </div>
  );
}

function MemberDetail({ id, templates }: { id: string; templates: Template[] }) {
  const [d, setD] = useState<Detail | null>(null); const [msg, setMsg] = useState<string | null>(null); const [pending, start] = useTransition();
  const [amount, setAmount] = useState(""); const [currency, setCurrency] = useState<"points" | "stamps">("points"); const [reason, setReason] = useState("");
  const [tpl, setTpl] = useState("");
  const load = () => start(async () => { const r = await getMemberDetail(id); if (r.ok) setD(r.data as unknown as Detail); else setMsg(r.error); });
  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok = "บันทึกแล้ว") => start(async () => { const r = await fn(); setMsg(r.ok ? ok : r.error ?? "ไม่สำเร็จ"); if (r.ok) load(); });
  if (!d) return <Empty>{msg ?? "กำลังโหลด…"}</Empty>;
  const m = d.member;
  const amt = Number(amount);
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-2xl border border-stone-200 bg-white/80 p-3">
        <div className="text-lg font-semibold">{m.name} <span className="text-stone-500">{m.member_no}</span></div>
        <div className="text-stone-600">{m.phone ?? "—"} · {m.tier_name} · {m.has_line ? "ผูก LINE แล้ว" : "ยังไม่ผูก LINE"} · {m.marketing_consent ? "ยินยอมการตลาด" : "ไม่รับการตลาด"}</div>
        <div className="mt-1"><b className="tnum">{m.points}</b> แต้ม · <b className="tnum">{m.stamps}</b> แสตมป์ (ตลอดชีพ {m.stamps_lifetime})</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {m.has_line && <Button size="sm" disabled={pending} onClick={() => { const r = window.prompt("เหตุผลที่เลิกผูก LINE (เช่น ลูกค้าเปลี่ยนบัญชี)"); if (r) run(() => unlinkLine({ customerId: id, reason: r }), "เลิกผูกแล้ว"); }}>เลิกผูก LINE</Button>}
          {!m.has_line && <ClaimQr purpose="link" customerId={id} label="QR ผูกบัญชี LINE" />}
          <Button size="sm" disabled={pending} onClick={() => { if (window.confirm("หมุน QR สมาชิก? QR เก่าทั้งหมดจะใช้ไม่ได้")) run(() => rotateMemberQr(id), "หมุน QR แล้ว"); }}>หมุน QR</Button>
        </div>
      </div>
      {msg && <Notice tone="info">{msg}</Notice>}
      <div className="rounded-2xl border border-stone-200 bg-white/80 p-3">
        <div className="mb-1 font-semibold">ปรับยอดด้วยมือ (บันทึกใน ledger พร้อมเหตุผล)</div>
        <div className="flex flex-wrap gap-2">
          <select className={cn(inputCls, "w-28")} value={currency} onChange={(e) => setCurrency(e.target.value as "points" | "stamps")}><option value="points">แต้ม</option><option value="stamps">แสตมป์</option></select>
          <input className={cn(inputCls, "w-24")} inputMode="numeric" placeholder="+/−" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className={cn(inputCls, "min-w-40 flex-1")} placeholder="เหตุผล (จำเป็น)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="primary" disabled={pending || !Number.isInteger(amt) || amt === 0 || !reason.trim()}
            onClick={() => run(() => adjustPoints({ customerId: id, currency, amount: amt, reason, key: newKey() }), "ปรับยอดแล้ว")}>บันทึก</Button>
        </div>
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white/80 p-3">
        <div className="mb-1 font-semibold">มอบคูปอง</div>
        <div className="flex gap-2">
          <select className={inputCls} value={tpl} onChange={(e) => setTpl(e.target.value)}><option value="">เลือกแม่แบบ…</option>{templates.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
          <Button variant="primary" disabled={pending || !tpl} onClick={() => run(() => issueCoupon({ customerId: id, templateId: tpl, key: newKey() }), "มอบคูปองแล้ว")}>มอบ</Button>
        </div>
        <ul className="mt-2 divide-y divide-stone-200">
          {d.coupons.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-1.5"><span className="min-w-0 truncate">{c.title} <span className="text-xs text-stone-500">· {c.status}</span></span>
              {c.status === "unused" && <Button size="sm" variant="danger" disabled={pending} onClick={() => { const r = window.prompt("เหตุผลที่ยกเลิกคูปอง"); if (r) run(() => cancelCoupon({ couponId: c.id, reason: r }), "ยกเลิกแล้ว"); }}>ยกเลิก</Button>}</li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white/80 p-3">
        <div className="mb-1 font-semibold">ประวัติแต้ม/แสตมป์ (ล่าสุด)</div>
        <ul className="max-h-48 divide-y divide-stone-200 overflow-auto">{d.ledger.map((l, i) => <li key={i} className="flex justify-between py-1"><span>{l.currency === "points" ? "แต้ม" : "แสตมป์"} · {l.kind}{l.note ? ` · ${l.note}` : ""}</span><b className="tnum">{l.amount > 0 ? "+" : ""}{l.amount}</b></li>)}</ul>
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white/80 p-3">
        <div className="mb-1 font-semibold">ออเดอร์ที่ผูกกับสมาชิก</div>
        <ul className="max-h-48 divide-y divide-stone-200 overflow-auto">{d.orders.map((o) => <li key={o.id} className="flex justify-between py-1"><span>#{o.order_no} · {o.via}{o.payment_status === "refunded" ? " · คืนเงิน" : ""}</span><span className="tnum">{formatBaht(o.total_satang)}</span></li>)}</ul>
      </div>
    </div>
  );
}

/* ---------------- ตั้งค่าโปรแกรม ---------------- */
function Settings({ loyalty, tiers, templates, isOwner }: { loyalty: Loyalty; tiers: Tier[]; templates: Template[]; isOwner: boolean }) {
  const router = useRouter();
  const [s, setS] = useState(loyalty); const [msg, setMsg] = useState<string | null>(null); const [pending, start] = useTransition();
  const set = <K extends keyof Loyalty>(k: K, v: Loyalty[K]) => setS((x) => ({ ...x, [k]: v }));
  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
  const save = () => start(async () => {
    const { membership_enabled, points_enabled, satang_per_point, earn_basis, tier_rolling_months, tier_downgrade_enabled, stamps_enabled, stamps_per_reward, stamp_station, stamp_reward_title, stamp_reward_expire_days, welcome_coupon_template_id, birthday_coupon_template_id, claim_qr_minutes, claim_order_window_hours, comeback_days, marketing_cap_days } = s;
    const r = await saveLoyaltySettings({ membership_enabled, points_enabled, satang_per_point, earn_basis: earn_basis as never, tier_rolling_months, tier_downgrade_enabled, stamps_enabled, stamps_per_reward, stamp_station: stamp_station as never, stamp_reward_title, stamp_reward_expire_days, welcome_coupon_template_id, birthday_coupon_template_id, claim_qr_minutes, claim_order_window_hours, comeback_days, marketing_cap_days });
    setMsg(r.ok ? "บันทึกแล้ว" : r.error); if (r.ok) router.refresh();
  });
  const Check = ({ k, label }: { k: keyof Loyalty; label: string }) => (
    <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-5 accent-matcha-700" disabled={!isOwner} checked={Boolean(s[k])} onChange={(e) => set(k, e.target.checked as never)} />{label}</label>
  );
  const Num = ({ k, label, hint, nullable }: { k: keyof Loyalty; label: string; hint?: string; nullable?: boolean }) => (
    <Field label={label} hint={hint}><input className={inputCls} inputMode="numeric" disabled={!isOwner} value={s[k] === null ? "" : String(s[k])} onChange={(e) => set(k, (nullable ? numOrNull(e.target.value) : Number(e.target.value)) as never)} /></Field>
  );
  const tplOpts = (src: string) => templates.filter((t) => t.active && t.source === src);
  return (
    <div className="space-y-4">
      {!isOwner && <Notice tone="info">ดูได้อย่างเดียว — เฉพาะเจ้าของร้านแก้การตั้งค่าโปรแกรมได้</Notice>}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1 rounded-2xl border border-stone-200 bg-white/80 p-4">
          <h3 className="font-semibold">สวิตช์หลัก</h3>
          <Check k="membership_enabled" label="เปิดระบบสมาชิก (ปิด = ขายปกติ ไม่ให้แต้ม/แสตมป์/ระดับ)" />
          <Check k="points_enabled" label="เปิดระบบแต้ม" />
          <Num k="satang_per_point" label="ซื้อทุกกี่สตางค์ = 1 แต้ม" hint="เช่น 1000 = ทุก 10 บาท ได้ 1 แต้ม · เว้นว่าง = ยังไม่กำหนด (จะเปิดระบบแต้มไม่ได้)" nullable />
          <Field label="คำนวณแต้มจากยอด"><select className={inputCls} disabled={!isOwner} value={String(s.earn_basis)} onChange={(e) => set("earn_basis", e.target.value)}><option value="net_after_discount">ยอดสุทธิหลังหักส่วนลด</option><option value="gross_before_discount">ยอดก่อนหักส่วนลด</option></select></Field>
        </div>
        <div className="space-y-1 rounded-2xl border border-stone-200 bg-white/80 p-4">
          <h3 className="font-semibold">แสตมป์ (โปรแกรมเดิมของ LINE OA)</h3>
          <Check k="stamps_enabled" label="เปิดแสตมป์ (1 รายการที่สถานีเลือก = 1 ดวง)" />
          <Num k="stamps_per_reward" label="สะสมครบกี่ดวงได้รางวัล" />
          <Field label="สถานีที่นับแสตมป์"><select className={inputCls} disabled={!isOwner} value={String(s.stamp_station)} onChange={(e) => set("stamp_station", e.target.value)}><option value="drink">เครื่องดื่ม</option><option value="cake">เค้ก</option></select></Field>
          <Field label="ชื่อรางวัล"><input className={inputCls} disabled={!isOwner} value={String(s.stamp_reward_title)} maxLength={120} onChange={(e) => set("stamp_reward_title", e.target.value)} /></Field>
          <Num k="stamp_reward_expire_days" label="คูปองรางวัลหมดอายุใน (วัน)" />
        </div>
        <div className="space-y-1 rounded-2xl border border-stone-200 bg-white/80 p-4">
          <h3 className="font-semibold">ระดับสมาชิก</h3>
          <Num k="tier_rolling_months" label="นับยอดซื้อย้อนหลัง (เดือน)" />
          <Check k="tier_downgrade_enabled" label="ลดระดับอัตโนมัติเมื่อยอดย้อนหลังไม่ถึง" />
        </div>
        <div className="space-y-1 rounded-2xl border border-stone-200 bg-white/80 p-4">
          <h3 className="font-semibold">แคมเปญ / QR / การแจ้งเตือน</h3>
          <Field label="คูปองต้อนรับ"><select className={inputCls} disabled={!isOwner} value={s.welcome_coupon_template_id ?? ""} onChange={(e) => set("welcome_coupon_template_id", (e.target.value || null) as never)}><option value="">— ไม่มี —</option>{tplOpts("welcome").map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></Field>
          <Field label="คูปองวันเกิด"><select className={inputCls} disabled={!isOwner} value={s.birthday_coupon_template_id ?? ""} onChange={(e) => set("birthday_coupon_template_id", (e.target.value || null) as never)}><option value="">— ไม่มี —</option>{tplOpts("birthday").map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></Field>
          <Num k="comeback_days" label="Come Back: ไม่มาซื้อเกินกี่วันให้ส่งข้อความ" hint="เว้นว่าง = ปิดแคมเปญ" nullable />
          <Num k="marketing_cap_days" label="ข้อความการตลาดต่อคน ห่างกันอย่างน้อย (วัน)" />
          <Num k="claim_qr_minutes" label="QR ผูก/รับแต้ม ใช้ได้ (นาที)" />
          <Num k="claim_order_window_hours" label="รับแต้มย้อนหลังได้ภายใน (ชั่วโมงหลังชำระ)" />
        </div>
      </div>
      {msg && <Notice tone="info">{msg}</Notice>}
      {isOwner && <div className="flex justify-end"><Button variant="primary" size="lg" disabled={pending} onClick={save}>{pending ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}</Button></div>}
      <h3 className="font-semibold">ระดับ (Tier)</h3>
      <div className="grid gap-3 md:grid-cols-3">{tiers.map((t) => <TierCard key={t.id} tier={t} isOwner={isOwner} />)}</div>
    </div>
  );
}

function TierCard({ tier, isOwner }: { tier: Tier; isOwner: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(tier.name);
  const [min, setMin] = useState(tier.min_rolling_spend_satang === null ? "" : String(tier.min_rolling_spend_satang / 100));
  const [benefits, setBenefits] = useState(tier.benefits.join("\n"));
  const [active, setActive] = useState(tier.active);
  const [msg, setMsg] = useState<string | null>(null); const [pending, start] = useTransition();
  const save = () => start(async () => {
    const baht = min.trim() === "" ? null : Number(min);
    if (baht !== null && (!Number.isFinite(baht) || baht < 0)) { setMsg("ยอดไม่ถูกต้อง"); return; }
    const r = await saveTier({ id: tier.id, name, minRollingSpendSatang: baht === null ? null : Math.round(baht * 100), benefits: benefits.split("\n").map((x) => x.trim()).filter(Boolean), active });
    setMsg(r.ok ? "บันทึกแล้ว" : r.error); if (r.ok) router.refresh();
  });
  return (
    <div className="space-y-2 rounded-2xl border border-stone-200 bg-white/80 p-3 text-sm">
      <div className="text-xs text-stone-500">{tier.code}</div>
      <input className={inputCls} disabled={!isOwner} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      <Field label="ยอดซื้อสะสมย้อนหลังที่ต้องถึง (บาท)" hint="เว้นว่าง = ยังไม่กำหนด (เลื่อนอัตโนมัติไม่ได้)"><input className={inputCls} inputMode="decimal" disabled={!isOwner} value={min} onChange={(e) => setMin(e.target.value)} /></Field>
      <Field label="สิทธิประโยชน์ (บรรทัดละข้อ)"><textarea className={inputCls} rows={3} disabled={!isOwner} value={benefits} onChange={(e) => setBenefits(e.target.value)} /></Field>
      <label className="flex items-center gap-2"><input type="checkbox" className="size-5 accent-matcha-700" disabled={!isOwner} checked={active} onChange={(e) => setActive(e.target.checked)} />เปิดใช้งาน</label>
      {msg && <div className="text-xs">{msg}</div>}
      {isOwner && <Button size="sm" variant="primary" disabled={pending} onClick={save}>บันทึกระดับ</Button>}
    </div>
  );
}

/* ---------------- แม่แบบคูปอง/รางวัล ---------------- */
const SOURCES: [string, string][] = [["reward", "รางวัลแลกแต้ม"], ["promotion", "โปรโมชัน"], ["birthday", "วันเกิด"], ["welcome", "ต้อนรับ"], ["holiday", "เทศกาล"], ["manual", "พนักงานมอบ"]];
const blank = { id: null as string | null, title: "", description: "", source: "reward", discountId: "", pointCost: "", minSpend: "", expireDays: "30", quantityLimit: "", active: true };

function Templates({ templates, discounts, tiers }: { templates: Template[]; discounts: Discount[]; tiers: Tier[] }) {
  void tiers;
  const router = useRouter();
  const [f, setF] = useState(blank); const [msg, setMsg] = useState<string | null>(null); const [pending, start] = useTransition();
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const edit = (t: Template) => setF({ id: t.id, title: t.title, description: t.description ?? "", source: t.source, discountId: t.discount_id ?? "", pointCost: t.point_cost?.toString() ?? "", minSpend: t.min_spend_satang ? String(t.min_spend_satang / 100) : "", expireDays: t.expire_days?.toString() ?? "", quantityLimit: t.quantity_limit?.toString() ?? "", active: t.active });
  const save = () => start(async () => {
    const minSpend = num(f.minSpend);
    const r = await saveCouponTemplate({
      id: f.id, title: f.title, description: f.description.trim() || null, source: f.source as never, discountId: f.discountId || null,
      pointCost: num(f.pointCost), minSpendSatang: minSpend === null ? null : Math.round(minSpend * 100), expireDays: num(f.expireDays), expireAt: null,
      quantityLimit: num(f.quantityLimit), active: f.active,
    });
    setMsg(r.ok ? "บันทึกแล้ว" : r.error); if (r.ok) { setF(blank); router.refresh(); }
  });
  const dName = (id: string | null) => discounts.find((d) => d.id === id)?.name;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2 rounded-2xl border border-stone-200 bg-white/80 p-4 text-sm">
        <h3 className="font-semibold">{f.id ? "แก้ไขแม่แบบ" : "สร้างแม่แบบใหม่"}</h3>
        <Field label="ชื่อ"><input className={inputCls} value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="รายละเอียด"><input className={inputCls} value={f.description} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="ประเภท"><select className={inputCls} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="ส่วนลด (จากรายการส่วนลดของร้าน)" hint="ไม่เลือก = สิทธิ์ที่พนักงานมอบที่เคาน์เตอร์ (เช่น เครื่องดื่มฟรี)"><select className={inputCls} value={f.discountId} onChange={(e) => setF({ ...f, discountId: e.target.value })}><option value="">— ไม่มี (ของแถม/สิทธิ์) —</option>{discounts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="แต้มที่ใช้แลก" hint="ว่าง = แลกด้วยแต้มไม่ได้"><input className={inputCls} inputMode="numeric" value={f.pointCost} onChange={(e) => setF({ ...f, pointCost: e.target.value })} /></Field>
          <Field label="ยอดซื้อขั้นต่ำ (บาท)"><input className={inputCls} inputMode="decimal" value={f.minSpend} onChange={(e) => setF({ ...f, minSpend: e.target.value })} /></Field>
          <Field label="หมดอายุหลังได้รับ (วัน)"><input className={inputCls} inputMode="numeric" value={f.expireDays} onChange={(e) => setF({ ...f, expireDays: e.target.value })} /></Field>
          <Field label="จำกัดจำนวนสิทธิ์ทั้งหมด"><input className={inputCls} inputMode="numeric" value={f.quantityLimit} onChange={(e) => setF({ ...f, quantityLimit: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" className="size-5 accent-matcha-700" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />เปิดใช้งาน</label>
        {msg && <Notice tone="info">{msg}</Notice>}
        <div className="flex justify-end gap-2">{f.id && <Button onClick={() => setF(blank)}>ยกเลิกแก้ไข</Button>}<Button variant="primary" disabled={pending || !f.title.trim()} onClick={save}>บันทึก</Button></div>
      </div>
      <ul className="max-h-[75vh] divide-y divide-stone-200 overflow-auto rounded-2xl border border-stone-200 bg-white/80">
        {templates.length === 0 && <li className="p-4 text-stone-500">ยังไม่มีแม่แบบ</li>}
        {templates.map((t) => (
          <li key={t.id} className="flex items-start justify-between gap-2 p-3 text-sm">
            <div className="min-w-0"><div className="font-medium">{t.title} {!t.active && <Badge tone="neutral">ปิด</Badge>}</div>
              <div className="text-xs text-stone-500">{SOURCES.find(([k]) => k === t.source)?.[1]} · {dName(t.discount_id) ?? "สิทธิ์/ของแถม"}{t.point_cost ? ` · ${t.point_cost} แต้ม` : ""}{t.expire_days ? ` · ${t.expire_days} วัน` : ""}</div></div>
            <Button size="sm" onClick={() => edit(t)}>แก้ไข</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Keyword แชตบอท ---------------- */
function Keywords({ rows }: { rows: Keyword[] }) {
  const router = useRouter();
  const [f, setF] = useState({ id: null as string | null, keyword: "", responseText: "", active: true });
  const [msg, setMsg] = useState<string | null>(null); const [pending, start] = useTransition();
  const save = () => start(async () => { const r = await saveKeyword(f); setMsg(r.ok ? "บันทึกแล้ว" : r.error); if (r.ok) { setF({ id: null, keyword: "", responseText: "", active: true }); router.refresh(); } });
  const del = (id: string) => { if (window.confirm("ลบคำนี้?")) start(async () => { const r = await deleteKeyword(id); setMsg(r.ok ? "ลบแล้ว" : r.error); if (r.ok) router.refresh(); }); };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2 rounded-2xl border border-stone-200 bg-white/80 p-4 text-sm">
        <Notice tone="info">แชตบอทจับคำตามข้อความที่ตั้งไว้ (ไม่ใช่ AI) — คำว่า “บัตรสมาชิก, แต้ม, คูปอง, แลกรางวัล” ถูกสงวนไว้ให้ดึงข้อมูลสมาชิกจริง</Notice>
        <Field label="คำที่ลูกค้าพิมพ์"><input className={inputCls} value={f.keyword} maxLength={100} onChange={(e) => setF({ ...f, keyword: e.target.value })} /></Field>
        <Field label="ข้อความตอบกลับ"><textarea className={inputCls} rows={4} value={f.responseText} maxLength={2000} onChange={(e) => setF({ ...f, responseText: e.target.value })} /></Field>
        <label className="flex items-center gap-2"><input type="checkbox" className="size-5 accent-matcha-700" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />เปิดใช้งาน</label>
        {msg && <Notice tone="info">{msg}</Notice>}
        <div className="flex justify-end"><Button variant="primary" disabled={pending || !f.keyword.trim() || !f.responseText.trim()} onClick={save}>{f.id ? "บันทึกการแก้ไข" : "เพิ่มคำ"}</Button></div>
      </div>
      <ul className="max-h-[70vh] divide-y divide-stone-200 overflow-auto rounded-2xl border border-stone-200 bg-white/80">
        {rows.length === 0 && <li className="p-4 text-stone-500">ยังไม่มีคำ</li>}
        {rows.map((k) => (
          <li key={k.id} className="flex items-start justify-between gap-2 p-3 text-sm">
            <div className="min-w-0"><div className="font-medium">{k.keyword} {!k.active && <Badge tone="neutral">ปิด</Badge>}</div><div className="line-clamp-2 text-xs text-stone-500">{k.response_text}</div></div>
            <div className="flex shrink-0 gap-1"><Button size="sm" onClick={() => setF({ id: k.id, keyword: k.keyword, responseText: k.response_text, active: k.active })}>แก้ไข</Button><Button size="sm" variant="danger" onClick={() => del(k.id)}>ลบ</Button></div>
          </li>
        ))}
      </ul>
    </div>
  );
}
