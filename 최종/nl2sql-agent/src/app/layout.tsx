import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const pretendard = localFont({
  src: "../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NL2SQL Agent",
  description: "Semantic Layer 기반 검증형 NL2SQL 에이전트",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${pretendard.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <nav aria-label="서비스 이동" className="sticky top-0 z-50 flex items-center gap-2 border-b border-neutral-800 bg-neutral-950 px-6 py-2 text-xs text-neutral-300">
          <strong className="mr-3 tracking-widest text-white">OTT PULSE</strong>
          <a className="rounded px-3 py-1.5 hover:bg-neutral-800 hover:text-white" href="https://hackathon-journey-dashboard.vercel.app/">대시보드</a>
          <a className="rounded px-3 py-1.5 hover:bg-neutral-800 hover:text-white" href="https://hackathon-journey-dashboard.vercel.app/insights">지표 연관 지도</a>
          <a aria-current="page" className="rounded bg-neutral-800 px-3 py-1.5 text-white" href="/">NL2SQL 분석</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
