import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HelpUs · 需求雷达",
  description: "从 HN / Reddit / V2EX / GitHub 挖掘的真实需求",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
