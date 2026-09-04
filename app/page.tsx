import type { Metadata } from "next";
import ShotprintStudio from "./ShotprintStudio";

export const metadata: Metadata = {
  title: "镜谱 Shotprint — 别让爆款只躺在收藏夹",
  description: "粘贴一条视频链接，看懂观众反应，拆开镜头节奏，把值得借鉴的方法带进你的下一条内容。",
};

export default function Home() {
  return <ShotprintStudio />;
}
