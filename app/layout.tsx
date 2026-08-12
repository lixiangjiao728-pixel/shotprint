import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  return {
    title: "镜谱 Shotprint",
    description: "AI 短片逐镜拆解与创作模板生成器",
    metadataBase,
    openGraph: {
      title: "镜谱 Shotprint",
      description: "把一条短片拆成可复用的创作蓝图",
      images: [{ url: new URL("/og.png", metadataBase).toString(), width: 1760, height: 917 }],
    },
  };
}

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
