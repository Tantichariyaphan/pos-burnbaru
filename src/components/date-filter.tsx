/** ตัวกรองช่วงวันที่ (GET form — ทำงานโดยไม่ต้องใช้ JS) */
export function DateFilter({ action, from, to, presets }: { action: string; from: string; to: string; presets?: { label: string; from: string; to: string }[] }) {
  return (
    <form action={action} method="get" className="no-print flex flex-wrap items-end gap-2">
      <label className="text-sm">
        <span className="mb-1 block text-stone-600">ตั้งแต่</span>
        <input type="date" name="from" defaultValue={from} className="min-h-11 rounded-xl border border-stone-300 bg-white px-3" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-stone-600">ถึง</span>
        <input type="date" name="to" defaultValue={to} className="min-h-11 rounded-xl border border-stone-300 bg-white px-3" />
      </label>
      <button className="min-h-11 rounded-xl bg-matcha-700 px-5 font-medium text-white active:bg-matcha-800">ดูรายงาน</button>
      {presets?.map((p) => (
        <a key={p.label} href={`${action}?from=${p.from}&to=${p.to}`} className="inline-flex min-h-11 items-center rounded-xl border border-stone-300 bg-white/80 px-3 text-sm active:bg-stone-100">{p.label}</a>
      ))}
    </form>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-stone-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function PageBody({ children }: { children: React.ReactNode }) {
  return <div className="scroll-y h-full"><div className="mx-auto max-w-6xl space-y-5 p-4">{children}</div></div>;
}
