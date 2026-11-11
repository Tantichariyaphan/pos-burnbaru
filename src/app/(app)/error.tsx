"use client";
import { Button } from "@/components/ui";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="glass max-w-md rounded-3xl p-6 text-center">
        <div className="text-3xl">⚠️</div>
        <h2 className="mt-2 text-lg font-semibold">เกิดข้อผิดพลาด</h2>
        <p className="mt-1 text-sm text-stone-600">โหลดหน้านี้ไม่สำเร็จ กรุณาลองใหม่ ข้อมูลที่บันทึกแล้วไม่สูญหาย</p>
        <p className="mt-2 break-words text-xs text-stone-400">{error.message}</p>
        <Button variant="primary" className="mt-4" onClick={reset}>ลองใหม่</Button>
      </div>
    </div>
  );
}
