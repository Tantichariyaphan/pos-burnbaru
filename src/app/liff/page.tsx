import type { Metadata } from "next";
import { LiffApp } from "./liff-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "BURN BARU CLUB", robots: { index: false, follow: false } };

export default function LiffPage() {
  return <LiffApp liffId={process.env.NEXT_PUBLIC_LIFF_ID ?? ""} />;
}
