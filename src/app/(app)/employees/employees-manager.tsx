"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createEmployee, resetEmployeePassword, updateEmployee } from "@/app/actions/employees";
import { Icon } from "@/components/icons";
import { Badge, Button, Field, Modal, Notice, inputCls } from "@/components/ui";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import type { ActionResult } from "@/lib/actions";
import type { Employee } from "@/types/db";

const ROLE_HINT: Record<Role, string> = {
  owner: "ทุกอย่าง รวมถึงพนักงานและตั้งค่า",
  manager: "รายงาน สินค้า สต็อก คืนเงิน กลับรายการ",
  cashier: "ขายสินค้า เงินเข้า-ออก เปิด/ปิดกะ ดูลูกค้า",
};

export function EmployeesManager({ employees, meId }: { employees: Employee[]; meId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<(Partial<Employee> & { password: string }) | null>(null);
  const run = async (fn: () => Promise<ActionResult>, ok: () => void) => {
    setBusy(true); setError(null);
    try { const r = await fn(); if (!r.ok) return setError(r.error); ok(); router.refresh(); }
    catch { setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่"); } finally { setBusy(false); }
  };
  const pending = employees.filter((e) => !e.active);

  return (
    <div className="space-y-4">
      <Button variant="primary" onClick={() => { setEdit({ role: "cashier", active: true, name: "", email: "", password: "" }); setError(null); }}><Icon name="plus" size={18} /> เพิ่มพนักงาน</Button>
      {pending.length > 0 && <Notice tone="warn">มี {pending.length} บัญชีที่ปิดใช้งาน/รออนุมัติ — กด “แก้ไข” แล้วเปิดใช้งานเพื่ออนุญาต</Notice>}
      <ul className="glass divide-y divide-stone-200/70 rounded-2xl px-3">
        {employees.map((e) => (
          <li key={e.id} className="flex items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{e.name} {e.id === meId && <Badge tone="neutral">คุณ</Badge>} {!e.active && <Badge tone="unpaid">ปิดใช้งาน</Badge>}</div>
              <div className="truncate text-xs text-stone-500">{e.email} · {ROLE_LABEL[e.role]}</div>
            </div>
            <Button size="sm" onClick={() => { setEdit({ ...e, password: "" }); setError(null); }}>แก้ไข</Button>
          </li>
        ))}
      </ul>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "แก้ไขพนักงาน" : "เพิ่มพนักงาน"}
        footer={<div className="flex items-center justify-end gap-2">
          {error && <div className="mr-auto flex-1"><Notice tone="error">{error}</Notice></div>}
          <Button onClick={() => setEdit(null)}>ยกเลิก</Button>
          {edit?.id ? (
            <Button variant="primary" disabled={busy || !edit.name?.trim()} onClick={() => run(() => updateEmployee({ id: edit.id!, name: edit.name ?? "", role: edit.role ?? "cashier", active: edit.active ?? true }), () => setEdit(null))}>บันทึก</Button>
          ) : (
            <Button variant="primary" disabled={busy || !edit?.name?.trim() || !edit?.email?.trim() || (edit?.password.length ?? 0) < 8}
              onClick={() => edit && run(() => createEmployee({ email: edit.email ?? "", password: edit.password, name: edit.name ?? "", role: edit.role ?? "cashier" }), () => setEdit(null))}>สร้างบัญชี</Button>
          )}
        </div>}>
        {edit && (
          <div className="space-y-3">
            <Field label="ชื่อที่แสดง"><input className={inputCls} value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="อีเมล (ใช้เข้าสู่ระบบ)"><input className={inputCls} type="email" disabled={!!edit.id} value={edit.email ?? ""} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="บทบาท" hint={ROLE_HINT[edit.role ?? "cashier"]}>
              <select className={inputCls} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })}>
                {(["cashier", "manager", "owner"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </Field>
            {edit.id ? (
              <>
                <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-6 accent-matcha-700" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />เปิดใช้งานบัญชี</label>
                <div className="rounded-2xl border border-stone-200 p-3">
                  <Field label="ตั้งรหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)">
                    <input className={inputCls} type="text" autoComplete="off" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
                  </Field>
                  <Button className="mt-2" disabled={busy || edit.password.length < 8} onClick={() => run(() => resetEmployeePassword({ id: edit.id!, password: edit.password }), () => setEdit({ ...edit, password: "" }))}>ตั้งรหัสผ่านใหม่</Button>
                </div>
              </>
            ) : (
              <Field label="รหัสผ่านเริ่มต้น (อย่างน้อย 8 ตัวอักษร)"><input className={inputCls} type="text" autoComplete="off" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
