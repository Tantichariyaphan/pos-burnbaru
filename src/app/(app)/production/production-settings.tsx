"use client";
import { useState } from "react";
import { saveProductionSettings, saveStationRoute } from "@/app/actions/production";
import { Button, Field, Modal, Notice, inputCls, cn } from "@/components/ui";
import { STATION_ICON, STATION_LABEL, type ProductionSnapshot, type Station } from "@/lib/production";
import type { ConfigData } from "./production-client";

type Route = Station | "";

export function ProductionSettings({
  open, onClose, settings, config, onSaved, onToast,
}: {
  open: boolean; onClose: () => void; settings: ProductionSnapshot["settings"]; config: ConfigData;
  onSaved: () => void; onToast: (tone: "success" | "error", text: string) => void;
}) {
  const [cap, setCap] = useState(String(settings.batch_capacity));
  const [mix, setMix] = useState(settings.mix_flavors);
  const [bake, setBake] = useState(settings.bake_minutes === null ? "" : String(settings.bake_minutes));
  const [def, setDef] = useState<Station>(settings.default_station);
  const [hours, setHours] = useState(String(settings.queue_link_hours));
  const [cats, setCats] = useState<Record<string, Route>>(() => Object.fromEntries(config.categories.map((c) => [c.id, config.categoryStations[c.id] ?? ""])));
  const [prods, setProds] = useState<Record<string, Route>>(() => Object.fromEntries(config.products.map((p) => [p.id, config.productStations[p.id] ?? ""])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const unrouted = config.categories.filter((c) => !cats[c.id]);

  const save = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await saveProductionSettings({
        batchCapacity: Number(cap), mixFlavors: mix, bakeMinutes: bake.trim() === "" ? null : Number(bake), defaultStation: def, queueLinkHours: Number(hours),
      });
      if (!r.ok) { setErr(r.error); return; }
      // เส้นทางสถานี: ส่งเฉพาะที่เปลี่ยน
      for (const c of config.categories) {
        const before = config.categoryStations[c.id] ?? "";
        if (before !== cats[c.id]) {
          const x = await saveStationRoute({ kind: "category", id: c.id, station: cats[c.id] || null });
          if (!x.ok) { setErr(x.error); return; }
        }
      }
      for (const p of config.products) {
        const before = config.productStations[p.id] ?? "";
        if (before !== prods[p.id]) {
          const x = await saveStationRoute({ kind: "product", id: p.id, station: prods[p.id] || null });
          if (!x.ok) { setErr(x.error); return; }
        }
      }
      onToast("success", "บันทึกการตั้งค่างานผลิตแล้ว (ออเดอร์ที่เข้าคิวไปแล้วไม่เปลี่ยนสถานี)");
      onSaved();
      onClose();
    } catch {
      setErr("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง");
    } finally { setBusy(false); }
  };

  const Select = ({ value, onChange, label, blank }: { value: Route; onChange: (v: Route) => void; label: string; blank: string }) => (
    <select aria-label={label} className={cn(inputCls, "min-h-12")} value={value} onChange={(e) => onChange(e.target.value as Route)}>
      <option value="">{blank}</option>
      <option value="cake">{STATION_ICON.cake} {STATION_LABEL.cake}</option>
      <option value="drink">{STATION_ICON.drink} {STATION_LABEL.drink}</option>
    </select>
  );

  return (
    <Modal open={open} onClose={onClose} wide title="ตั้งค่างานผลิตและคิว"
      footer={<div className="flex gap-2"><Button size="lg" className="flex-1" onClick={onClose}>ปิด</Button><Button variant="primary" size="lg" className="flex-1" disabled={busy} onClick={save}>{busy ? "กำลังบันทึก…" : "บันทึก"}</Button></div>}>
      <div className="space-y-5">
        {err && <Notice tone="error">{err}</Notice>}
        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="ความจุต่อรอบอบ (ชิ้น)" hint="ค่าเริ่มต้น 22 — มีผลกับแผนครั้งถัดไป รอบที่เริ่มอบแล้วไม่เปลี่ยน">
            <input className={inputCls} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="เวลาอบต่อรอบ (นาที)" hint="เว้นว่าง = ไม่ประมาณเวลารอให้ลูกค้า (ไม่มีข้อมูลจริงจะไม่เดา)">
            <input className={inputCls} inputMode="numeric" value={bake} onChange={(e) => setBake(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="ลิงก์คิวของลูกค้าใช้ได้ (ชั่วโมง)" hint="หลังจากนี้ลิงก์ไม่แสดงข้อมูล">
            <input className={inputCls} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="สถานีเริ่มต้นของสินค้าที่ยังไม่ได้กำหนด">
            <Select value={def} onChange={(v) => v && setDef(v)} label="สถานีเริ่มต้น" blank="—" />
          </Field>
          <label className="flex min-h-12 items-center gap-3 sm:col-span-2">
            <input type="checkbox" className="size-6" checked={mix} onChange={(e) => setMix(e.target.checked)} />
            <span>ให้รอบอบผสมหลายรสได้</span>
          </label>
        </section>

        <section>
          <h3 className="mb-1 font-semibold">สินค้าไหนทำที่สถานีใด</h3>
          {unrouted.length > 0 && <Notice tone="warn">หมวดที่ยังไม่กำหนดสถานี ({unrouted.map((c) => c.name).join(", ")}) จะไปที่สถานีเริ่มต้น: {STATION_LABEL[def]}</Notice>}
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {config.categories.map((c) => (
              <div key={c.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <div className="w-40"><Select value={cats[c.id] ?? ""} onChange={(v) => setCats((s) => ({ ...s, [c.id]: v }))} label={`สถานีของหมวด ${c.name}`} blank="ใช้ค่าเริ่มต้น" /></div></div>
            ))}
          </div>
          <details className="mt-3">
            <summary className="min-h-11 cursor-pointer py-2 font-medium">กำหนดเป็นรายสินค้า (ข้ามค่าของหมวด)</summary>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {config.products.map((p) => (
                <div key={p.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <div className="w-40"><Select value={prods[p.id] ?? ""} onChange={(v) => setProds((s) => ({ ...s, [p.id]: v }))} label={`สถานีของ ${p.name}`} blank="ตามหมวด" /></div></div>
              ))}
            </div>
          </details>
        </section>
      </div>
    </Modal>
  );
}
