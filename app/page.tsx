import type { Metadata } from "next";
import ShotprintStudio from "./ShotprintStudio";

export const metadata: Metadata = {
  title: "镜谱 Shotprint — 把一条短片拆成可复用的创作蓝图",
  description: "逐镜拆解 AI 短片，分析叙事节奏，反推生产参数，生成可迁移的创作模板。",
};

export default function Home() {
  return <ShotprintStudio />;
}
