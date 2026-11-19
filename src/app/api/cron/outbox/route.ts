import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lineConfig } from "@/lib/line/config";
import { pushMessage } from "@/lib/line/client";
import { buildNotification } from "@/lib/line/messages";
import { dispatchOutbox } from "@/lib/outbox-dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m) return false;
  const a = Buffer.from(m[1]); const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** GET|POST /api/cron/outbox — Bearer CRON_SECRET: สร้างงานตามเวลา (วันเกิด/Come Back/คูปองใกล้หมด) แล้วส่งคิวแจ้งเตือน */
async function run(req: Request) {
  if (!authorized(req)) return NextResponse.json({ success: false, error: "PERMISSION_DENIED", code: "PERMISSION_DENIED", message: "unauthorized" }, { status: 401 });
  const cfg = lineConfig();
  if (!cfg) return NextResponse.json({ success: false, error: "LINE_NOT_CONFIGURED", code: "LINE_NOT_CONFIGURED", message: "LINE ยังไม่ได้ตั้งค่า" }, { status: 503 });
  const db = createAdminClient();
  const sched = await db.rpc("membership_enqueue_scheduled");
  const sent = await dispatchOutbox(db, { token: cfg.channelAccessToken, liffUrl: liffUrl(), push: pushMessage, build: buildNotification });
  return NextResponse.json({ success: true, data: { scheduled: sched.error ? null : sched.data, ...sent }, message: "ok" });
}

export const GET = run;
export const POST = run;

function liffUrl() {
  const id = process.env.NEXT_PUBLIC_LIFF_ID;
  return id ? `https://liff.line.me/${id}` : null;
}
