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
  description: "兩把鑰匙才開得了：委託人的簽章，加上機關的法定職務。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-Hant-TW"
      className={`${geist.variable} ${noto.variable} ${mono.variable} light h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-[#EFEAE3] text-stone-900">{children}</body>
    </html>
  );
}
