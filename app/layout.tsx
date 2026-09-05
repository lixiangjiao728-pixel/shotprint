import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  return {
    title: "镜谱 Shotprint",
    description: "看清观众为什么愿意看下去，找出真正起作用的镜头和节奏，把这些方法用进你的下一条视频。",
    metadataBase,
    openGraph: {
      title: "镜谱 Shotprint",
      description: "别抄爆款，拆懂它。",
      images: [{ url: new URL("/og.png", metadataBase).toString(), width: 1737, height: 905 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "镜谱 Shotprint",
      description: "别抄爆款，拆懂它。",
      images: [new URL("/og.png", metadataBase).toString()],
    },
  };
}

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#0b1115",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
