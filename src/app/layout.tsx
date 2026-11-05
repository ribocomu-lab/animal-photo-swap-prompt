import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "동물 수경 셀카 만들기",
  description:
    "우리 집 동물 사진 1장만 올리면 검은 수모와 연두색 수경을 쓴 셀카를 만들어 드립니다.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
