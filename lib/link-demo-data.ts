import { buildLinkAnalysis, type LinkAnalysis } from "./link-analysis.ts";

export const demoLinkComments = [
  { id: "fixture-01", text: "第一秒就停住了，这个画面太有冲击力", likes: 421 },
  { id: "fixture-02", text: "这是怎么生成的？想看完整制作过程", likes: 188 },
  { id: "fixture-03", text: "前面以为是奇观，后面居然还有反转", likes: 156 },
  { id: "fixture-04", text: "AI味还是有一点，手部和口型能看出来", likes: 82 },
  { id: "fixture-05", text: "结尾不要停，想看下一集", likes: 109 },
  { id: "fixture-06", text: "这个声音先进去的处理很舒服", likes: 75 },
  { id: "fixture-07", text: "能不能出提示词或者教程", likes: 63 },
  { id: "fixture-08", text: "有点像电影预告片，节奏很紧", likes: 54 },
  { id: "fixture-09", text: "这个转场是怎么做的？", likes: 47 },
  { id: "fixture-10", text: "最后那个问题留得好，评论区都在猜", likes: 39 },
];

export const demoLinkAnalysis: LinkAnalysis = buildLinkAnalysis({
  url: "https://www.douyin.com/video/shotprint-demo-link",
  platform: "douyin",
  title: "AI短片：系统删除了我的身份",
  author: "镜谱演示账号",
  publishedAt: "2026-07-30T12:00:00.000Z",
  durationMs: 20800,
  metrics: { views: 1280000, likes: 102400, comments: 5800, shares: 12600, favorites: 18400 },
  comments: demoLinkComments,
  method: "fixture",
  sources: [
    { title: "抖音用户服务协议（平台边界）", url: "https://www.douyin.com/agreements/?id=6773906068725565448", publishedAt: "2025-09-07" },
    { title: "B站开放平台开发者服务协议（数据边界）", url: "https://open.bilibili.com/agreement/developer-service", publishedAt: "2025-06-04" },
    { title: "小红书开放平台开发者文档", url: "https://open.xiaohongshu.com/document/developer/file/53", publishedAt: "2026-01-01" },
  ],
});
