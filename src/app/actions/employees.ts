"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, db, fail, failText, type ActionResult } from "@/lib/actions";
import { createAdminClient } from "@/lib/supabase/admin";

const uuid = z.string().uuid();
const role = z.enum(["owner", "manager", "cashier"]);

/** สร้างบัญชีพนักงาน — ใช้ service-role ฝั่งเซิร์ฟเวอร์ หลังยืนยันแล้วว่าผู้เรียกเป็นเจ้าของร้าน */
export async function createEmployee(input: { email: string; password: string; name: string; role: "owner" | "manager" | "cashier" }): Promise<ActionResult> {
  const a = await authorize("employees");
  if ("error" in a) return failText(a.error);
  const p = z.object({
    email: z.string().trim().email("อีเมลไม่ถูกต้อง"), password: z.string().min(8, "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร").max(100),
    name: z.string().trim().min(1, "กรุณากรอกชื่อ").max(100), role,
  }).safeParse(input);
  if (!p.success) return failText(p.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  try {
    const admin = createAdminClient();
    // pos_role / pos_name อยู่ใน app_metadata: ผู้สมัครเองแก้ไม่ได้ (trigger handle_new_user อ่านจากตรงนี้เท่านั้น)
    const { error } = await admin.auth.admin.createUser({
      email: p.data.email, password: p.data.password, email_confirm: true,
      app_metadata: { pos_role: p.data.role, pos_name: p.data.name },
    });
    if (error) return failText(/already|registered/i.test(error.message) ? "อีเมลนี้มีบัญชีอยู่แล้ว" : "สร้างบัญชีไม่สำเร็จ: " + error.message);
  } catch (e) {
    return failText(e instanceof Error ? e.message : "สร้างบัญชีไม่สำเร็จ");
  }
  revalidatePath("/employees");
  return { ok: true };
}

export async function updateEmployee(input: { id: string; name: string; role: "owner" | "manager" | "cashier"; active: boolean }): Promise<ActionResult> {
  const a = await authorize("employees");
  if ("error" in a) return failText(a.error);
  const p = z.object({ id: uuid, name: z.string().trim().min(1).max(100), role, active: z.boolean() }).safeParse(input);
  if (!p.success) return failText("ข้อมูลไม่ถูกต้อง");
  const supabase = await db();
  const { error, count } = await supabase.from("employees")
    .update({ name: p.data.name, role: p.data.role, active: p.data.active }, { count: "exact" }).eq("id", p.data.id);
  if (error) return fail(error.message);
  if (!count) return failText("คุณไม่มีสิทธิ์แก้ไขพนักงาน");
  revalidatePath("/employees");
  return { ok: true };
}

export async function resetEmployeePassword(input: { id: string; password: string }): Promise<ActionResult> {
  const a = await authorize("employees");
  if ("error" in a) return failText(a.error);
  const p = z.object({ id: uuid, password: z.string().min(8, "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร").max(100) }).safeParse(input);
  if (!p.success) return failText(p.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  try {
    const { error } = await createAdminClient().auth.admin.updateUserById(p.data.id, { password: p.data.password });
    if (error) return failText("ตั้งรหัสผ่านไม่สำเร็จ: " + error.message);
  } catch (e) {
    return failText(e instanceof Error ? e.message : "ตั้งรหัสผ่านไม่สำเร็จ");
  }
  return { ok: true };
}
