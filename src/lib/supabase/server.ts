import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** ใช้ใน Server Component / Server Action: รันด้วยสิทธิ์ของผู้ใช้ที่ล็อกอิน (RLS มีผลเสมอ) */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // เรียกจาก Server Component: middleware จะรีเฟรช session ให้เอง
        }
      },
    },
  });
}
