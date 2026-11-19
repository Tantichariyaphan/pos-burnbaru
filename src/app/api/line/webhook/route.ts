import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lineConfig } from "@/lib/line/config";
import { verifyLineSignature } from "@/lib/line/signature";
import { replyMessage } from "@/lib/line/client";
import { matchMessage, type BusinessIntent, type KeywordRow } from "@/lib/chatbot";

export const dynamic = "force-dynamic";

interface LineEvent {
  type: string; replyToken?: string; source?: { userId?: string };
  message?: { type: string; text?: string };
}

const liff = () => {
  const id = process.env.NEXT_PUBLIC_LIFF_ID;
  return id ? `https://liff.line.me/${id}` : null;
};

/** Webhook บาง: ตรวจลายเซ็น → แยกเหตุการณ์ → ส่งต่อบริการ (ฐานข้อมูล) → ตอบกลับ; ไม่มีตรรกะรางวัล/คูปองที่นี่ */
export async function POST(req: Request) {
  const cfg = lineConfig();
  if (!cfg) return NextResponse.json({ success: false, error: "LINE_NOT_CONFIGURED" }, { status: 503 });
  const raw = await req.text();
  if (!verifyLineSignature(raw, req.headers.get("x-line-signature"), cfg.channelSecret)) {
    return NextResponse.json({ success: false, error: "INVALID_SIGNATURE" }, { status: 401 });
  }
  let events: LineEvent[] = [];
  try { events = (JSON.parse(raw) as { events?: LineEvent[] }).events ?? []; } catch { return NextResponse.json({ success: true }); }

  const db = createAdminClient();
  for (const ev of events.slice(0, 20)) {
    if (!ev.replyToken) continue;
    const text = await handle(ev, db).catch(() => null);
    if (text) await replyMessage(cfg.channelAccessToken, ev.replyToken, [{ type: "text", text: text.slice(0, 4900) }]);
  }
  return NextResponse.json({ success: true });
}

type Db = ReturnType<typeof createAdminClient>;

async function handle(ev: LineEvent, db: Db): Promise<string | null> {
  const link = liff();
  if (ev.type === "follow") {
    return `ขอบคุณที่เพิ่มเพื่อน BURN BARU ค่ะ 🔥\nสมัครสมาชิกเพื่อสะสมแต้มและรับสิทธิ์พิเศษ${link ? `\n${link}` : ""}`;
  }
  if (ev.type !== "message" || ev.message?.type !== "text" || !ev.message.text) return null;
  const userId = ev.source?.userId;

  const { data: kw } = await db.from("chat_keywords").select("keyword,response_text").eq("active", true).limit(500);
  const m = matchMessage(ev.message.text, (kw ?? []) as KeywordRow[]);
  if (m.kind === "keyword") return m.text;
  if (m.kind === "none") return null;
  return userId ? businessReply(m.intent, userId, db, link) : null;
}

async function businessReply(intent: BusinessIntent, userId: string, db: Db, link: string | null): Promise<string> {
  const { data } = await db.rpc("liff_get_member", { p_line_user_id: userId });
  const d = data as { linked?: boolean; member?: { name: string; member_no: string; points: number; stamps: number; tier_name: string }; coupons_available?: number } | null;
  if (!d?.linked || !d.member) return `ยังไม่ได้สมัครสมาชิกค่ะ สมัครได้ที่${link ? `\n${link}` : "หน้าร้าน"}`;
  const m = d.member;
  const more = link ? `\nดูรายละเอียด: ${link}` : "";
  switch (intent) {
    case "points": return `แต้มสะสม ${m.points} แต้ม · แสตมป์ ${m.stamps} ดวง (ระดับ ${m.tier_name})${more}`;
    case "coupons": return `คุณมีคูปองที่ใช้ได้ ${d.coupons_available ?? 0} ใบ${more}`;
    case "rewards": return `ดูและแลกรางวัลได้ในบัตรสมาชิก${more}`;
    default: return `${m.name} · ${m.member_no} · ระดับ ${m.tier_name}\nแต้ม ${m.points} · แสตมป์ ${m.stamps}${more}`;
  }
}
