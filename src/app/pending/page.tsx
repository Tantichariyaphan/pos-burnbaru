import { redirect } from "next/navigation";
import { getEmployee } from "@/lib/auth";
import { signOut } from "@/app/actions/auth";

export default async function PendingPage() {
  const emp = await getEmployee();
  if (!emp) redirect("/login");
  if (emp.active) redirect("/pos");
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="glass w-full max-w-md rounded-3xl p-6 text-center">
        <div className="text-4xl">⏳</div>
        <h1 className="mt-2 text-xl font-semibold">บัญชียังไม่ได้รับอนุญาต</h1>
        <p className="mt-2 text-sm text-stone-600">
          บัญชี {emp.email} ถูกสร้างแล้ว แต่เจ้าของร้านยังไม่ได้เปิดใช้งาน กรุณาแจ้งเจ้าของร้านให้อนุมัติในหน้า “พนักงาน”
        </p>
        <form action={signOut} className="mt-5">
          <button className="min-h-11 rounded-xl border border-stone-300 bg-white/80 px-5">ออกจากระบบ</button>
        </form>
      </div>
    </main>
  );
}
