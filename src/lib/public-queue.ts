import "server-only";
import { createAnonClient } from "@/lib/supabase/anon";
import { TOKEN_RE, type PublicQueue } from "@/lib/production";

export type PublicQueueResult = { kind: "ok"; queue: PublicQueue } | { kind: "not_found" } | { kind: "error" };

/** อ่านคิวของลูกค้าด้วย token — token ผิดรูปแบบ/ไม่พบ/หมดอายุ = not_found (ไม่บอกเหตุผล) */
export async function fetchPublicQueue(token: string): Promise<PublicQueueResult> {
  if (!TOKEN_RE.test(token)) return { kind: "not_found" };
  try {
    const { data, error } = await createAnonClient().rpc("get_public_queue", { p_token: token });
    if (error) return { kind: "error" };      // ไม่ log token
    if (!data) return { kind: "not_found" };
    return { kind: "ok", queue: data as PublicQueue };
  } catch {
    return { kind: "error" };
  }
}
