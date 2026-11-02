import { createBrowserClient } from "@supabase/ssr";

/** ใช้ในเบราว์เซอร์: อ่านข้อมูลภายใต้ RLS ด้วยสิทธิ์ของผู้ใช้ที่ล็อกอิน (ใช้เฉพาะ anon key) */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
