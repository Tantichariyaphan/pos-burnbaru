"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordMovement } from "@/app/actions/cash";
import { Button, Field, Notice, cn, inputCls, newKey } from "@/components/ui";
import { bahtToSatang, formatBaht } from "@/lib/money";

const PRESETS = {
  out: ["ซื้อวัตถุดิบ", "ค่าน้ำ-ค่าไฟ", "ค่าแรง", "ค่าขนส่ง", "อื่น ๆ"],
  in: ["เพิ่มเงินทอน", "รับเงินอื่น ๆ", "อื่น ๆ"],
};

export function CashForm({ shiftId }: { shiftId: string | null }) {
  const router = useRouter();
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [channel, setChannel] = useState<"cash" | "transfer">(shiftId ? "cash" : "transfer");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [key, setKey] = useState(() => newKey());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const satang = bahtToSatang(amount);
  const needsShift = channel === "cash" && !shiftId;
  const valid = satang !== null && satang > 0 && category.trim().length > 0 && !needsShift;

  const seg = (on: boolean) => cn("min-h-12 flex-1 rounded-xl border text-base font-medium", on ? "border-matcha-700 bg-matcha-700 text-white" : "border-stone-300 bg-white/80 active:bg-stone-100");

  const submit = async () => {
    if (!valid || satang === null || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await recordMovement({ idempotencyKey: key, direction, channel, amountSatang: satang, category: category.trim(), note: note.trim() || undefined, shiftId });
      if (!r.ok) return setMsg({ tone: "error", text: r.error });
      setMsg({ tone: "success", text: `บันทึกแล้ว: ${direction === "in" ? "เงินเข้า" : "เงินออก"} ${formatBaht(satang)} (${channel === "cash" ? "เงินสด" : "โอนเงิน"})` });
      setAmount(""); setCategory(""); setNote(""); setKey(newKey());
      router.refresh();
    } catch {
      setMsg({ tone: "error", text: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กดบันทึกอีกครั้งได้ (ระบบไม่บันทึกซ้ำ)" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="glass space-y-4 rounded-2xl p-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-sm font-medium text-stone-700">ประเภท</div>
            <div className="flex gap-2">
              <button type="button" className={seg(direction === "out")} onClick={() => { setDirection("out"); setCategory(""); }}>เงินออก</button>
              <button type="button" className={seg(direction === "in")} onClick={() => { setDirection("in"); setCategory(""); }}>เงินเข้า</button>
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm font-medium text-stone-700">ช่องทาง</div>
            <div className="flex gap-2">
              <button type="button" className={seg(channel === "cash")} onClick={() => setChannel("cash")}>เงินสด (ลิ้นชัก)</button>
              <button type="button" className={seg(channel === "transfer")} onClick={() => setChannel("transfer")}>โอนเงิน (บัญชี)</button>
            </div>
            <p className="mt-1 text-xs text-stone-500">
              {channel === "cash" ? "ปรับยอดเงินสดในลิ้นชักของกะนี้" : "ไม่กระทบเงินสดในลิ้นชัก"}
            </p>
          </div>
          <Field label="จำนวนเงิน (บาท)">
            <input className={cn(inputCls, "text-2xl font-semibold")} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </Field>
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-sm font-medium text-stone-700">เหตุผล / หมวด</div>
            <div className="mb-2 flex flex-wrap gap-2">
              {PRESETS[direction].map((p) => (
                <button type="button" key={p} onClick={() => setCategory(p)} className={cn("min-h-11 rounded-full border px-3 text-sm", category === p ? "border-matcha-700 bg-matcha-50" : "border-stone-300 bg-white/80")}>{p}</button>
              ))}
            </div>
            <input className={inputCls} value={category} maxLength={100} onChange={(e) => setCategory(e.target.value)} placeholder="พิมพ์เหตุผลเอง" aria-label="เหตุผล" />
          </div>
          <Field label="หมายเหตุ (ไม่บังคับ)">
            <input className={inputCls} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </div>
      {needsShift && <Notice tone="warn">รายการเงินสดต้องเปิดกะก่อน (เปิดกะที่หน้า POS)</Notice>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Button type="submit" variant="primary" size="lg" disabled={!valid || busy} className="w-full md:w-auto">
        {busy ? "กำลังบันทึก…" : "บันทึกรายการ"}
      </Button>
    </form>
  );
}
