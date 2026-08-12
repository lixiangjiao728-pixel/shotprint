import type { AnalysisResult } from "./analysis.ts";

const shot = (id: string, startMs: number, endMs: number, action: string, narrativeFunction: string, confidence: number, palette: string[]): AnalysisResult["shots"][number] => ({
  id, startMs, endMs, transcript: id === "S05" ? "“裁员名单上，根本没有我的名字。”" : id === "S01" ? "“今天，是我被裁掉的第 37 天。”" : "",
  shotSize: Number(id.slice(1)) % 3 === 0 ? "特写" : Number(id.slice(1)) % 2 === 0 ? "近景" : "中景",
  camera: Number(id.slice(1)) % 2 === 0 ? "微低机位" : "平视",
  motion: Number(id.slice(1)) % 3 === 0 ? "快速推近" : "克制手持",
  action, lighting: "窗侧冷光 + 桌面暖光分区", palette, audio: "低频环境音，切点处保留半拍静默",
  narrativeFunction, evidence: `动作与字幕在 ${Math.round(startMs / 100) / 10}s 同时换义`, confidence, localBoundary: startMs > 0,
});

export const demoAnalysis: AnalysisResult = {
  version: "1.0",
  metadata: { title: "被裁掉的女孩 · 演示样片", durationMs: 20800, aspectRatio: "9:16", language: "中文", analyzedAt: "2026-07-30T00:00:00.000Z" },
  shots: [
    shot("S01", 0, 2600, "女孩抱着纸箱站在写字楼旋转门外，手机弹出第 37 次拒信。", "3 秒身份钩子", .97, ["#2E3947", "#D6A655"]),
    shot("S02", 2600, 5100, "前同事隔着玻璃举杯，女孩的倒影被门框切成两半。", "建立失衡", .92, ["#73839A", "#161B22"]),
    shot("S03", 5100, 7200, "她在出租屋把拒信贴满墙，镜头突然推向一张异常邮件。", "线索出现", .95, ["#A8C7C0", "#F2B84B"]),
    shot("S04", 7200, 9400, "键盘、监控画面、门禁记录三连快切。", "节奏升级", .89, ["#101218", "#7167A9"]),
    shot("S05", 9400, 12100, "她发现裁员名单没有自己，真正被删除的是事故证据。", "核心反转", .98, ["#BFC9C5", "#D6A655"]),
    shot("S06", 12100, 15100, "女孩换上西装走回公司，纸箱里藏着录音笔。", "主动权逆转", .94, ["#222733", "#A8C7C0"]),
    shot("S07", 15100, 17800, "会议室门打开，所有人回头，声音先于画面切入。", "高潮前悬停", .91, ["#D9D5C9", "#7167A9"]),
    shot("S08", 17800, 20800, "黑屏上出现‘第 38 天，我把公司裁了’，留出续集问题。", "回扣与追更钩子", .96, ["#101218", "#F2B84B"]),
  ],
  narrative: {
    logline: "一个以为自己被裁掉的女孩发现，离职只是公司掩盖事故的假象，于是带着证据重返会议室。",
    hook: "身份困境 + 精确天数，在 2.6 秒内完成代入。",
    conflict: "求职失败的表层冲突，很快转为‘谁篡改了她的身份记录’。",
    escalation: "静态困境后接三连快切，让调查从情绪变成行动。",
    reversal: "名单上没有她：被删除的不是职位，而是事故证据。",
    climax: "她带录音笔回到会议室，声音先行制造权力反转。",
    resolution: "不交代会议结果，用一句身份回扣换取追更。",
    pace: [
      { label: "钩子", timeMs: 0, intensity: 55 }, { label: "线索", timeMs: 5100, intensity: 68 },
      { label: "快切", timeMs: 7200, intensity: 84 }, { label: "反转", timeMs: 9400, intensity: 96 },
      { label: "蓄力", timeMs: 15100, intensity: 72 }, { label: "尾钩", timeMs: 20800, intensity: 92 },
    ],
    stats: { averageShotSeconds: 2.6, fastestShotSeconds: 2.1, dialogueRatio: .34 },
  },
  productionHypotheses: [
    { category: "生成工作流", estimate: "角色定妆图 → 图生视频分镜 → 剪辑统一颗粒", evidence: "人物服装稳定但手部运动刻意减少", confidence: .72 },
    { category: "镜头参数", estimate: "28–50mm 等效焦段；慢推为主，反转处速度翻倍", evidence: "透视压缩温和，反转镜头景别在 0.8 秒内变化", confidence: .81 },
    { category: "光色", estimate: "冷灰环境 + 琥珀线索色，反转后提高局部对比", evidence: "线索物始终落在暖色区域", confidence: .88 },
    { category: "模型边界", estimate: "无法从成片可靠还原 seed、checkpoint 或精确提示词", evidence: "成片只保留输出特征，不包含生成元数据", confidence: .99 },
  ],
  reusableTemplate: {
    storyVariables: ["[失去身份/资源的主角]", "[重复失败的精确计数]", "[被篡改的证据]", "[重返权力空间的动作]"],
    beatSheet: ["0–13%：一句精确数字标记困境", "13–35%：用空间反射放大失衡", "35–45%：异常线索打断静态节奏", "45–58%：三连快切把情绪转成调查", "58–72%：事实反转并重定义前文", "72–86%：主角主动进入冲突", "86–100%：声音先行 + 身份句回扣"],
    globalVisualRules: ["9:16 竖屏；人物眼线位于上三分之一", "冷灰承担现实，琥珀只标记线索", "每 3 个稳定镜头允许 1 次强运动", "反转前后保留 4–6 帧听觉空白"],
    shotPrompts: ["[中景] 主角被玻璃/门框分割，冷色自然光，克制手持", "[特写] 关键证据占画面 40%，背景人物失焦，快速推近", "[近景] 主角重新进入权力空间，微低机位，步伐与低频节拍同步"],
    negativeConstraints: ["不复刻原角色面孔、台词或作品标识", "避免无意义镜头漂移、塑料皮肤、手部特写", "不声称能还原精确模型、seed 或 checkpoint"],
    editAndSound: ["前 7 秒平均镜长 2.5 秒", "反转前插入 3 个 0.6–0.8 秒信息镜头", "高潮门开前让声音领先画面 6–10 帧", "尾句后保留 0.8 秒黑屏"],
  },
  warnings: ["这是版权安全的合成演示，不对应真实作品。", "生产参数是基于画面证据的推测，不是源工程恢复。"],
  provenance: { model: "内置演示 fixture", localCutCount: 7, note: "零 API 消耗；固定数据用于体验和测试。" },
};
