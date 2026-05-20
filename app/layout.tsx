import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "광주지구 여름수련회 차량 관리",
  description: "CCC 71기 여름수련회 차량 신청·배차·정산 시스템",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 폰트는 globals.css의 Pretendard CDN + --font-sans (next/font 불필요)
  return (
    <html lang="ko" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
