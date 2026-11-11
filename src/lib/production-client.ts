import { parseCakeLoad, type CakeLoad } from "@/lib/production";

interface RpcClient {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** ภาระงานเค้ก (null ถ้าอ่านไม่ได้ เช่น ยังไม่ได้ apply migration — POS ทำงานต่อได้ ไม่แสดงตัวเตือน) */
export async function fetchCakeLoad(client: RpcClient): Promise<CakeLoad | null> {
  try {
    const { data, error } = await client.rpc("get_cake_load");
    if (error) return null;
    return parseCakeLoad(data);
  } catch {
    return null;
  }
}
