export const TZ = "Asia/Bangkok";

/** วันที่ธุรกิจปัจจุบัน (Asia/Bangkok) รูปแบบ YYYY-MM-DD */
export function bangkokToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function formatTime(iso: string | Date): string {
  return new Intl.DateTimeFormat("th-TH", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(
    typeof iso === "string" ? new Date(iso) : iso,
  );
}

export function formatDateTime(iso: string | Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

export function formatDate(isoDate: string): string {
  // isoDate = YYYY-MM-DD (ไม่แปลงเขตเวลาซ้ำ)
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function isIsoDate(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}
