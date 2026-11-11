import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** รีเฟรช session ทุกคำขอ และส่งคนที่ยังไม่ล็อกอินไปหน้า /login */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isLogin = path === "/login";
  // หน้า/ API ติดตามคิวของลูกค้า: เปิดสาธารณะ — การเข้าถึงควบคุมด้วย bearer token ในลิงก์ (ตรวจที่ฐานข้อมูล)
  if (path.startsWith("/q/") || path.startsWith("/api/queue/")) return response;

  if (!data.user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (data.user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/pos";
    return NextResponse.redirect(url);
  }
  return response;
}
