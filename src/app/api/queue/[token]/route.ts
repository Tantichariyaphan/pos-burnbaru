import { NextResponse } from "next/server";
import { fetchPublicQueue } from "@/lib/public-queue";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

/** GET /api/queue/<token> → DTO ขั้นต่ำของออเดอร์เดียว (ดูรายการ/สถานะ/จำนวนคิวก่อนหน้าเท่านั้น) */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await fetchPublicQueue(token);
  if (r.kind === "ok") return NextResponse.json(r.queue, { headers: HEADERS });
  if (r.kind === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404, headers: HEADERS });
  return NextResponse.json({ error: "unavailable" }, { status: 503, headers: HEADERS });
}
