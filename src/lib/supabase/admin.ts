import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client — "ข้าม RLS" ใช้เฉพาะฝั่งเซิร์ฟเวอร์ และเฉพาะงานสร้าง/รีเซ็ตบัญชีพนักงาน
 * หลังตรวจแล้วว่าผู้เรียกเป็น owner เท่านั้น (ดู actions/employees.ts)
 * ห้ามนำเข้าจาก Client Component
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY บนเซิร์ฟเวอร์");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
