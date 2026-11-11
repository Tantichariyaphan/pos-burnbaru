/**
 * ตัวสร้าง QR Code (QR Model 2, โหมด byte, เวอร์ชัน 1–10, ECC L/M) — ไม่พึ่งแพ็กเกจภายนอก
 * ออกแบบตามขั้นตอนมาตรฐาน ISO/IEC 18004 (Reed–Solomon บน GF(256), mask 0–7 เลือกคะแนนปรับต่ำสุด)
 * ผ่านการถอดรหัสด้วย OpenCV QRCodeDetector ตอนพัฒนา (ดู tests/unit/qr.test.ts สำหรับ golden hash)
 */
export type QrEcc = "L" | "M";

const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const ECC_PER_BLOCK: Record<QrEcc, number[]> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
};
const NUM_BLOCKS: Record<QrEcc, number[]> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
};
const FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0 };
export const QR_MAX_VERSION = 10;

const getBit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0;

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}
function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

function dataCapacityBytes(version: number, ecc: QrEcc): number {
  return TOTAL_CODEWORDS[version] - ECC_PER_BLOCK[ecc][version] * NUM_BLOCKS[ecc][version];
}

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function chooseVersion(bytes: number, ecc: QrEcc): number {
  for (let v = 1; v <= QR_MAX_VERSION; v++) {
    const countBits = v <= 9 ? 8 : 16;
    const needBits = 4 + countBits + bytes * 8;
    if (needBits <= dataCapacityBytes(v, ecc) * 8) return v;
  }
  throw new RangeError(`ข้อความยาวเกินไปสำหรับ QR (สูงสุดประมาณ ${dataCapacityBytes(QR_MAX_VERSION, ecc) - 3} ไบต์)`);
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const numAlign = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function buildCodewords(bytes: number[], version: number, ecc: QrEcc): number[] {
  const bits: number[] = [];
  const push = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capBits = dataCapacityBytes(version, ecc) * 8;
  push(0, Math.min(4, capBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }

  const numBlocks = NUM_BLOCKS[ecc][version];
  const blockEcc = ECC_PER_BLOCK[ecc][version];
  const raw = TOTAL_CODEWORDS[version];
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(blockEcc);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - blockEcc + (i < numShort ? 0 : 1));
    k += dat.length;
    const e = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(e));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => { if (i !== shortLen - blockEcc || j >= numShort) out.push(block[i]); });
  }
  return out;
}

class Grid {
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];
  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  setFn(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }
  drawFunctionPatterns(ecc: QrEcc) {
    const size = this.size;
    for (let i = 0; i < size; i++) { this.setFn(6, i, i % 2 === 0); this.setFn(i, 6, i % 2 === 0); }
    this.finder(3, 3); this.finder(size - 4, 3); this.finder(3, size - 4);
    const pos = alignmentPositions(this.version);
    const n = pos.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      this.alignment(pos[i], pos[j]);
    }
    this.drawFormat(ecc, 0);   // จองพื้นที่ (เขียนค่าจริงหลังเลือก mask)
    this.drawVersion();
  }
  private finder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.setFn(xx, yy, dist !== 2 && dist !== 4);
    }
  }
  private alignment(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.setFn(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  drawFormat(ecc: QrEcc, mask: number) {
    const data = (FORMAT_BITS[ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const size = this.size;
    for (let i = 0; i <= 5; i++) this.setFn(8, i, getBit(bits, i));
    this.setFn(8, 7, getBit(bits, 6));
    this.setFn(8, 8, getBit(bits, 7));
    this.setFn(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) this.setFn(size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFn(8, size - 15 + i, getBit(bits, i));
    this.setFn(8, size - 8, true);
  }
  private drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = this.size - 11 + (i % 3), b = Math.floor(i / 3);
      this.setFn(a, b, getBit(bits, i)); this.setFn(b, a, getBit(bits, i));
    }
  }
  placeData(codewords: number[]) {
    let i = 0;
    const size = this.size;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!this.isFunction[y][x] && i < codewords.length * 8) {
          this.modules[y][x] = getBit(codewords[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }
  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
      let invert: boolean;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
    }
  }
  penalty(): number {
    const size = this.size, m = this.modules;
    let score = 0;
    const lineScore = (get: (i: number) => boolean) => {
      let s = 0, run = 1;
      for (let i = 1; i < size; i++) {
        if (get(i) === get(i - 1)) { run++; if (run === 5) s += 3; else if (run > 5) s += 1; } else run = 1;
      }
      // รูปแบบคล้าย finder (1:1:3:1:1) ที่มีพื้นสว่าง 4 ช่องข้างเคียง
      for (let i = 0; i + 11 <= size; i++) {
        const w = (k: number) => get(i + k);
        const a = w(0) && !w(1) && w(2) && w(3) && w(4) && !w(5) && w(6);
        if (a && ((!w(7) && !w(8) && !w(9) && !w(10)))) s += 40;
        const b = w(4) && !w(5) && w(6) && w(7) && w(8) && !w(9) && w(10);
        if (b && !w(0) && !w(1) && !w(2) && !w(3)) s += 40;
      }
      return s;
    };
    for (let y = 0; y < size; y++) score += lineScore((i) => m[y][i]);
    for (let x = 0; x < size; x++) score += lineScore((i) => m[i][x]);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
    let dark = 0;
    for (const row of m) for (const c of row) if (c) dark++;
    const total = size * size;
    score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;   // ≈ ทุก 5% ที่เบี่ยงจาก 50%
    return score;
  }
}

export interface QrCode { version: number; size: number; modules: boolean[][]; mask: number; ecc: QrEcc }

/** สร้างเมทริกซ์ QR (true = โมดูลสีเข้ม) — ไม่รวม quiet zone */
export function encodeQr(text: string, ecc: QrEcc = "M"): QrCode {
  const bytes = utf8(text);
  const version = chooseVersion(bytes.length, ecc);
  const codewords = buildCodewords(bytes, version, ecc);
  const grid = new Grid(version);
  grid.drawFunctionPatterns(ecc);
  grid.placeData(codewords);
  let bestMask = 0, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    grid.applyMask(mask);
    grid.drawFormat(ecc, mask);
    const s = grid.penalty();
    if (s < bestScore) { bestScore = s; bestMask = mask; }
    grid.applyMask(mask);   // ยกเลิก (XOR ซ้ำ)
  }
  grid.applyMask(bestMask);
  grid.drawFormat(ecc, bestMask);
  return { version, size: grid.size, modules: grid.modules, mask: bestMask, ecc };
}

/** path ของ SVG (หน่วยโมดูล) สำหรับวาดเป็นรูปเดียว: <svg viewBox="0 0 N N"><path d=…/></svg> */
export function qrSvgPath(qr: QrCode, margin = 4): { d: string; dimension: number } {
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    let x = 0;
    while (x < qr.size) {
      if (!qr.modules[y][x]) { x++; continue; }
      let run = 1;
      while (x + run < qr.size && qr.modules[y][x + run]) run++;
      parts.push(`M${x + margin} ${y + margin}h${run}v1h-${run}z`);
      x += run;
    }
  }
  return { d: parts.join(""), dimension: qr.size + margin * 2 };
}
