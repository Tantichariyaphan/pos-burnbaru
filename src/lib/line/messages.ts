/** ข้อความแจ้งเตือนตามชนิดเหตุการณ์ใน notification_outbox (ข้อความล้วน ไม่ใส่ข้อมูลลับ/โทเคน) */
import type { LineMessage } from "./client";

type P = Record<string, unknown>;
const n = (v: unknown) => (typeof v === "number" ? v : 0);
const s = (v: unknown) => (typeof v === "string" ? v : "");
const date = (v: unknown) => {
  const d = new Date(s(v));
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" });
};

export function buildNotification(event: string, payload: P, memberName: string | null, liffUrl: string | null): LineMessage[] {
  const hi = memberName ? `คุณ${memberName}` : "คุณลูกค้า";
  const link = liffUrl ? `\nดูบัตรสมาชิก: ${liffUrl}` : "";
  let text: string;
  switch (event) {
    case "member_registered":
      text = `ยินดีต้อนรับสู่ BURN BARU CLUB ค่ะ ${hi} 🔥\nเริ่มสะสมแต้มและรับสิทธิ์พิเศษได้ทันที${link}`; break;
    case "first_purchase":
    case "points_earned": {
      const parts: string[] = [];
      if (n(payload.points) > 0) parts.push(`+${n(payload.points)} แต้ม (คงเหลือ ${n(payload.points_balance)})`);
      if (n(payload.stamps) > 0) parts.push(`+${n(payload.stamps)} แสตมป์ (คงเหลือ ${n(payload.stamps_balance)})`);
      text = `ขอบคุณที่อุดหนุนค่ะ ${hi}\n${parts.join("\n") || "บันทึกการซื้อเรียบร้อย"}${link}`; break;
    }
    case "tier_upgraded":
      text = `ยินดีด้วยค่ะ ${hi} 🎉 คุณเลื่อนเป็นระดับ ${s(payload.tier_name)}${link}`; break;
    case "coupon_issued":
      text = `คุณได้รับคูปอง: ${s(payload.title)}\nใช้ได้ถึง ${date(payload.expires_at)}${link}`; break;
    case "birthday":
      text = `สุขสันต์วันเกิดค่ะ ${hi} 🎂 รับคูปอง: ${s(payload.title)}\nใช้ได้ถึง ${date(payload.expires_at)}${link}`; break;
    case "points_redeemed":
      text = `แลกสิทธิ์สำเร็จ: ${s(payload.title)}${link}`; break;
    case "queue_ready":
      text = `ออเดอร์ของ ${hi} พร้อมรับแล้วค่ะ ☕`; break;
    case "coupon_expiring":
      text = `คูปอง ${s(payload.title)} ใกล้หมดอายุ (${date(payload.expires_at)})${link}`; break;
    case "comeback":
      text = `คิดถึงนะคะ ${hi} แวะมาที่ร้านแล้วใช้สิทธิ์สมาชิกได้เลย${link}`; break;
    default:
      text = `มีข้อความใหม่จาก BURN BARU${link}`;
  }
  return [{ type: "text", text: text.slice(0, 4900) }];
}
