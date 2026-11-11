"use client";
export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="min-h-11 rounded-xl bg-matcha-700 px-5 font-medium text-white active:bg-matcha-800">
      พิมพ์ใบเสร็จ
    </button>
  );
}
