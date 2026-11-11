import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { getEmployee, type CurrentEmployee } from "@/lib/auth";
import { can, type Permission } from "@/lib/roles";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export const fail = (message: string | null | undefined): { ok: false; error: string } => ({ ok: false, error: friendlyError(message) });
export const failText = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** ตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์ทุก action (ฐานข้อมูลตรวจซ้ำอีกชั้นด้วย RLS/ฟังก์ชัน) */
export async function authorize(perm: Permission): Promise<{ emp: CurrentEmployee } | { error: string }> {
  const emp = await getEmployee();
  if (!emp || !emp.active) return { error: friendlyError("NOT_AUTHENTICATED") };
  if (!can(emp.role, perm)) return { error: friendlyError("FORBIDDEN") };
  return { emp };
}

export async function db() {
  return createClient();
}
