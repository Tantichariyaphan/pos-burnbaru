import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * ไคลเอนต์สิทธิ์ anon (ไม่มี session, ไม่เก็บ cookie) — ใช้เรียก get_public_queue(token) เท่านั้น
 * ตารางทั้งหมดไม่มีสิทธิ์ให้ anon; ฟังก์ชันนี้ฟังก์ชันเดียวที่เปิดให้ และคืนเฉพาะออเดอร์ของ token นั้น
 */
export function createAnonClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}
