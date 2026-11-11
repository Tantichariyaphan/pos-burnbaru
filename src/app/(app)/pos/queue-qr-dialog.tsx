"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { QrCode } from "@/components/qr-code";
import { Button, Modal } from "@/components/ui";
import { formatQueueNo, queueUrl } from "@/lib/production";

/** แสดง QR ติดตามคิวให้ลูกค้าสแกน (ลิงก์เป็น bearer token — ใครมีลิงก์ก็เห็นเฉพาะคิวนี้) */
export function QueueQrDialog({
  open, onClose, queueNo, token, orderLabel,
}: { open: boolean; onClose: () => void; queueNo: number; token: string; orderLabel?: string }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { setOrigin(window.location.origin); setCopied(false); }, [open]);
  const url = origin ? queueUrl(origin, token) : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`QR ติดตามคิว ${formatQueueNo(queueNo)}`}
      footer={<div className="flex justify-end gap-2"><Button onClick={copy} disabled={!url}>{copied ? "คัดลอกแล้ว ✓" : "คัดลอกลิงก์"}</Button><Button variant="primary" onClick={onClose}>ปิด</Button></div>}
    >
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <div className="text-sm text-stone-600">{orderLabel}</div>
        <div className="tnum text-6xl font-extrabold tracking-wide text-matcha-800" data-testid="queue-no">{formatQueueNo(queueNo)}</div>
        {url ? <QrCode value={url} size={240} label={`QR คิว ${formatQueueNo(queueNo)}`} /> : <div className="size-60" />}
        <p className="flex items-center gap-1 text-sm text-stone-600"><Icon name="qr" size={18} /> ให้ลูกค้าสแกนเพื่อดูสถานะออเดอร์ของตัวเอง</p>
      </div>
    </Modal>
  );
}
