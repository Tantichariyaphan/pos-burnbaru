"use client";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon } from "./icons";

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";
type Size = "md" | "lg" | "sm";

const VARIANT: Record<Variant, string> = {
  primary: "bg-matcha-700 text-white active:bg-matcha-800 disabled:bg-stone-300 disabled:text-stone-500",
  success: "bg-paid text-white active:brightness-90 disabled:bg-stone-300 disabled:text-stone-500",
  secondary: "bg-white/80 text-stone-800 border border-stone-300 active:bg-stone-100 disabled:text-stone-400",
  danger: "bg-white/80 text-refund border border-rose-300 active:bg-rose-50 disabled:text-stone-400",
  ghost: "text-stone-700 active:bg-stone-200/60 disabled:text-stone-400",
};
const SIZE: Record<Size, string> = {
  sm: "min-h-9 px-3 text-sm rounded-lg",
  md: "min-h-11 px-4 text-base rounded-xl",
  lg: "min-h-14 px-6 text-lg rounded-2xl font-semibold",
};

export function Button({
  variant = "secondary", size = "md", className, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 font-medium transition-colors disabled:cursor-not-allowed",
        VARIANT[variant], SIZE[size], className,
      )}
    />
  );
}

export function Modal({
  open, onClose, title, children, footer, wide, dismissable = true,
}: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; dismissable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && dismissable) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, dismissable]);
  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]" onClick={dismissable ? onClose : undefined} />
      <div
        ref={ref}
        className={cn(
          "glass relative flex max-h-full w-full flex-col overflow-hidden rounded-3xl !bg-white/95",
          wide ? "max-w-4xl" : "max-w-lg",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-stone-200/70 px-5 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          {dismissable && (
            <button type="button" onClick={onClose} aria-label="ปิด" className="-mr-2 grid size-11 place-items-center rounded-full text-stone-500 active:bg-stone-200/70">
              <Icon name="x" />
            </button>
          )}
        </div>
        <div className="scroll-y min-h-0 flex-1 px-5 py-4">{children}</div>
        {footer && <div className="border-t border-stone-200/70 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export type Tone = "unpaid" | "paid" | "preparing" | "done" | "refund" | "neutral";
const TONE: Record<Tone, string> = {
  unpaid: "bg-amber-100 text-unpaid",
  paid: "bg-green-100 text-paid",
  preparing: "bg-sky-100 text-preparing",
  done: "bg-stone-200 text-done",
  refund: "bg-rose-100 text-refund",
  neutral: "bg-stone-100 text-stone-600",
};
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", TONE[tone])}>{children}</span>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success" | "warn"; children: ReactNode }) {
  const t = {
    info: "bg-sky-50 text-sky-900 border-sky-200",
    error: "bg-rose-50 text-rose-900 border-rose-200",
    success: "bg-green-50 text-green-900 border-green-200",
    warn: "bg-amber-50 text-amber-900 border-amber-200",
  }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-xl border px-3 py-2 text-sm", t)}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "min-h-11 w-full rounded-xl border border-stone-300 bg-white/90 px-3 text-base outline-none focus:border-matcha-500 focus:ring-2 focus:ring-matcha-200 disabled:bg-stone-100";

export function Empty({ children }: { children: ReactNode }) {
  return <div className="grid place-items-center rounded-2xl border border-dashed border-stone-300 px-4 py-10 text-center text-sm text-stone-500">{children}</div>;
}

export function Spinner() {
  return <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-label="กำลังโหลด" />;
}

/** แป้นตัวเลขสำหรับ iPad — กรอกจำนวนเงินเป็นบาท (มีจุดทศนิยมได้ 2 ตำแหน่ง) */
export function NumPad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const press = (k: string) => {
    if (k === "back") return onChange(value.slice(0, -1));
    if (k === "clear") return onChange("");
    if (k === ".") {
      if (value.includes(".")) return;
      return onChange((value === "" ? "0" : value) + ".");
    }
    const next = value === "0" ? k : value + k;
    const [w, f] = next.split(".");
    if (f !== undefined && f.length > 2) return;
    if (w.length > 7) return;
    onChange(next);
  };
  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "back"];
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k) => (
        <button
          key={k} type="button" onClick={() => press(k)}
          aria-label={k === "back" ? "ลบ" : k}
          className="grid h-14 place-items-center rounded-xl border border-stone-200 bg-white/90 text-2xl font-medium active:bg-stone-200"
        >
          {k === "back" ? <Icon name="undo" size={24} /> : k}
        </button>
      ))}
      <button type="button" onClick={() => press("clear")} className="col-span-3 h-11 rounded-xl text-sm text-stone-600 active:bg-stone-200/70">ล้างตัวเลข</button>
    </div>
  );
}

export function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // fallback (ไม่ใช้ใน https/localhost ปกติ)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
