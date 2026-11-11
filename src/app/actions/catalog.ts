"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, db, fail, failText, type ActionResult } from "@/lib/actions";
import { bahtToSatang } from "@/lib/money";

const uuid = z.string().uuid();
const name = z.string().trim().min(1, "กรุณากรอกชื่อ").max(100);
const emoji = z.string().trim().max(16).nullable().optional();

function done(): ActionResult {
  revalidatePath("/products");
  revalidatePath("/pos");
  return { ok: true };
}

export async function saveCategory(input: { id?: string; name: string; emoji?: string | null; active: boolean }): Promise<ActionResult> {
  const a = await authorize("products");
  if ("error" in a) return failText(a.error);
  const p = z.object({ id: uuid.optional(), name, emoji, active: z.boolean() }).safeParse(input);
  if (!p.success) return failText(p.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const supabase = await db();
  const row = { name: p.data.name, emoji: p.data.emoji || null, active: p.data.active };
  const { error } = p.data.id
    ? await supabase.from("categories").update(row).eq("id", p.data.id)
    : await supabase.from("categories").insert({ ...row, sort_order: 1000 });
  return error ? fail(error.message) : done();
}

export async function saveProduct(input: {
  id?: string; categoryId: string; name: string; emoji?: string | null;
  priceBaht: string; isActive: boolean; isAvailable: boolean;
}): Promise<ActionResult> {
  const a = await authorize("products");
  if ("error" in a) return failText(a.error);
  const p = z.object({
    id: uuid.optional(), categoryId: uuid, name, emoji, priceBaht: z.string().max(20), isActive: z.boolean(), isAvailable: z.boolean(),
  }).safeParse(input);
  if (!p.success) return failText(p.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const v = p.data;
  let price: number | null = null;
  if (v.priceBaht.trim() !== "") {
    price = bahtToSatang(v.priceBaht);
    if (price === null || price > 10_000_000) return failText("ราคาไม่ถูกต้อง (ใส่ตัวเลข เช่น 59 หรือ 59.50)");
  }
  const supabase = await db();
  const row = {
    category_id: v.categoryId, name: v.name, emoji: v.emoji || null, price_satang: price,
    is_active: v.isActive, is_available: v.isAvailable,
  };
  const { error } = v.id
    ? await supabase.from("products").update(row).eq("id", v.id)
    : await supabase.from("products").insert({ ...row, sort_order: 1000 });
  return error ? fail(error.message) : done();
}

/** ย้ายลำดับขึ้น/ลงภายในกลุ่มเดียวกัน (สินค้า: หมวดเดียวกัน) */
export async function moveItem(input: { table: "categories" | "products" | "addons"; id: string; dir: "up" | "down" }): Promise<ActionResult> {
  const a = await authorize("products");
  if ("error" in a) return failText(a.error);
  const p = z.object({ table: z.enum(["categories", "products", "addons"]), id: uuid, dir: z.enum(["up", "down"]) }).safeParse(input);
  if (!p.success) return failText("ข้อมูลไม่ถูกต้อง");
  const { table, id, dir } = p.data;
  const supabase = await db();
  const { data: me } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  if (!me) return failText("ไม่พบรายการ");
  let q = supabase.from(table).select("id,sort_order,name").order("sort_order").order("name");
  if (table === "products") q = q.eq("category_id", (me as { category_id: string }).category_id);
  const { data: siblings, error } = await q;
  if (error || !siblings) return fail(error?.message);
  const arr = siblings as { id: string; sort_order: number }[];
  const i = arr.findIndex((s) => s.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= arr.length) return { ok: true };
  [arr[i], arr[j]] = [arr[j], arr[i]];
  for (let k = 0; k < arr.length; k++) {
    const want = (k + 1) * 10;
    if (arr[k].sort_order !== want) {
      const { error: e } = await supabase.from(table).update({ sort_order: want }).eq("id", arr[k].id);
      if (e) return fail(e.message);
    }
  }
  return done();
}

export async function saveAddon(input: {
  id?: string; name: string; priceBaht: string; active: boolean; productIds: string[];
}): Promise<ActionResult> {
  const a = await authorize("products");
  if ("error" in a) return failText(a.error);
  const p = z.object({
    id: uuid.optional(), name, priceBaht: z.string().max(20), active: z.boolean(), productIds: z.array(uuid).max(500),
  }).safeParse(input);
  if (!p.success) return failText(p.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const price = bahtToSatang(p.data.priceBaht === "" ? "0" : p.data.priceBaht);
  if (price === null || price > 1_000_000) return failText("ราคาไม่ถูกต้อง");
  const supabase = await db();
  let id = p.data.id;
  if (id) {
    const { error } = await supabase.from("addons").update({ name: p.data.name, price_satang: price, active: p.data.active }).eq("id", id);
    if (error) return fail(error.message);
  } else {
    const { data, error } = await supabase.from("addons")
      .insert({ name: p.data.name, price_satang: price, active: p.data.active, sort_order: 1000 }).select("id").single();
    if (error || !data) return fail(error?.message);
    id = (data as { id: string }).id;
  }
  const del = await supabase.from("product_addons").delete().eq("addon_id", id);
  if (del.error) return fail(del.error.message);
  if (p.data.productIds.length) {
    const ins = await supabase.from("product_addons").insert(p.data.productIds.map((pid) => ({ product_id: pid, addon_id: id })));
    if (ins.error) return fail(ins.error.message);
  }
  return done();
}

export async function saveDiscount(input: {
  id?: string; name: string; kind: "percent" | "fixed"; amount: string; active: boolean;
}): Promise<ActionResult> {
  const a = await authorize("products");
  if ("error" in a) return failText(a.error);
  const p = z.object({
    id: uuid.optional(), name, kind: z.enum(["percent", "fixed"]), amount: z.string().max(20), active: z.boolean(),
  }).safeParse(input);
  if (!p.success) return failText(p.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  let value: number | null;
  if (p.data.kind === "percent") {
    // เปอร์เซ็นต์ → basis points (ทศนิยมได้ 2 ตำแหน่ง เช่น 12.5)
    const bp = bahtToSatang(p.data.amount);   // ใช้ตัวแปลงทศนิยม 2 ตำแหน่งแบบจำนวนเต็มเดียวกัน
    value = bp;
    if (value === null || value <= 0 || value > 10000) return failText("เปอร์เซ็นต์ต้องมากกว่า 0 และไม่เกิน 100");
  } else {
    value = bahtToSatang(p.data.amount);
    if (value === null || value <= 0) return failText("จำนวนเงินส่วนลดไม่ถูกต้อง");
  }
  const supabase = await db();
  const row = { name: p.data.name, kind: p.data.kind, value, active: p.data.active };
  const { error } = p.data.id
    ? await supabase.from("discounts").update(row).eq("id", p.data.id)
    : await supabase.from("discounts").insert(row);
  return error ? fail(error.message) : done();
}
