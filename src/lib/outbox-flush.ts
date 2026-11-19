import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { lineConfig } from "@/lib/line/config";
import { pushMessage } from "@/lib/line/client";
import { buildNotification } from "@/lib/line/messages";
import { dispatchOutbox } from "@/lib/outbox-dispatch";

/** ส่งคิวแจ้งเตือนทันทีหลังชำระเงิน (ถ้าตั้งค่า LINE ไว้) — กลืนข้อผิดพลาดเพราะ outbox เก็บงานไว้ให้ cron ลองใหม่อยู่แล้ว */
export async function flushOutboxSoon(): Promise<void> {
  try {
    const cfg = lineConfig();
    if (!cfg || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
    const id = process.env.NEXT_PUBLIC_LIFF_ID;
    await dispatchOutbox(createAdminClient(), {
      token: cfg.channelAccessToken, liffUrl: id ? `https://liff.line.me/${id}` : null, push: pushMessage, build: buildNotification,
    }, 10);
  } catch {
    // งานยังอยู่ใน notification_outbox (pending/sending) และถูกส่งซ้ำโดย /api/cron/outbox
  }
}
