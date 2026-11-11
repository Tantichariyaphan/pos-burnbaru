import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BurnBaru — POS",
  description: "ระบบขายหน้าร้านสำหรับ BurnBaru",
  appleWebApp: { capable: true, title: "BurnBaru POS", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#6d0212",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="antialiased">{children}</body>
    </html>
  );
}
