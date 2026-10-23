import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SafePathAI - Tuyến đường OpenStreetMap TP.HCM",
  description:
    "Tuyến đường ô tô từ OSRM và OpenStreetMap tại TP.HCM; trạng thái rủi ro minh bạch khi chưa có quan trắc xác minh.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-blue-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}

