"use client";
import { useEffect, useState } from "react";
import { orderMembership } from "@/app/actions/members";
import { ClaimQr } from "@/components/claim-qr";
import { Notice } from "@/components/ui";
import type { MemberCard } from "@/types/db";

type Info =
  | { linked: true; points_earned: number; stamps_earned: number; member: MemberCard }
  | { linked: false; claimable: boolean };

/** หลังชำระเงิน: สรุปแต้มที่ได้ หรือ (ลูกค้าทั่วไป) QR ให้สแกนรับแต้มย้อนหลัง / (สมาชิกยังไม่ผูก LINE) QR ผูก LINE */
export function MemberResult({ orderId, enabled }: { orderId: string; enabled: boolean }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    // ทริกเกอร์ฝั่งฐานข้อมูลทำงานพร้อมการชำระ แต่ถ้ายังไม่เห็นผล ลองอีกครั้งสั้น ๆ
    void (async () => {
      for (let i = 0; i < 3 && alive; i++) {
        const r = await orderMembership(orderId);
        if (!alive) return;
        if (r.ok) { setInfo(r.data as unknown as Info); return; }
        if (i === 2) setError(r.error);
        await new Promise((res) => setTimeout(res, 600));
      }
    })();
    return () => { alive = false; };
  }, [orderId, enabled]);

  if (!enabled) return null;
  if (error) return <div className="mt-3"><Notice tone="warn">ยังตรวจสอบแต้มของออเดอร์นี้ไม่ได้: {error}</Notice></div>;
  if (!info) return null;

  return (
    <div className="mt-4 rounded-2xl border border-stone-200 bg-white/80 p-3 text-left text-sm" data-testid="member-result">
      {info.linked ? (
        <>
          <div className="font-semibold">{info.member.name} · {info.member.member_no}</div>
          <div className="text-matcha-800">
            ได้รับ {info.points_earned > 0 && <b className="tnum">+{info.points_earned} แต้ม </b>}
            {info.stamps_earned > 0 && <b className="tnum">+{info.stamps_earned} แสตมป์ </b>}
            {info.points_earned === 0 && info.stamps_earned === 0 && "บันทึกการซื้อแล้ว"}
          </div>
          <div className="text-stone-600">คงเหลือ {info.member.points} แต้ม · {info.member.stamps} แสตมป์ · ระดับ {info.member.tier_name}</div>
          {!info.member.has_line && <ClaimQr purpose="link" customerId={info.member.customer_id} label="QR ผูกบัญชี LINE" />}
        </>
      ) : info.claimable ? (
        <ClaimQr purpose="claim" orderId={orderId} label="ให้ลูกค้าสแกน QR รับแต้ม" />
      ) : null}
      {error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}
    </div>
  );
}
