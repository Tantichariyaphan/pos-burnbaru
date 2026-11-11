import { test } from "node:test";
import assert from "node:assert/strict";
import { SyncController } from "../../src/lib/sync-controller";

/** เซิร์ฟเวอร์จำลอง: เก็บสถานะ + ตอบช้า/เร็วตามที่ทดสอบกำหนด */
function setup() {
  let server = "preparing";
  const applied: string[] = [];
  const resolvers: Array<() => void> = [];
  const fetchSnapshots: string[] = [];
  const ctrl = new SyncController<string>(
    async () => {
      const snapshot = server;          // ข้อมูล ณ ตอนเริ่มโหลด (อาจเก่าเมื่อตอบกลับมา)
      fetchSnapshots.push(snapshot);
      await new Promise<void>((res) => resolvers.push(res));
      return snapshot;
    },
    { onApply: (v) => applied.push(v), onError: () => applied.push("ERROR") },
  );
  return { ctrl, applied, release: (i: number) => resolvers[i](), setServer: (v: string) => { server = v; }, fetchSnapshots };
}

test("บั๊ก DONE: poll ที่เริ่มก่อนกดและตอบช้า ต้องไม่ทับสถานะใหม่", async () => {
  const { ctrl, applied, release, setServer } = setup();
  const poll = ctrl.refresh();                         // poll เริ่มตอนเซิร์ฟเวอร์ยังเป็น "preparing"
  const mutation = ctrl.track(async () => { setServer("done"); });   // ผู้ใช้กด DONE สำเร็จ
  await mutation;
  assert.equal(ctrl.mutating, false);
  release(0);                                          // poll เก่าตอบกลับมา (ข้อมูลเก่า)
  assert.equal(await poll, "superseded");               // ถูกทิ้ง เพราะมี refresh ใหม่จากการกด
  release(1);                                          // refresh หลังกด ตอบกลับ (ข้อมูลใหม่)
  assert.equal(await ctrl.lastRefresh, "applied");
  assert.deepEqual(applied, ["done"]);                  // ไม่เคยแสดงค่าเก่า
});

test("ระหว่างที่การกดยังไม่เสร็จ poll ที่ตอบกลับต้องถูกทิ้ง (ไม่ทับ optimistic UI)", async () => {
  const { ctrl, applied, release } = setup();
  let finish!: () => void;
  const mutation = ctrl.track(() => new Promise<void>((res) => { finish = res; }));
  const poll = ctrl.refresh();
  release(0);
  assert.equal(await poll, "discarded");
  assert.deepEqual(applied, []);
  finish(); await mutation;
  release(1);
  assert.equal(await ctrl.lastRefresh, "applied");
});

test("refresh หลังกดไม่ถูกข้าม แม้มี poll ค้างอยู่ (บั๊กเดิม: refreshing.current)", async () => {
  const { ctrl, fetchSnapshots } = setup();
  void ctrl.refresh();                                 // poll ค้าง
  await ctrl.track(async () => {});
  assert.equal(fetchSnapshots.length, 2);               // มี refresh ใหม่จริง
});

test("กดหลายครั้งซ้อนกัน: ผลสุดท้ายมาจาก refresh ล่าสุดเสมอ", async () => {
  const { ctrl, applied, release, setServer } = setup();
  const a = ctrl.track(async () => { setServer("a"); });
  const b = ctrl.track(async () => { setServer("b"); });
  await Promise.all([a, b]);
  release(0); release(1);
  await ctrl.lastRefresh;
  assert.deepEqual(applied.slice(-1), ["b"]);
});

test("track ล้มเหลว: โยนข้อผิดพลาดต่อ แต่ยัง refresh เพื่อคืนสถานะจริงจากเซิร์ฟเวอร์", async () => {
  const { ctrl, applied, release } = setup();
  await assert.rejects(ctrl.track(async () => { throw new Error("network"); }), /network/);
  release(0);
  assert.equal(await ctrl.lastRefresh, "applied");
  assert.deepEqual(applied, ["preparing"]);
  assert.equal(ctrl.mutating, false);
});

test("ข้อผิดพลาดของ refresh รายงานผ่าน onError และไม่ทำให้ค้าง", async () => {
  const errors: unknown[] = [];
  const c = new SyncController<number>(async () => { throw new Error("boom"); }, { onApply: () => {}, onError: (e) => errors.push(e) });
  assert.equal(await c.refresh(), "error");
  assert.equal(errors.length, 1);
});
