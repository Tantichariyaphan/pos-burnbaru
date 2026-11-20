"use client";
import { useState } from "react";
import { createClaimQr } from "@/app/actions/members";
import { QrCode } from "@/components/qr-code";
import { Button, Notice } from "@/components/ui";

type Props =
  | { purpose: "link"; customerId: string; label: string }
  | { purpose: "claim"; orderId: string; label: string };

/** ปุ่ม + QR ที่พนักงานให้ลูกค้าสแกนด้วยกล้อง LINE (ผูก LINE กับสมาชิก / รับแต้มของบิล) — ใช้ได้ครั้งเดียวและหมดอายุเอง */
export function ClaimQr(props: Props) {
  const [qr, setQr] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const make = async () => {
    setBusy(true); setError(null);
    const r = await createClaimQr(props.purpose === "link"
      ? { purpose: "link", customerId: props.customerId }
      : { purpose: "claim", orderId: props.orderId });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setQr(r.data!);
  };

  return (
    <div className="mt-2">
      {!qr && <Button size="sm" disabled={busy} onClick={make}>{busy ? "กำลังสร้าง QR…" : props.label}</Button>}
      {qr && (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-white p-3">
          <QrCode value={qr.url} size={220} label={props.label} />
          <p className="text-center text-xs text-stone-600">
            ให้ลูกค้าสแกนด้วยกล้อง LINE · หมดอายุ {new Date(qr.expiresAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })} น. ใช้ได้ครั้งเดียว
          </p>
          <Button size="sm" disabled={busy} onClick={make}>สร้าง QR ใหม่</Button>
        </div>
      )}
      {error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}
    </div>
  );
}
