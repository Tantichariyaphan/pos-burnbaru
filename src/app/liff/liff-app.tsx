"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { QrCode } from "@/components/qr-code";
import { formatBaht } from "@/lib/money";

/* ---------- ชนิดข้อมูลที่ได้จาก /api/liff/* (ตรงกับฟังก์ชัน liff_* ในฐานข้อมูล) ---------- */
interface MCard {
  member_no: string; name: string; phone: string | null; birthday: string | null; tier_code: string | null; tier_name: string | null;
  points: number; stamps: number; stamps_lifetime: number; marketing_consent: boolean; privacy_accepted: boolean;
}
interface Tier { rolling_spend_satang: number; months: number; current: { name: string } | null; next: { name: string; min_satang: number; remaining_satang: number } | null }
interface Me {
  linked: boolean; membership_enabled: boolean; member?: MCard; tier?: Tier; coupons_available?: number;
  settings?: { points_enabled: boolean; stamps_enabled: boolean; stamps_per_reward: number };
}
interface Api<T> { success: boolean; data?: T; code?: string; message?: string }

type Tab = "home" | "coupons" | "history" | "journey" | "profile";
const TABS: [Tab, string][] = [["home", "บัตร"], ["coupons", "คูปอง"], ["history", "ประวัติ"], ["journey", "เส้นทาง"], ["profile", "โปรไฟล์"]];

interface LiffSdk {
  init(c: { liffId: string }): Promise<void>; isLoggedIn(): boolean; login(c?: { redirectUri?: string }): void;
  getIDToken(): string | null; isInClient(): boolean; closeWindow(): void;
}
declare global { interface Window { liff?: LiffSdk } }

function loadSdk(): Promise<LiffSdk> {
  return new Promise((resolve, reject) => {
    if (window.liff) return resolve(window.liff);
    const s = document.createElement("script");
    s.src = "https://static.line-scdn.net/liff/edge/2/sdk.js";
    s.async = true;
    s.onload = () => (window.liff ? resolve(window.liff) : reject(new Error("LIFF SDK ไม่พร้อมใช้งาน")));
    s.onerror = () => reject(new Error("โหลด LIFF SDK ไม่ได้ ตรวจสอบอินเทอร์เน็ต"));
    document.head.appendChild(s);
  });
}

function claimTokenFromUrl(): string | null {
  const u = new URL(window.location.href);
  const direct = u.searchParams.get("claim");
  if (direct) return direct;
  const state = u.searchParams.get("liff.state");           // LIFF ส่งพารามิเตอร์เดิมมาใน liff.state
  if (state) { try { return new URLSearchParams(state.replace(/^\/?\?/, "")).get("claim"); } catch { return null; } }
  return null;
}

