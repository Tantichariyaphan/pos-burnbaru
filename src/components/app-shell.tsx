"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/components/ui";
import { NAV, can, ROLE_LABEL, type Role } from "@/lib/roles";
import { signOut } from "@/app/actions/auth";

export function AppShell({
  employee, shopName, children,
}: { employee: { name: string; role: Role }; shopName: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => can(employee.role, n.perm));

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 py-2" aria-label="เมนูหลัก">
      {items.map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + "/");
        return (
          <Link
            key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
            className={cn(
              "mx-1.5 flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-center text-[11px] leading-tight",
              active ? "bg-matcha-700 text-white" : "text-stone-600 active:bg-stone-200/70",
            )}
          >
            <Icon name={n.icon} size={22} />
            <span>{n.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const account = (
    <div className="border-t border-stone-200/70 p-1.5">
      <form action={signOut}>
        <button className="flex w-full flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[11px] text-stone-600 active:bg-stone-200/70" aria-label="ออกจากระบบ">
          <Icon name="logout" size={22} />
          <span>ออก</span>
        </button>
      </form>
    </div>
  );

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      {/* แถบเมนูด้านข้าง (iPad/เดสก์ท็อป) */}
      <aside className="glass no-print hidden w-[76px] shrink-0 flex-col md:flex">
        <div className="grid h-14 place-items-center text-2xl" title={shopName}>🍵</div>
        {nav}
        {account}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* แถบบนสำหรับมือถือ */}
        <header className="glass no-print flex h-12 shrink-0 items-center gap-2 px-2 md:hidden">
          <button onClick={() => setOpen(true)} aria-label="เมนู" className="grid size-11 place-items-center rounded-xl active:bg-stone-200/70">
            <Icon name="menu" />
          </button>
          <div className="truncate text-sm font-semibold">{shopName}</div>
          <div className="ml-auto truncate text-xs text-stone-500">{employee.name}</div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>

      {open && (
        <div className="no-print fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-stone-900/40" onClick={() => setOpen(false)} />
          <aside className="glass absolute inset-y-0 left-0 flex w-28 flex-col bg-white/95">
            <div className="grid h-14 place-items-center text-2xl">🍵</div>
            <div className="scroll-y flex-1">{nav}</div>
            <div className="px-2 pb-1 text-center text-[11px] text-stone-500">{employee.name}<br />{ROLE_LABEL[employee.role]}</div>
            {account}
          </aside>
        </div>
      )}
    </div>
  );
}
