/**
 * ตัวควบคุมการซิงก์ข้อมูลฝั่ง client — แก้ปัญหา "ข้อมูลเก่าจาก polling ทับสถานะที่เพิ่งเปลี่ยน"
 *
 * ปัญหาเดิม (POS): กด DONE → หน้าจอเปลี่ยนทันที (optimistic) แต่ polling ที่เริ่มโหลด "ก่อนกด" ตอบกลับมาทีหลัง
 * แล้วเขียนทับด้วยสถานะเก่า (ปุ่มเด้งกลับ ต้องกดซ้ำ) และ refresh หลังกดถูกข้ามเพราะมีรอบโหลดค้างอยู่
 *
 * กติกา:
 *  1) refresh ทุกครั้งได้เลขลำดับ; ผลของรอบที่ "ไม่ใช่รอบล่าสุด" ถูกทิ้ง (superseded)
 *  2) ระหว่างมีการเปลี่ยนสถานะค้างอยู่ (track) หรือมีการเปลี่ยนเกิดขึ้นระหว่างที่โหลด → ทิ้งผล (discarded)
 *  3) เมื่อ track จบ (สำเร็จหรือล้มเหลว) จะ refresh ใหม่ทันที (ไม่ถูกข้าม) เพื่อให้หน้าจอตรงกับเซิร์ฟเวอร์เสมอ
 */
export type RefreshResult = "applied" | "superseded" | "discarded" | "error";

export class SyncController<T> {
  private fetchSeq = 0;
  private pending = 0;
  private mutationSeq = 0;
  /** promise ของ refresh ล่าสุดที่เริ่มจาก track (ใช้ในการทดสอบ) */
  lastRefresh: Promise<RefreshResult> = Promise.resolve("applied");

  constructor(
    private readonly fetcher: () => Promise<T>,
    private readonly handlers: { onApply: (value: T) => void; onError: (error: unknown) => void },
  ) {}

  get mutating(): boolean {
    return this.pending > 0;
  }

  async refresh(): Promise<RefreshResult> {
    const mine = ++this.fetchSeq;
    const mutationAtStart = this.mutationSeq;
    try {
      const next = await this.fetcher();
      if (mine !== this.fetchSeq) return "superseded";
      if (this.pending > 0 || mutationAtStart !== this.mutationSeq) return "discarded";
      this.handlers.onApply(next);
      return "applied";
    } catch (e) {
      if (mine === this.fetchSeq) this.handlers.onError(e);
      return "error";
    }
  }

  /** ครอบการเปลี่ยนสถานะ (เรียกเซิร์ฟเวอร์) — จบแล้ว refresh เสมอ */
  async track<R>(fn: () => Promise<R>): Promise<R> {
    this.pending++;
    this.mutationSeq++;
    try {
      return await fn();
    } finally {
      this.pending--;
      this.mutationSeq++;
      this.lastRefresh = this.refresh();
    }
  }
}
