/** ตรรกะจับคำของแชตบอท (ไม่ใช่ AI): normalize → alias → ตรงทั้งหมด → ตรงบางส่วน → ตัวจัดการธุรกิจ */
export type BusinessIntent = "member_card" | "points" | "coupons" | "rewards";

export interface KeywordRow { keyword: string; response_text: string }

export const normalizeText = (t: string) =>
  t.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);

const ALIASES: Record<string, BusinessIntent> = {
  "บัตรสมาชิก": "member_card", "สมาชิก": "member_card", "member card": "member_card", "member": "member_card", "qr": "member_card",
  "แต้ม": "points", "คะแนน": "points", "แต้มสะสม": "points", "my points": "points", "points": "points",
  "คูปอง": "coupons", "คูปองของฉัน": "coupons", "my coupons": "coupons", "coupon": "coupons",
  "แลกรางวัล": "rewards", "รางวัล": "rewards", "reward": "rewards", "rewards": "rewards",
};

export type Match =
  | { kind: "intent"; intent: BusinessIntent }
  | { kind: "keyword"; text: string }
  | { kind: "none" };

export function matchMessage(raw: string, keywords: KeywordRow[]): Match {
  const t = normalizeText(raw);
  if (!t) return { kind: "none" };
  const alias = ALIASES[t];
  if (alias) return { kind: "intent", intent: alias };
  const norm = keywords.map((k) => ({ k: normalizeText(k.keyword), text: k.response_text }));
  const exact = norm.find((x) => x.k === t);
  if (exact) return { kind: "keyword", text: exact.text };
  const partial = norm.filter((x) => x.k.length >= 2 && t.includes(x.k)).sort((a, b) => b.k.length - a.k.length)[0];
  return partial ? { kind: "keyword", text: partial.text } : { kind: "none" };
}
