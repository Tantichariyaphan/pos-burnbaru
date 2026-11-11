"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { failText, type ActionResult } from "@/lib/actions";

const schema = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200) });

export async function signIn(input: { email: string; password: string }): Promise<ActionResult> {
  const p = schema.safeParse(input);
  if (!p.success) return failText("กรุณากรอกอีเมลและรหัสผ่านให้ถูกต้อง");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(p.data);
  if (error) return failText("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
  return { ok: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
