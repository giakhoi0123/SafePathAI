import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SafePathAI - Tuyến đường thông minh TP.HCM",
  description:
    "Lộ trình lái xe an toàn thời gian thực dựa trên dữ liệu giao thông, camera và thủy văn tại TP.HCM.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-pearl-100 text-ink-900 antialiased selection:bg-indigo-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}
