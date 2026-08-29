import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_TC } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const noto = Noto_Sans_TC({
  variable: "--font-noto",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const mono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GrantOnce 分匣授權",
  description: "只准這一次，而且只准這一匣。用授權匣把補助申請的資料範圍鎖死。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-Hant-TW"
      className={`${geist.variable} ${noto.variable} ${mono.variable} light h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-[#F6F3EE] text-stone-800">{children}</body>
    </html>
  );
}