export function LiffApp({ liffId }: { liffId: string }) {
  const [phase, setPhase] = useState<"boot" | "ready" | "error">("boot");
  const [error, setError] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [claim, setClaim] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sdk = useRef<LiffSdk | null>(null);

  const api = useCallback(async <T,>(action: string, body: unknown = {}): Promise<Api<T>> => {
    const l = sdk.current;
    const token = l?.getIDToken();
    if (!l || !token) { l?.login(); return { success: false, code: "NOT_AUTHENTICATED", message: "กรุณาเข้าสู่ระบบอีกครั้ง" }; }
    try {
      const res = await fetch(`/api/liff/${action}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body), cache: "no-store" });
      const j = (await res.json()) as Api<T>;
      if (res.status === 401) l.login();                      // ID token หมดอายุ → เข้าสู่ระบบใหม่
      return j;
    } catch { return { success: false, code: "NETWORK", message: "เชื่อมต่อไม่ได้ กรุณาลองใหม่" }; }
  }, []);

  const refresh = useCallback(async () => {
    const r = await api<Me>("me");
    if (r.success && r.data) setMe(r.data); else if (r.code !== "NOT_AUTHENTICATED") { setError(r.message ?? "โหลดข้อมูลไม่ได้"); setPhase("error"); }
  }, [api]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (!liffId) throw new Error("ยังไม่ได้ตั้งค่า NEXT_PUBLIC_LIFF_ID");
        const l = await loadSdk();
        await l.init({ liffId });
        if (!l.isLoggedIn()) { l.login(); return; }
        sdk.current = l;
        if (!alive) return;
        setClaim(claimTokenFromUrl());
        await refresh();
        if (alive) setPhase("ready");
      } catch (e) { if (alive) { setError(e instanceof Error ? e.message : "เริ่มต้นไม่สำเร็จ"); setPhase("error"); } }
    })();
    return () => { alive = false; };
  }, [liffId, refresh]);

  if (phase === "boot") return <Shell><p className="py-24 text-center text-bb-caramel">กำลังโหลด…</p></Shell>;
  if (phase === "error") return <Shell><div className="m-4 rounded-2xl bg-white p-4 text-bb-burgundy">{error}</div></Shell>;
  if (!me) return <Shell><p className="py-24 text-center">กำลังโหลด…</p></Shell>;
  if (!me.membership_enabled) return <Shell><div className="m-4 rounded-2xl bg-white p-6 text-center">ระบบสมาชิกยังไม่เปิดให้บริการ เร็ว ๆ นี้ค่ะ</div></Shell>;

  if (claim || !me.linked) {
    return (
      <Shell>
        <ClaimOrRegister api={api} claim={claim} linked={me.linked}
          onDone={async (msg) => { setClaim(null); setNotice(msg); window.history.replaceState(null, "", window.location.pathname); await refresh(); }} />
      </Shell>
    );
  }

  return (
    <Shell>
      {notice && <button className="mx-4 mt-3 block w-[calc(100%-2rem)] rounded-xl bg-bb-gold/30 px-3 py-2 text-left text-sm" onClick={() => setNotice(null)}>{notice} ✕</button>}
      <main className="px-4 pb-28 pt-3">
        {tab === "home" && <Home me={me} api={api} />}
        {tab === "coupons" && <Coupons api={api} onChanged={refresh} />}
        {tab === "history" && <History api={api} settings={me.settings} />}
        {tab === "journey" && <Journey api={api} />}
        {tab === "profile" && <Profile me={me} api={api} onChanged={refresh} />}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-bb-burgundy/15 bg-bb-cream pb-[env(safe-area-inset-bottom)]">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} aria-current={tab === k} className={`min-h-14 flex-1 text-sm font-medium ${tab === k ? "text-bb-burgundy" : "text-bb-espresso/60"}`}>
            <span className={`block border-t-2 pt-2 ${tab === k ? "border-bb-burgundy" : "border-transparent"}`}>{label}</span>
          </button>
        ))}
      </nav>
    </Shell>
  );
}

type CallApi = <T>(action: string, body?: unknown) => Promise<Api<T>>;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bb-cream text-bb-espresso">
      <header className="bg-bb-burgundy px-4 py-3 text-bb-butter">
        <div className="text-lg font-extrabold tracking-wide">BURN BARU CLUB</div>
        <div className="text-xs opacity-80">Grandfa Farm Cafe</div>
      </header>
      {children}
    </div>
  );
}

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <section className={`mb-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-bb-burgundy/10 ${className}`}>{children}</section>
);
const dt = (v: string | null) => (v ? new Date(v).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit" }) : "");

/* ---------- สมัคร / รับสิทธิ์จาก QR ---------- */
function ClaimOrRegister({ api, claim, linked, onDone }: { api: CallApi; claim: string | null; linked: boolean; onDone: (msg: string) => Promise<void> }) {
  const [needForm, setNeedForm] = useState(!claim);
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [birthday, setBirthday] = useState("");
  const [privacy, setPrivacy] = useState(false); const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const tried = useRef(false);

  const doClaim = useCallback(async (withForm: boolean) => {
    setBusy(true); setErr(null);
    const body = withForm ? { token: claim, name, phone, birthday: birthday || null, privacy, marketing } : { token: claim };
    const r = await api<{ points?: number; registered?: boolean }>("claim", body);
    setBusy(false);
    if (r.success) { await onDone(r.data?.points ? `รับแต้มย้อนหลัง +${r.data.points} แต้มแล้ว` : "เรียบร้อยแล้วค่ะ"); return; }
    if (r.code === "REGISTRATION_REQUIRED") { setNeedForm(true); return; }
    setErr(r.message ?? "ทำรายการไม่สำเร็จ");
  }, [api, claim, name, phone, birthday, privacy, marketing, onDone]);

  // มี QR: ลองรับสิทธิ์ทันที (ถ้าสมาชิกอยู่แล้ว สำเร็จเลย; ถ้ายังไม่เป็นสมาชิกจะขอข้อมูลสมัคร)
  useEffect(() => { if (claim && !tried.current) { tried.current = true; void doClaim(false); } }, [claim, doClaim]);

  const submitRegister = async () => {
    if (claim) return doClaim(true);
    setBusy(true); setErr(null);
    const r = await api("register", { name, phone, birthday: birthday || null, privacy, marketing });
    setBusy(false);
    if (r.success) await onDone("ยินดีต้อนรับสู่ BURN BARU CLUB 🔥");
    else if (r.code === "PHONE_ALREADY_MEMBER" || r.code === "PHONE_EXISTS_ASK_STAFF") setErr("เบอร์นี้มีในระบบของร้านแล้ว แต่ยังไม่ได้ผูกกับ LINE นี้ กรุณาแจ้งพนักงานที่เคาน์เตอร์ ให้แสดง QR ผูก LINE แล้วสแกนด้วยกล้อง LINE ค่ะ");
    else setErr(r.message ?? "สมัครไม่สำเร็จ");
  };

  if (!needForm) return <p className="py-24 text-center">กำลังตรวจสอบ QR…{err && <span className="mt-3 block text-bb-burgundy">{err}</span>}</p>;
  return (
    <div className="p-4">
      <h1 className="mb-1 text-xl font-bold text-bb-burgundy">{linked ? "รับสิทธิ์" : "สมัครสมาชิก"}</h1>
      <p className="mb-3 text-sm text-bb-espresso/70">สะสมแต้ม แสตมป์ และรับสิทธิ์พิเศษจากร้าน</p>
      <Card>
        <Input label="ชื่อ" value={name} onChange={setName} max={100} />
        <Input label="เบอร์โทร" value={phone} onChange={setPhone} max={20} type="tel" />
        <Input label="วันเกิด (ไม่บังคับ — ตั้งแล้วแก้เองไม่ได้ ใช้รับของขวัญวันเกิด)" value={birthday} onChange={setBirthday} type="date" />
        <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-5 accent-bb-burgundy" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />ฉันรับทราบและยอมรับนโยบายความเป็นส่วนตัว และยินยอมให้ร้านเก็บข้อมูลเพื่อให้บริการสมาชิก (จำเป็น)</label>
        <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-5 accent-bb-burgundy" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />ยินยอมรับข่าวสารและโปรโมชันทาง LINE (ไม่บังคับ ถอนได้ทุกเมื่อ)</label>
        {err && <p className="mt-2 text-sm text-bb-burgundy" role="alert">{err}</p>}
        <button disabled={busy || !privacy || !name.trim() || !phone.trim()} onClick={submitRegister} className="mt-4 min-h-12 w-full rounded-xl bg-bb-burgundy font-semibold text-bb-butter disabled:opacity-40">{busy ? "กำลังบันทึก…" : "ยืนยัน"}</button>
      </Card>
    </div>
  );
}

function Input({ label, value, onChange, max, type = "text" }: { label: string; value: string; onChange: (v: string) => void; max?: number; type?: string }) {
  return (
    <label className="mb-2 block text-sm"><span className="mb-1 block font-medium">{label}</span>
      <input className="min-h-11 w-full rounded-xl border border-bb-burgundy/25 bg-bb-cream px-3" type={type} value={value} maxLength={max} inputMode={type === "tel" ? "tel" : undefined} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/* ---------- หน้าหลัก: บัตร + QR + ระดับ ---------- */
function Home({ me, api }: { me: Me; api: CallApi }) {
  const m = me.member!;
  const [qr, setQr] = useState<{ value: string; expires_at: number } | null>(null);
  const [qrErr, setQrErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true; let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const r = await api<{ value: string; expires_at: number }>("qr");
      if (!alive) return;
      if (r.success && r.data) { setQr(r.data); setQrErr(null); timer = setTimeout(load, Math.max(10_000, r.data.expires_at - Date.now() - 15_000)); }
      else { setQrErr(r.message ?? "สร้าง QR ไม่ได้"); timer = setTimeout(load, 30_000); }
    };
    void load();
    return () => { alive = false; clearTimeout(timer); };
  }, [api]);

  const t = me.tier;
  const pct = t?.next ? Math.min(100, Math.round((t.rolling_spend_satang / t.next.min_satang) * 100)) : 100;
  const S = me.settings;
  return (
    <>
      <section className="mb-3 rounded-3xl bg-bb-burgundy p-5 text-bb-butter shadow-md">
        <div className="flex items-start justify-between">
          <div><div className="text-xs opacity-75">สมาชิก</div><div className="text-xl font-bold">{m.name}</div><div className="text-sm opacity-80">{m.member_no}</div></div>
          <span className="rounded-full bg-bb-gold px-3 py-1 text-xs font-bold text-bb-espresso">{m.tier_name}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-center">
          {S?.points_enabled && <div className="rounded-xl bg-white/10 py-2"><div className="tnum text-2xl font-extrabold">{m.points}</div><div className="text-xs opacity-80">แต้มสะสม</div></div>}
          {S?.stamps_enabled && <div className="rounded-xl bg-white/10 py-2"><div className="tnum text-2xl font-extrabold">{m.stamps}/{S.stamps_per_reward}</div><div className="text-xs opacity-80">แสตมป์</div></div>}
        </div>
      </section>
      <Card className="text-center">
        <div className="mb-2 text-sm font-medium">แสดง QR นี้ให้พนักงานสแกนตอนชำระเงิน</div>
        {qr ? <div className="mx-auto w-fit"><QrCode value={qr.value} size={220} label="QR สมาชิก" /></div> : <div className="grid size-56 place-items-center text-sm">{qrErr ?? "กำลังสร้าง QR…"}</div>}
        <div className="mt-2 text-xs text-bb-espresso/60">QR เปลี่ยนอัตโนมัติ — ภาพที่แคปไว้ใช้ไม่ได้</div>
      </Card>
      {t && (
        <Card>
          <div className="flex justify-between text-sm"><span className="font-semibold">ระดับ {t.current?.name ?? m.tier_name}</span><span className="text-bb-espresso/60">ยอดสะสม {t.months} เดือน {formatBaht(t.rolling_spend_satang)}</span></div>
          {t.next ? (<>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-bb-butter"><div className="h-full bg-bb-gold" style={{ width: `${pct}%` }} /></div>
            <div className="mt-1 text-xs text-bb-espresso/70">อีก {formatBaht(t.next.remaining_satang)} เป็น {t.next.name}</div>
          </>) : <div className="mt-1 text-xs text-bb-espresso/70">คุณอยู่ระดับสูงสุดที่เปิดให้บริการแล้ว</div>}
        </Card>
      )}
      <Card><div className="text-sm">คูปองที่ใช้ได้ <b className="tnum">{me.coupons_available ?? 0}</b> ใบ</div></Card>
    </>
  );
}

/* ---------- คูปอง + แลกรางวัล ---------- */
interface CouponRow { code: string; title: string; description: string | null; status: string; expires_at: string; used_at: string | null; discount: { name: string } | null }
interface RewardRow { id: string; title: string; description: string | null; point_cost: number; min_tier_name: string | null; tier_ok: boolean }

function useSection<T>(api: CallApi, section: string): [T | null, string | null, () => void] {
  const [data, setData] = useState<T | null>(null); const [err, setErr] = useState<string | null>(null); const [n, setN] = useState(0);
  useEffect(() => { let alive = true; void api<T>("section", { section, limit: 50 }).then((r) => { if (!alive) return; if (r.success) { setData(r.data ?? null); setErr(null); } else setErr(r.message ?? "โหลดไม่ได้"); }); return () => { alive = false; }; }, [api, section, n]);
  return [data, err, () => setN((x) => x + 1)];
}

function Coupons({ api, onChanged }: { api: CallApi; onChanged: () => Promise<void> }) {
  const [coupons, e1, reloadC] = useSection<CouponRow[]>(api, "coupons");
  const [rewards, e2, reloadR] = useSection<RewardRow[]>(api, "rewards");
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const claim = async (r: RewardRow) => {
    if (!window.confirm(`แลก “${r.title}” ด้วย ${r.point_cost} แต้ม?`)) return;
    setBusy(r.id); setMsg(null);
    const key = `${r.id}:${crypto.randomUUID()}`;
    const res = await api("reward-claim", { templateId: r.id, key });
    setBusy(null); setMsg(res.success ? "แลกสำเร็จ ✓" : res.message ?? "แลกไม่สำเร็จ");
    if (res.success) { reloadC(); reloadR(); await onChanged(); }
  };
  return (
    <>
      <h2 className="mb-2 font-bold text-bb-burgundy">คูปองของฉัน</h2>
      {(e1 || e2) && <Card>{e1 ?? e2}</Card>}
      {coupons?.length === 0 && <Card><span className="text-sm text-bb-espresso/70">ยังไม่มีคูปอง</span></Card>}
      {coupons?.map((c) => (
        <Card key={c.code} className={c.status === "unused" ? "" : "opacity-60"}>
          <div className="flex justify-between gap-2"><b>{c.title}</b><span className="text-xs">{c.status === "unused" ? "ใช้ได้" : c.status === "used" ? "ใช้แล้ว" : c.status === "expired" ? "หมดอายุ" : "ยกเลิก"}</span></div>
          {c.description && <div className="text-sm text-bb-espresso/70">{c.description}</div>}
          <div className="mt-1 text-xs text-bb-espresso/60">{c.status === "used" ? `ใช้เมื่อ ${dt(c.used_at)}` : `ใช้ได้ถึง ${dt(c.expires_at)}`} · แสดงให้พนักงานดูตอนชำระ</div>
        </Card>
      ))}
      {rewards && rewards.length > 0 && <h2 className="mb-2 mt-4 font-bold text-bb-burgundy">แลกรางวัลด้วยแต้ม</h2>}
      {msg && <div className="mb-2 rounded-xl bg-bb-gold/30 px-3 py-2 text-sm" role="status">{msg}</div>}
      {rewards?.map((r) => (
        <Card key={r.id}>
          <div className="flex items-start justify-between gap-3">
            <div><b>{r.title}</b>{r.description && <div className="text-sm text-bb-espresso/70">{r.description}</div>}{r.min_tier_name && <div className="text-xs text-bb-caramel">สำหรับระดับ {r.min_tier_name}</div>}</div>
            <button disabled={!r.tier_ok || busy === r.id} onClick={() => claim(r)} className="min-h-11 shrink-0 rounded-xl bg-bb-burgundy px-4 text-sm font-semibold text-bb-butter disabled:opacity-40">{busy === r.id ? "…" : `${r.point_cost} แต้ม`}</button>
          </div>
        </Card>
      ))}
    </>
  );
}

/* ---------- ประวัติ ---------- */
interface LedgerRow { kind: string; amount: number; balance_after: number; created_at: string }
interface OrderRow { order_no: number; created_at: string; total_satang: number; payment_status: string; points_earned: number; stamps_earned: number; items: { name: string; quantity: number }[] }
const KIND: Record<string, string> = { EARN: "ได้รับ", REDEEM: "ใช้แลก", REFUND_REVERSAL: "คืนเงิน (หักคืน)", EXPIRE: "หมดอายุ", ADMIN_ADJUSTMENT: "ปรับโดยร้าน", CAMPAIGN_BONUS: "โบนัสแคมเปญ" };

function History({ api, settings }: { api: CallApi; settings?: Me["settings"] }) {
  const [view, setView] = useState<"orders" | "points" | "stamps">("orders");
  const [rows, err] = useSection<LedgerRow[] | OrderRow[]>(api, view);
  return (
    <>
      <div className="mb-3 flex gap-2">
        {([["orders", "การซื้อ"], ...(settings?.points_enabled ? [["points", "แต้ม"]] : []), ...(settings?.stamps_enabled ? [["stamps", "แสตมป์"]] : [])] as [typeof view, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} className={`min-h-10 rounded-full px-4 text-sm ${view === k ? "bg-bb-burgundy text-bb-butter" : "bg-white ring-1 ring-bb-burgundy/20"}`}>{l}</button>
        ))}
      </div>
      {err && <Card>{err}</Card>}
      {rows?.length === 0 && <Card><span className="text-sm">ยังไม่มีรายการ</span></Card>}
      {view === "orders" ? (rows as OrderRow[] | null)?.map((o) => (
        <Card key={o.order_no + o.created_at}>
          <div className="flex justify-between"><b>ออเดอร์ #{o.order_no}</b><span className="tnum">{formatBaht(o.total_satang)}</span></div>
          <div className="text-xs text-bb-espresso/60">{dt(o.created_at)}{o.payment_status === "refunded" ? " · คืนเงินแล้ว" : ""}</div>
          <div className="mt-1 text-sm">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</div>
          {(o.points_earned > 0 || o.stamps_earned > 0) && <div className="mt-1 text-sm text-bb-caramel">{o.points_earned > 0 && `+${o.points_earned} แต้ม `}{o.stamps_earned > 0 && `+${o.stamps_earned} แสตมป์`}</div>}
        </Card>
      )) : (rows as LedgerRow[] | null)?.map((r, i) => (
        <Card key={i}><div className="flex justify-between"><span>{KIND[r.kind] ?? r.kind}</span><b className={`tnum ${r.amount < 0 ? "text-bb-burgundy" : ""}`}>{r.amount > 0 ? "+" : ""}{r.amount}</b></div><div className="text-xs text-bb-espresso/60">{dt(r.created_at)} · คงเหลือ {r.balance_after}</div></Card>
      ))}
    </>
  );
}

/* ---------- Signature Collector + Burn Journey + ระดับ ---------- */
interface Coll { items: { product_id: string; name: string; emoji: string | null; category: string; tried: boolean; times: number | null }[] }
interface Evt { kind: string; detail: string | null; occurred_at: string }
interface Tiers { tiers: { code: string; name: string; min_satang: number | null; benefits: string[] }[] }
const EVT: Record<string, string> = { registered: "สมัครสมาชิก", first_purchase: "ซื้อครั้งแรก", first_try: "ลองเมนูใหม่", tier_changed: "เลื่อนระดับ", birthday_reward: "ของขวัญวันเกิด", coupon_issued: "ได้รับคูปอง", coupon_used: "ใช้คูปอง", line_linked: "ผูกบัญชี LINE", reward_claimed: "แลกรางวัล" };

function Journey({ api }: { api: CallApi }) {
  const [coll] = useSection<Coll>(api, "collection");
  const [evts] = useSection<Evt[]>(api, "journey");
  const [tiers] = useSection<Tiers>(api, "tiers");
  const tried = coll?.items.filter((i) => i.tried).length ?? 0;
  return (
    <>
      <h2 className="mb-2 font-bold text-bb-burgundy">Signature Collector</h2>
      <Card>
        <div className="mb-2 text-sm">ลองแล้ว <b className="tnum">{tried}</b> จาก <b className="tnum">{coll?.items.length ?? 0}</b> เมนู</div>
        <div className="grid grid-cols-3 gap-2">
          {coll?.items.map((i) => (
            <div key={i.product_id} className={`rounded-xl p-2 text-center text-xs ${i.tried ? "bg-bb-gold/30" : "bg-bb-butter/60 opacity-60"}`}>
              <div className="text-2xl">{i.emoji ?? "🍰"}</div><div className="line-clamp-2">{i.name}</div>{i.tried && <div className="text-bb-caramel">✓ {i.times}</div>}
            </div>
          ))}
        </div>
      </Card>
      <h2 className="mb-2 mt-4 font-bold text-bb-burgundy">ระดับสมาชิก</h2>
      {tiers?.tiers.map((t) => (
        <Card key={t.code}><b>{t.name}</b><div className="text-xs text-bb-espresso/70">{t.min_satang === null ? "เงื่อนไขกำลังจะประกาศ" : `ยอดสะสมตั้งแต่ ${formatBaht(t.min_satang)}`}</div>{t.benefits.length > 0 && <ul className="mt-1 list-disc pl-5 text-sm">{t.benefits.map((b, i) => <li key={i}>{b}</li>)}</ul>}</Card>
      ))}
      <h2 className="mb-2 mt-4 font-bold text-bb-burgundy">Burn Journey</h2>
      {evts?.length === 0 && <Card><span className="text-sm">เส้นทางของคุณเริ่มต้นที่นี่</span></Card>}
      {evts?.map((e, i) => (<Card key={i}><div className="flex justify-between text-sm"><span>{EVT[e.kind] ?? e.kind}</span><span className="text-xs text-bb-espresso/60">{dt(e.occurred_at)}</span></div></Card>))}
    </>
  );
}

/* ---------- โปรไฟล์/ความยินยอม ---------- */
function Profile({ me, api, onChanged }: { me: Me; api: CallApi; onChanged: () => Promise<void> }) {
  const m = me.member!;
  const [name, setName] = useState(m.name); const [marketing, setMarketing] = useState(m.marketing_consent);
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await api("profile", { name, marketing, acceptPrivacy: true });
    setBusy(false); setMsg(r.success ? "บันทึกแล้ว" : r.message ?? "บันทึกไม่สำเร็จ");
    if (r.success) await onChanged();
  };
  const unlink = async () => {
    if (!window.confirm("เลิกผูกบัญชี LINE นี้กับสมาชิก? แต้มและประวัติยังอยู่กับสมาชิก ติดต่อพนักงานเพื่อผูกบัญชีใหม่")) return;
    const r = await api("unlink"); if (r.success) await onChanged(); else setMsg(r.message ?? "ไม่สำเร็จ");
  };
  return (
    <>
      <Card>
        <div className="mb-2 text-sm text-bb-espresso/70">{m.member_no} · {m.phone}{m.birthday ? ` · วันเกิด ${dt(m.birthday)}` : ""}</div>
        <Input label="ชื่อ" value={name} onChange={setName} max={100} />
        <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-5 accent-bb-burgundy" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />รับข่าวสารและโปรโมชันทาง LINE</label>
        {msg && <p className="mt-2 text-sm" role="status">{msg}</p>}
        <button disabled={busy || !name.trim()} onClick={save} className="mt-3 min-h-12 w-full rounded-xl bg-bb-burgundy font-semibold text-bb-butter disabled:opacity-40">บันทึก</button>
      </Card>
      <button onClick={unlink} className="mt-2 min-h-11 w-full rounded-xl border border-bb-burgundy/30 text-sm text-bb-burgundy">เลิกผูกบัญชี LINE</button>
    </>
  );
}
