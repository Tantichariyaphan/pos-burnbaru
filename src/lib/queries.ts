import { stationStatusOf, type QueueStatus, type StationStatus } from "@/lib/production";
/** select string ที่ใช้ร่วมกันทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์ (อ่านภายใต้ RLS) */
export const ORDER_SELECT =
  "id,order_no,business_date,subtotal_satang,discount_name,discount_satang,total_satang,payment_status,prep_status,created_at,prepared_at,employee_id," +
  "order_items(id,product_name,category_name,unit_price_satang,addons,addon_unit_satang,quantity,line_total_satang)," +
  "payments(method,amount_satang,received_satang,change_satang,reference)";

export function satangToInput(s: number): string {
  return s % 100 === 0 ? String(s / 100) : (s / 100).toFixed(2);
}

// ---------- คิว (ส่วนเสริม): ดึงแยกจาก ORDER_SELECT เพื่อไม่ให้ POS พังถ้ายังไม่ได้ apply migration 0004 ----------

export interface OrderQueueInfo {
  id: string; queue_no: number; public_token: string; status: QueueStatus; version: number;
  cake_status: StationStatus | null; drink_status: StationStatus | null;
}
export const QUEUE_SELECT = "id,order_id,queue_no,public_token,status,version,item_preparations(station,status)";

interface QueueRow {
  id: string; order_id: string; queue_no: number; public_token: string; status: QueueStatus; version: number;
  item_preparations: { station: "cake" | "drink"; status: "queued" | "preparing" | "ready" | "cancelled" }[];
}
// เฉพาะส่วนที่ใช้ของ Supabase client (ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์)
export interface QueueReader {
  from: (table: string) => { select: (cols: string) => { in: (col: string, values: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }> } };
}

/** คืน {} ถ้าอ่านไม่ได้ (เช่น ยังไม่ได้ apply migration) — POS ทำงานแบบเดิมได้ต่อ */
export async function fetchQueuesFor(client: QueueReader, orderIds: string[]): Promise<Record<string, OrderQueueInfo>> {
  if (orderIds.length === 0) return {};
  try {
    const { data, error } = await client.from("order_queues").select(QUEUE_SELECT).in("order_id", orderIds);
    if (error || !Array.isArray(data)) return {};
    const out: Record<string, OrderQueueInfo> = {};
    for (const r of data as QueueRow[]) {
      out[r.order_id] = {
        id: r.id, queue_no: r.queue_no, public_token: r.public_token, status: r.status, version: r.version,
        cake_status: stationStatusOf(r.item_preparations.filter((p) => p.station === "cake").map((p) => p.status)),
        drink_status: stationStatusOf(r.item_preparations.filter((p) => p.station === "drink").map((p) => p.status)),
      };
    }
    return out;
  } catch {
    return {};
  }
}
