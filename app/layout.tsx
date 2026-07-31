import type { Metadata } from "next";
import "./globals.css";

// 제목에 특정 행사를 넣지 않는다. 이 시스템은 행사를 넘겨 가며 계속 쓰는 것이고
// (행사 폴더화, v2.0.0), 실제로 여름수련회가 끝난 뒤 리더십 캠프로 넘어갔다.
// 지금 무슨 행사인지는 화면 안의 행사 선택기가 말한다 — 제목까지 그걸 따라가면
// 행사마다 코드를 고쳐야 한다.
export const metadata: Metadata = {
  title: "광주지구 차량 관리",
  description: "광주지구 CCC 차량 신청·배차·정산 시스템",
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
