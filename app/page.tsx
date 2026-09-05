import type { Metadata } from "next";
import ShotprintStudio from "./ShotprintStudio";

export const metadata: Metadata = {
  title: "镜谱 Shotprint — 别抄爆款，拆懂它",
  description: "粘贴一条视频链接，看清观众为什么愿意看下去，找出真正起作用的镜头和节奏。",
};

export default function Home() {
  return <ShotprintStudio />;
}
