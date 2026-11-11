import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cakeForecast, elapsedMinutes, parseCakeLoad, formatElapsed, formatQueueNo, overallStatusOf, resolveStation, stationStatusOf,
  type CakeLoad, type StationRoutes,
} from "../../src/lib/production";

const load = (o: Partial<CakeLoad> = {}): CakeLoad => ({
  capacity: 22, queuedPieces: 0, bakingPieces: 0, bakingStartedAt: null, bakeMinutes: null, activeQueues: 0, byProduct: [], ...o,
});

test("สถานะสถานี: ทุกชิ้นพร้อม = ready, บางชิ้นเริ่ม = preparing, ที่เหลือ queued, ไม่มีงาน = null", () => {
  assert.equal(stationStatusOf([]), null);
  assert.equal(stationStatusOf(["cancelled"]), null);
  assert.equal(stationStatusOf(["queued", "queued"]), "queued");
  assert.equal(stationStatusOf(["queued", "preparing"]), "preparing");
  assert.equal(stationStatusOf(["ready", "queued"]), "preparing");   // เค้กบางชิ้นพร้อม ยังไม่ครบ
  assert.equal(stationStatusOf(["ready", "ready", "cancelled"]), "ready");
});

test("สถานะรวม: ready เมื่อครบทุกสถานีที่ต้องทำเท่านั้น", () => {
  assert.equal(overallStatusOf(null, null), null);
  assert.equal(overallStatusOf("ready", "preparing"), "preparing");   // เกณฑ์ข้อ 6
  assert.equal(overallStatusOf("ready", "queued"), "preparing");
  assert.equal(overallStatusOf("ready", "ready"), "ready");           // เกณฑ์ข้อ 7
  assert.equal(overallStatusOf("ready", null), "ready");              // มีแต่เค้ก
  assert.equal(overallStatusOf(null, "queued"), "queued");
  assert.equal(overallStatusOf("queued", "queued"), "queued");
  assert.equal(overallStatusOf("preparing", null), "preparing");
});

test("เส้นทางสถานี: override สินค้า → หมวด → ค่าเริ่มต้น", () => {
  const routes: StationRoutes = { products: { p1: "drink" }, categories: { c1: "cake" }, defaultStation: "drink" };
  assert.equal(resolveStation("p1", "c1", routes), "drink");
  assert.equal(resolveStation("p2", "c1", routes), "cake");
  assert.equal(resolveStation("p3", "c9", routes), "drink");
  assert.equal(resolveStation("p3", null, { ...routes, defaultStation: "cake" }), "cake");
});

test("ตัวเตือนความจุ: ในรอบ / พอดี / เกิน (28 = 22 + 6)", () => {
  const fit = cakeForecast(load({ queuedPieces: 10 }), 5, 0);
  assert.deepEqual([fit.currentLoad, fit.remaining, fit.afterLoad, fit.exceeds, fit.spillToNext, fit.nextBatchLoad], [10, 12, 15, false, 0, 0]);
  const exact = cakeForecast(load({ queuedPieces: 10 }), 12, 0);
  assert.equal(exact.exceeds, false);
  assert.equal(exact.afterLoad, 22);
  const over = cakeForecast(load({ queuedPieces: 20 }), 8, 0);   // รวม 28
  assert.equal(over.exceeds, true);
  assert.equal(over.afterLoad, 22);
  assert.equal(over.spillToNext, 6);
  assert.equal(over.nextBatchLoad, 6);
  assert.equal(over.batchesNeeded, 2);
  assert.equal(over.remaining, 2);
});

test("ตัวเตือนความจุ: คิวเดิมเต็มรอบแล้ว ตะกร้าทั้งหมดไปรอบถัดไป; ไม่มีเค้กในตะกร้า = ไม่เตือน", () => {
  const full = cakeForecast(load({ queuedPieces: 22 }), 3, 0);
  assert.equal(full.exceeds, true);
  assert.equal(full.spillToNext, 3);
  assert.equal(full.remaining, 0);
  const none = cakeForecast(load({ queuedPieces: 30 }), 0, 0);
  assert.equal(none.exceeds, false);
  assert.equal(none.spillToNext, 0);
  assert.equal(none.waitMinutes, null);
  const big = cakeForecast(load({ queuedPieces: 0 }), 50, 0);   // ตะกร้าใหญ่กว่า 2 รอบ
  assert.equal(big.batchesNeeded, 3);
  assert.equal(big.spillToNext, 28);
});

test("เวลารอ: ประมาณเฉพาะเมื่อร้านตั้งเวลาอบ", () => {
  assert.equal(cakeForecast(load({ queuedPieces: 20 }), 8, 0).waitMinutes, null);
  const now = Date.parse("2026-11-10T09:00:00Z");
  // ไม่มีรอบที่กำลังอบ: 2 รอบ × 15 นาที = 30
  assert.equal(cakeForecast(load({ queuedPieces: 20, bakeMinutes: 15 }), 8, now).waitMinutes, 30);
  // กำลังอบมา 5 นาที (เหลือ 10) + 2 รอบ × 15 = 40
  const baking = load({ queuedPieces: 20, bakeMinutes: 15, bakingPieces: 22, bakingStartedAt: new Date(now - 5 * 60_000).toISOString() });
  assert.equal(cakeForecast(baking, 8, now).waitMinutes, 40);
  // อบเกินเวลาแล้ว (เหลือ 0 ไม่ติดลบ)
  const late = load({ queuedPieces: 0, bakeMinutes: 15, bakingPieces: 22, bakingStartedAt: new Date(now - 40 * 60_000).toISOString() });
  assert.equal(cakeForecast(late, 3, now).waitMinutes, 15);
});

