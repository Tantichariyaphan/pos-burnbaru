import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="glass w-full max-w-sm rounded-3xl p-6">
        <div className="mb-5 text-center">
          <div className="text-4xl">🍵</div>
          <h1 className="mt-2 text-xl font-semibold text-[#6d0212]">BurnBaru</h1>
          <p className="text-sm text-stone-500">เข้าสู่ระบบ POS</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
