import type { SupabaseClient } from "@supabase/supabase-js";
import type { LineMessage, SendResult } from "@/lib/line/client";

interface OutboxRow {
  id: string; category: string; event_type: string; payload: Record<string, unknown>; attempts: number;
  line_user_id: string | null; member_name: string | null;
}
interface Deps {
  token: string;
  liffUrl: string | null;
  push: (token: string, to: string, messages: LineMessage[], retryKey: string) => Promise<SendResult>;
  build: (event: string, payload: Record<string, unknown>, name: string | null, liffUrl: string | null) => LineMessage[];
}

/** ดึงงานจาก outbox → ส่ง LINE → บันทึกผล. ความล้มเหลวในการส่งไม่กระทบธุรกรรมธุรกิจที่เสร็จไปแล้ว */
export async function dispatchOutbox(db: SupabaseClient, deps: Deps, limit = 30) {
  const { data, error } = await db.rpc("outbox_claim", { p_limit: limit });
  if (error) return { claimed: 0, sent: 0, failed: 0 };
  const rows = (data ?? []) as OutboxRow[];
  let sent = 0; let failed = 0;
  for (const r of rows) {
    if (!r.line_user_id) { await db.rpc("outbox_complete", { p_id: r.id, p_ok: false, p_error: "NO_LINE", p_retryable: false }); failed++; continue; }
    const msgs = deps.build(r.event_type, r.payload, r.member_name, deps.liffUrl);
    const res = await deps.push(deps.token, r.line_user_id, msgs, r.id);
    await db.rpc("outbox_complete", { p_id: r.id, p_ok: res.ok, p_error: res.ok ? null : res.error ?? "send failed", p_retryable: res.retryable });
    if (res.ok) sent++; else failed++;
  }
  return { claimed: rows.length, sent, failed };
}
