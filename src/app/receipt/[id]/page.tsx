import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { getEmployee } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ORDER_SELECT } from "@/lib/queries";
import { formatBaht } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { formatOrderNo, METHOD_LABEL } from "@/lib/order-status";
import { QrCode } from "@/components/qr-code";
import { formatQueueNo, queueUrl, TOKEN_RE } from "@/lib/production";
import type { Order, Settings } from "@/types/db";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const emp = await getEmployee();
  if (!emp || !emp.active) redirect("/login");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: o }, { data: st }] = await Promise.all([
    supabase.from("orders").select(ORDER_SELECT).eq("id", id).maybeSingle(),
    supabase.from("settings").select("shop_name,receipt_footer").maybeSingle(),
  ]);
  if (!o) notFound();
  const order = o as unknown as Order;
  const settings = st as Pick<Settings, "shop_name" | "receipt_footer"> | null;
  const { data: rf } = await supabase.from("refunds").select("amount_satang").eq("order_id", id);
  const refunded = ((rf as { amount_satang: number }[] | null) ?? []).reduce((s, r) => s + r.amount_satang, 0);
  const pay = order.payments[0];

  // คิว/QR (เพิ่มภายหลัง — ถ้ายังไม่ได้ติดตั้งระบบคิวหรือไม่มีคิว จะไม่แสดงอะไรเลย ใบเสร็จเดิมไม่เปลี่ยน)
  const { data: qrow } = await supabase.from("order_queues").select("queue_no,public_token,status").eq("order_id", id).maybeSingle();
  const queue = qrow as { queue_no: number; public_token: string; status: string } | null;
  let trackUrl: string | null = null;
  if (queue && queue.status !== "cancelled" && TOKEN_RE.test(queue.public_token)) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) trackUrl = queueUrl(`${h.get("x-forwarded-proto") ?? "https"}://${host}`, queue.public_token);
  }

  return (
    <main className="mx-auto min-h-dvh max-w-[380px] p-4 print:max-w-none print:p-0">
      <div className="no-print mb-3 flex gap-2">
        <PrintButton />
        <a href="/pos" className="inline-flex min-h-11 items-center rounded-xl border border-stone-300 bg-white px-4">กลับหน้า POS</a>
      </div>
      <article className="rounded-2xl bg-white p-5 text-[14px] shadow print:w-[72mm] print:rounded-none print:p-0 print:shadow-none">
        <header className="text-center">
          <h1 className="text-base font-bold text-[#6d0212]">{settings?.shop_name === "Grandfa Farm Cafe & Resort" ? "BurnBaru" : settings?.shop_name ?? "BurnBaru"}</h1>
          <p className="text-xs text-stone-500">ใบเสร็จรับเงิน</p>
        </header>
        <div className="my-3 flex justify-between text-xs text-stone-600">
          <span>ออเดอร์ {formatOrderNo(order.order_no)}</span>
          <span>{formatDateTime(order.created_at)}</span>
        </div>
        <hr className="border-dashed border-stone-300" />
        <ul className="my-2 space-y-1.5">
          {order.order_items.map((i) => (
            <li key={i.id}>
              <div className="flex justify-between gap-2">
                <span>{i.quantity} × {i.product_name}</span>
                <span className="tnum">{formatBaht(i.line_total_satang)}</span>
              </div>
              <div className="tnum text-xs text-stone-500">@{formatBaht(i.unit_price_satang)}
                {i.addons.map((a) => ` + ${a.name} ${formatBaht(a.price_satang)}`).join("")}
              </div>
            </li>
          ))}
        </ul>
        <hr className="border-dashed border-stone-300" />
        <dl className="my-2 space-y-1">
          <div className="flex justify-between"><dt>รวมรายการ</dt><dd className="tnum">{formatBaht(order.subtotal_satang)}</dd></div>
          {order.discount_satang > 0 && (
            <div className="flex justify-between"><dt>ส่วนลด{order.discount_name ? ` (${order.discount_name})` : ""}</dt><dd className="tnum">−{formatBaht(order.discount_satang)}</dd></div>
          )}
          <div className="flex justify-between text-base font-bold"><dt>ยอดสุทธิ</dt><dd className="tnum">{formatBaht(order.total_satang)}</dd></div>
          {pay && (
            <>
              <div className="flex justify-between"><dt>ชำระด้วย{METHOD_LABEL[pay.method]}</dt><dd className="tnum">{formatBaht(pay.received_satang)}</dd></div>
              {pay.method === "cash" && <div className="flex justify-between"><dt>เงินทอน</dt><dd className="tnum">{formatBaht(pay.change_satang)}</dd></div>}
              {pay.reference && <div className="flex justify-between text-xs text-stone-500"><dt>อ้างอิง</dt><dd>{pay.reference}</dd></div>}
            </>
          )}
          {refunded > 0 && <div className="flex justify-between text-refund"><dt>คืนเงินแล้ว</dt><dd className="tnum">−{formatBaht(refunded)}</dd></div>}
        </dl>
        <hr className="border-dashed border-stone-300" />
        {queue && queue.status !== "cancelled" && (
          <div className="my-3 text-center" data-testid="receipt-queue">
            <p className="text-xs text-stone-500">หมายเลขคิวของคุณ</p>
            <p className="tnum text-3xl font-extrabold text-[#6d0212]">{formatQueueNo(queue.queue_no)}</p>
            {trackUrl && (
              <div className="mt-1 flex flex-col items-center gap-1">
                <QrCode value={trackUrl} size={120} label="QR ติดตามคิว" />
                <p className="text-xs text-stone-500">สแกนเพื่อดูสถานะออเดอร์</p>
              </div>
            )}
            <hr className="mt-3 border-dashed border-stone-300" />
          </div>
        )}
        <p className="mt-3 text-center text-xs text-stone-500">{settings?.receipt_footer}</p>
      </article>
    </main>
  );
}