test("ป้ายคิวและเวลาที่ผ่านไป", () => {
  assert.equal(formatQueueNo(7), "Q007");
  assert.equal(formatQueueNo(123), "Q123");
  assert.equal(formatQueueNo(1234), "Q1234");
  const now = Date.parse("2026-11-10T09:30:00Z");
  assert.equal(elapsedMinutes("2026-11-10T09:12:30Z", now), 17);
  assert.equal(elapsedMinutes("2026-11-10T09:45:00Z", now), 0);   // นาฬิกาเครื่องเร็วกว่าเซิร์ฟเวอร์ ไม่ติดลบ
  assert.equal(elapsedMinutes("not-a-date", now), 0);
  assert.equal(formatElapsed(0), "เมื่อครู่");
  assert.equal(formatElapsed(5), "5 นาที");
  assert.equal(formatElapsed(75), "1 ชม. 15 นาที");
});

test("parseCakeLoad: แปลงผล RPC และทนข้อมูลผิดรูป", () => {
  assert.equal(parseCakeLoad(null), null);
  assert.equal(parseCakeLoad({}), null);
  const l = parseCakeLoad({ capacity: 22, bake_minutes: null, queued_pieces: 11, baking_pieces: 0, baking_started_at: null, active_queues: 4,
    by_product: [{ name: "Original", waiting: 7, in_progress: 0 }] });
  assert.deepEqual([l?.capacity, l?.queuedPieces, l?.bakeMinutes, l?.activeQueues, l?.byProduct.length], [22, 11, null, 4, 1]);
});

import { applyHandoverOptimistic, applyStationOptimistic, EMPTY_SNAPSHOT, type ProductionSnapshot, type SnapshotQueue } from "../../src/lib/production";

const queue = (o: Partial<SnapshotQueue> = {}): SnapshotQueue => ({
  queue_id: "q1", order_id: "o1", order_no: 1, queue_no: 1, business_date: "2026-11-10", status: "queued", version: 1,
  created_at: "2026-11-10T09:00:00Z", ready_at: null, completed_at: null, cake_status: "queued", drink_status: "queued",
  items: [
    { id: "i1", station: "cake", name: "Original", quantity: 2, ready_quantity: 0, status: "queued", addons: [], batches: [] },
    { id: "i2", station: "drink", name: "Apple Tea", quantity: 1, ready_quantity: 0, status: "queued", addons: [], batches: [] },
  ],
  ...o,
});
const snap = (qs: SnapshotQueue[]): ProductionSnapshot => ({ ...EMPTY_SNAPSHOT, queues: qs });

test("optimistic: เครื่องดื่มพร้อมแต่เค้กยังไม่พร้อม → ทั้งออเดอร์ยัง preparing และนับยอดใหม่", () => {
  const s = applyStationOptimistic(snap([queue()]), "o1", "drink", "ready");
  const q = s.queues[0];
  assert.equal(q.drink_status, "ready");
  assert.equal(q.cake_status, "queued");
  assert.equal(q.status, "preparing");
  assert.equal(s.counts.ready_for_pickup, 0);
  assert.equal(s.counts.preparing, 1);
  assert.equal(s.drink_totals.length, 0);   // เครื่องดื่มพร้อมแล้ว ไม่นับเป็นงานค้าง
});

test("optimistic: ครบทุกสถานี → ready; ส่งมอบ → completed; ย้อน → ready", () => {
  let s = applyStationOptimistic(snap([queue()]), "o1", "drink", "ready");
  s = applyStationOptimistic(s, "o1", "cake", "ready");
  assert.equal(s.queues[0].status, "ready");
  assert.equal(s.counts.ready_for_pickup, 1);
  s = applyHandoverOptimistic(s, "o1", "completed", "2026-11-10T09:10:00Z");
  assert.equal(s.queues[0].status, "completed");
  assert.equal(s.counts.active_queues, 0);
  s = applyHandoverOptimistic(s, "o1", "ready", "x");
  assert.equal(s.queues[0].status, "ready");
  assert.equal(s.queues[0].completed_at, null);
});

test("optimistic: ไม่แตะออเดอร์อื่น และไม่แก้คิวที่ปิดแล้ว", () => {
  const other = queue({ queue_id: "q2", order_id: "o2", queue_no: 2 });
  const closed = queue({ queue_id: "q3", order_id: "o3", queue_no: 3, status: "completed" });
  const s = applyStationOptimistic(snap([queue(), other, closed]), "o1", "drink", "preparing");
  assert.equal(s.queues[1].status, "queued");
  const s2 = applyStationOptimistic(snap([closed]), "o3", "drink", "preparing");
  assert.equal(s2.queues[0].status, "completed");
});
