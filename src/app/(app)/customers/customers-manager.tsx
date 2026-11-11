"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveCustomer } from "@/app/actions/customers";
import { Icon } from "@/components/icons";
import { Badge, Button, Empty, Field, Modal, Notice, inputCls } from "@/components/ui";
import type { Customer } from "@/types/db";

export function CustomersManager({ customers }: { customers: Customer[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Partial<Customer> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = customers.filter((c) => !q.trim() || (c.name + " " + (c.phone ?? "")).toLowerCase().includes(q.trim().toLowerCase()));

  const save = async () => {
    if (!edit) return;
    setBusy(true); setError(null);
    try {
      const r = await saveCustomer({ id: edit.id, name: edit.name ?? "", phone: edit.phone ?? "", note: edit.note ?? "", active: edit.active ?? true });
      if (!r.ok) return setError(r.error);
      setEdit(null); router.refresh();
    } catch { setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่"); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => { setEdit({ active: true, name: "" }); setError(null); }}><Icon name="plus" size={18} /> เพิ่มลูกค้า</Button>
        <input className={inputCls + " max-w-xs"} placeholder="ค้นหาชื่อ/เบอร์" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.length === 0 ? <Empty>ไม่มีรายชื่อลูกค้า</Empty> : (
        <ul className="glass divide-y divide-stone-200/70 rounded-2xl px-3">
          {list.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{c.name} {!c.active && <Badge tone="neutral">ปิดใช้งาน</Badge>}</div>
                <div className="truncate text-xs text-stone-500">{c.phone}{c.note ? ` · ${c.note}` : ""}</div>
              </div>
              <Button size="sm" onClick={() => { setEdit(c); setError(null); }}>แก้ไข</Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "แก้ไขลูกค้า" : "เพิ่มลูกค้า"}
        footer={<div className="flex items-center justify-end gap-2">{error && <div className="mr-auto flex-1"><Notice tone="error">{error}</Notice></div>}
          <Button onClick={() => setEdit(null)}>ยกเลิก</Button>
          <Button variant="primary" disabled={busy || !edit?.name?.trim()} onClick={save}>บันทึก</Button></div>}>
        {edit && <div className="space-y-3">
          <Field label="ชื่อ"><input className={inputCls} value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="เบอร์โทร"><input className={inputCls} inputMode="tel" value={edit.phone ?? ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
          <Field label="หมายเหตุ"><input className={inputCls} value={edit.note ?? ""} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-6 accent-matcha-700" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />เปิดใช้งาน</label>
        </div>}
      </Modal>
    </div>
  );
}
