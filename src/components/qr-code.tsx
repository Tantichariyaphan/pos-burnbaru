import { encodeQr, qrSvgPath } from "@/lib/qr";

/** QR แบบ SVG (วาดฝั่งเบราว์เซอร์/เซิร์ฟเวอร์ ไม่เรียกบริการภายนอก — token ไม่ถูกส่งออกนอกระบบ) */
export function QrCode({ value, size = 220, label }: { value: string; size?: number; label?: string }) {
  let svg: { d: string; dimension: number } | null = null;
  try {
    svg = qrSvgPath(encodeQr(value, "M"), 3);
  } catch {
    svg = null;
  }
  if (!svg) return <div className="grid place-items-center text-sm text-refund" style={{ width: size, height: size }}>สร้าง QR ไม่ได้</div>;
  return (
    <svg
      role="img" aria-label={label ?? "QR code"} width={size} height={size} viewBox={`0 0 ${svg.dimension} ${svg.dimension}`}
      shapeRendering="crispEdges" className="rounded-lg bg-white"
    >
      <rect width={svg.dimension} height={svg.dimension} fill="#fff" />
      <path d={svg.d} fill="#000" />
    </svg>
  );
}
