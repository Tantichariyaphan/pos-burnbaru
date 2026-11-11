"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { saveSettings } from "@/app/actions/settings";
import { Button, Field, Notice, inputCls } from "@/components/ui";
import type { Settings } from "@/types/db";

export function SettingsForm({ settings, missingPrices }: { settings: Settings; missingPrices: string[] }) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await saveSettings({ shopName: s.shop_name, receiptFooter: s.receipt_footer, salesEnabled: s.sales_enabled, inventoryEnabled: s.inventory_enabled, customersEnabled: s.customers_enabled });
      if (!r.ok) return setMsg({ tone: "error", text: r.error });
      setMsg({ tone: "success", text: "บันทึกแล้ว" }); router.refresh();
    } catch { setMsg({ tone: "error", text: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่" }); } finally { setBusy(false); }
  };
  const Toggle = ({ k, label, hint }: { k: "sales_enabled" | "inventory_enabled" | "customers_enabled"; label: string; hint: string }) => (
    <label className="flex min-h-14 items-start gap-3 rounded-2xl border border-stone-200 bg-white/70 p-3">
      <input type="checkbox" className="mt-0.5 size-6 accent-matcha-700" checked={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />
      <span><b>{label}</b><span className="block text-sm text-stone-600">{hint}</span></span>
    </label>
  );

  return (
    <div className="glass max-w-2xl space-y-4 rounded-2xl p-4">
      <Field label="ชื่อร้าน (แสดงบนใบเสร็จ)"><input className={inputCls} value={s.shop_name} onChange={(e) => setS({ ...s, shop_name: e.target.value })} /></Field>
      <Field label="ข้อความท้ายใบเสร็จ"><input className={inputCls} value={s.receipt_footer} onChange={(e) => setS({ ...s, receipt_footer: e.target.value })} /></Field>
      {missingPrices.length > 0 && (
        <Notice tone="warn">
          ยังมีเมนูที่เปิดใช้งานแต่ไม่มีราคา: {missingPrices.join(", ")} — <Link href="/products" className="underline">ไปตั้งราคา</Link> หรือปิดการใช้งานก่อน จึงจะเปิดขายได้
        </Notice>
      )}
      <Toggle k="sales_enabled" label="เปิดรับชำระเงิน (เปิดการขาย)" hint="ยืนยันราคาเมนูทั้งหมดถูกต้องแล้วจึงเปิด — ปิดไว้ = หน้า POS คิดเงินไม่ได้" />
      <Toggle k="inventory_enabled" label="ตัดสต็อกอัตโนมัติตามสูตร" hint="ตัดวัตถุดิบตอนชำระเงิน ตามสูตรที่ผูกไว้ในหน้า “สต็อก”" />
      <Toggle k="customers_enabled" label="เลือกลูกค้าในหน้าชำระเงิน" hint="แสดงช่องเลือกลูกค้า (ไม่บังคับ)" />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Button variant="primary" size="lg" disabled={busy || !s.shop_name.trim()} onClick={save}>บันทึกการตั้งค่า</Button>
    </div>
  );
}
