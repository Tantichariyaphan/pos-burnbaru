import type { Metadata } from "next";
import { fetchPublicQueue } from "@/lib/public-queue";
import { QueueTracker } from "./queue-tracker";

export const dynamic = "force-dynamic";

// ลิงก์มี token: ห้ามส่ง referrer ออกไปเว็บอื่น และห้ามให้ค้นเจอ
export const metadata: Metadata = {
  title: "สถานะคิวของคุณ",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

export default async function QueuePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await fetchPublicQueue(token);
  return <QueueTracker token={token} initial={r.kind === "ok" ? r.queue : null} initialState={r.kind === "ok" ? "live" : r.kind === "not_found" ? "expired" : "offline"} />;
}
