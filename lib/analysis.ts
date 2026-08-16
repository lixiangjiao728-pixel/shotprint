import { z } from "zod";

export const shotSchema = z.object({
  id: z.string().min(1),
  startMs: z.number().nonnegative(),
  endMs: z.number().positive(),
  transcript: z.string(),
  shotSize: z.string(),
  camera: z.string(),
  motion: z.string(),
  action: z.string(),
  lighting: z.string(),
  palette: z.array(z.string()),
  audio: z.string(),
  narrativeFunction: z.string(),
  evidence: z.string(),
  confidence: z.number().min(0).max(1),
  localBoundary: z.boolean(),
});

export const analysisResultSchema = z.object({
  version: z.literal("1.0"),
  metadata: z.object({
    title: z.string(),
    durationMs: z.number().positive(),
    aspectRatio: z.string(),
    language: z.string(),
    analyzedAt: z.string(),
  }),
  shots: z.array(shotSchema).min(1),
  narrative: z.object({
    logline: z.string(),
    hook: z.string(),
    conflict: z.string(),
    escalation: z.string(),
    reversal: z.string(),
    climax: z.string(),
    resolution: z.string(),
    pace: z.array(z.object({ label: z.string(), timeMs: z.number(), intensity: z.number().min(0).max(100) })).min(3),
    stats: z.object({ averageShotSeconds: z.number().positive(), fastestShotSeconds: z.number().positive(), dialogueRatio: z.number().min(0).max(1) }),
  }),
  productionHypotheses: z.array(z.object({
    category: z.string(),
    estimate: z.string(),
    evidence: z.string(),
    confidence: z.number().min(0).max(1),
  })).min(1),
  reusableTemplate: z.object({
    storyVariables: z.array(z.string()),
    beatSheet: z.array(z.string()),
    globalVisualRules: z.array(z.string()),
    shotPrompts: z.array(z.string()),
    negativeConstraints: z.array(z.string()),
    editAndSound: z.array(z.string()),
  }),
  warnings: z.array(z.string()),
  provenance: z.object({ model: z.string(), localCutCount: z.number().nonnegative(), note: z.string() }),
});

export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type Shot = z.infer<typeof shotSchema>;

function hasNarrativeCoverage(pace: AnalysisResult["narrative"]["pace"], durationMs: number) {
  const times = pace.map((point) => point.timeMs);
  return times.some((time) => time <= durationMs * .15)
    && times.some((time) => time >= durationMs * .35 && time <= durationMs * .65)
    && times.some((time) => time >= durationMs * .85);
}

function evidenceSoundPlan(audio: string) {
  if (/对白|旁白|说话|人声/.test(audio)) return "保留原创对白或旁白，并在句尾设置声音落点";
  if (/音乐|节拍|旋律|鼓点/.test(audio)) return "使用原创音乐，在画面变化处对齐节拍落点";
  if (/音效|环境声|脚步|碰撞|风声|水声/.test(audio)) return "保留同类环境声与原创音效，不复用原素材声音";
  return "使用原创环境声，并在动作完成处设置音效落点";
}

function derivedTemplate(result: AnalysisResult): AnalysisResult["reusableTemplate"] {
  const shots = sampleTimelineItems(result.shots, Math.min(6, Math.max(3, result.shots.length)));
  const phaseShots = Array.from({ length: 3 }, (_, index) => shots[Math.round(index * (shots.length - 1) / 2)]);
  const averageSeconds = result.narrative.stats.averageShotSeconds.toFixed(1);
  const fastestSeconds = result.narrative.stats.fastestShotSeconds.toFixed(1);
  const beatShots = shots.length >= 3 ? shots : phaseShots;
  const beatSheet = beatShots.map((shot, index) => {
    const startMs = shots.length >= 3 ? shot.startMs : index * result.metadata.durationMs / 3;
    const endMs = shots.length >= 3 ? shot.endMs : (index + 1) * result.metadata.durationMs / 3;
    const startPercent = Math.round(startMs / result.metadata.durationMs * 100);
    const endPercent = Math.round(endMs / result.metadata.durationMs * 100);
    return `${startPercent}–${endPercent}%（${(startMs / 1000).toFixed(1)}–${(endMs / 1000).toFixed(1)}秒）：执行“${shot.narrativeFunction}”，沿用其信息释放顺序但改用原创人物、场景与事件。`;
  });
  const globalVisualRules = phaseShots.map((shot, index) => {
    const colors = shot.palette.length ? `，主色参考 ${shot.palette.slice(0, 2).join(" / ")}` : "";
    return `阶段${index + 1}：采用${shot.shotSize}、${shot.camera}与${shot.motion}；光线按“${shot.lighting}”控制${colors}，相邻镜头保持光向和视线连续。`;
  });
  const shotPrompts = shots.slice(0, Math.max(3, Math.min(6, shots.length))).map((shot) => {
    const durationSeconds = Math.max(.1, (shot.endMs - shot.startMs) / 1000).toFixed(1);
    const colors = shot.palette.length ? `色彩使用 ${shot.palette.slice(0, 2).join(" 与 ")}` : "色彩以现场可控主色为准";
    return `[原创主体]在[原创场景]完成与“${shot.narrativeFunction}”对应的明确动作；${shot.shotSize}，${shot.camera}，${shot.motion}，${shot.lighting}，${colors}，建议时长${durationSeconds}秒；${evidenceSoundPlan(shot.audio)}。`;
  });
  const transitionShot = shots[Math.max(0, Math.floor(shots.length * .65))];
  return {
    storyVariables: ["[原创主体：替换原人物身份]", "[原创冲突：保留信息差机制但重写事件]", "[原创场景：使用不同地点、道具与视觉标识]"],
    beatSheet,
    globalVisualRules,
    shotPrompts,
    negativeConstraints: ["不复制原人物身份、肖像或角色关系", "不复用原台词、旁白、音乐或可识别声音", "不使用原作品名称、标识、道具设计或受保护 IP"],
    editAndSound: [
      `平均镜长控制在约${averageSeconds}秒，信息转折处可缩短至约${fastestSeconds}秒。`,
      `在${(transitionShot.startMs / 1000).toFixed(1)}秒附近设置主要剪辑与原创声音落点，转折前保留0.3秒呼吸。`,
      `片尾保留0.8秒画面与原创尾音，检查对白、音乐和音效均不复用原素材。`,
    ],
  };
}

export function validateEvidenceCoverage(result: AnalysisResult, expectedDurationMs: number, localCuts: number[] = []) {
  const sorted = [...result.shots].sort((a, b) => a.startMs - b.startMs);
  if (Math.abs(result.metadata.durationMs - expectedDurationMs) > 500) return "duration_mismatch";
  if (!sorted.length || sorted[0].startMs > 500 || sorted.at(-1)!.endMs < expectedDurationMs - 500) return "timeline_incomplete";
  if (expectedDurationMs >= 15_000 && sorted.length < 3) return "shot_evidence_insufficient";
  if (expectedDurationMs >= 120_000 && sorted.length < Math.ceil(expectedDurationMs / 60_000) + 1) return "long_video_evidence_sparse";
  for (let index = 0; index < sorted.length; index += 1) {
    const shot = sorted[index];
    if (shot.endMs <= shot.startMs || shot.endMs > expectedDurationMs + 500) return "timecode_invalid";
    if (index > 0 && shot.startMs > sorted[index - 1].endMs + 500) return "timeline_gap";
    if (!shot.evidence.trim() || shot.evidence.trim().toLowerCase() === "unknown") return "visual_evidence_missing";
  }
  if (!hasNarrativeCoverage(result.narrative.pace, expectedDurationMs)) return "narrative_coverage_incomplete";
  const internalCuts = localCuts.filter((cut) => cut > 0 && cut < expectedDurationMs);
  if (internalCuts.length >= 4) {
    const modelBoundaries = sorted.slice(1).map((shot) => shot.startMs);
    const matched = internalCuts.filter((cut) => modelBoundaries.some((boundary) => Math.abs(boundary - cut) <= 1500)).length;
    if (matched / internalCuts.length < .45) return "local_cut_recall_low";
  }
  return null;
}

export function validateActionability(result: AnalysisResult) {
  const template = result.reusableTemplate;
  if (template.storyVariables.length < 3) return "story_variables_insufficient";
  if (template.beatSheet.length < 3 || template.beatSheet.filter((item) => /\d|%|秒|分钟/.test(item)).length < Math.ceil(template.beatSheet.length / 2)) return "beat_sheet_not_operational";
  if (template.globalVisualRules.length < 3) return "visual_rules_insufficient";
  if (template.shotPrompts.length < Math.min(3, result.shots.length)
    || template.shotPrompts.some((item) => item.length < 16 || !/主体|人物|动作|景|镜头|机位|运动|推近|手持|光|色|声音|秒/.test(item))) return "shot_prompts_not_operational";
  if (template.negativeConstraints.length < 3) return "negative_constraints_insufficient";
  if (template.editAndSound.length < 3 || !template.editAndSound.some((item) => /\d|帧|秒|节拍|音乐|音效|对白|旁白/.test(item))) return "edit_sound_plan_not_operational";
  return null;
}

export function sampleTimelineItems<T extends { startMs: number; endMs: number }>(items: T[], limit: number) {
  if (items.length <= limit) return items;
  if (limit < 2) return items.slice(0, Math.max(0, limit));
  const indices = Array.from({ length: limit }, (_, index) => Math.round(index * (items.length - 1) / (limit - 1)));
  return [...new Set(indices)].map((index) => items[index]);
}

export function sampleAuditCuts(cuts: number[], durationMs: number, limit = 23) {
  const internal = [...new Set(cuts
    .filter((cut) => Number.isFinite(cut) && cut > 0 && cut < durationMs)
    .map((cut) => Math.round(cut)))]
    .sort((a, b) => a - b);
  if (internal.length <= limit) return [0, ...internal, durationMs];
  const sampled = Array.from({ length: limit }, (_, index) => internal[Math.round(index * (internal.length - 1) / (limit - 1))]);
  return [0, ...new Set(sampled), durationMs];
}

export const DEMO_BOUNDARIES = [0, 2600, 5100, 7200, 9400, 12100, 15100, 17800, 20800];

export function calculateCutRecall(expected: number[], actual: number[], toleranceMs = 500) {
  const targets = expected.filter((value) => value > 0 && value < expected.at(-1)!);
  const matches = targets.filter((target) => actual.some((candidate) => Math.abs(candidate - target) <= toleranceMs));
  return targets.length === 0 ? 1 : matches.length / targets.length;
}

export function normalizeAnalysis(input: unknown, localCuts: number[], expectedDurationMs?: number): AnalysisResult {
  const parsed = analysisResultSchema.parse(input);
  const durationMs = expectedDurationMs ?? parsed.metadata.durationMs;
  const internalCuts = localCuts.filter((cut) => cut > 0 && cut < durationMs);
  const sorted = [...parsed.shots].sort((a, b) => a.startMs - b.startMs);
  const starts = sorted.reduce<number[]>((values, shot, index) => {
    if (index === 0) return [0];
    const previous = values[index - 1];
    const minimum = previous + 1;
    const maximum = durationMs - (sorted.length - index);
    values.push(Math.min(maximum, Math.max(minimum, Math.round(shot.startMs))));
    return values;
  }, []);
  const shots = sorted.map((shot, index) => {
    const startMs = starts[index];
    return {
      ...shot,
      id: `shot-${String(index + 1).padStart(2, "0")}`,
      startMs,
      endMs: index === sorted.length - 1 ? durationMs : starts[index + 1],
      localBoundary: internalCuts.some((cut) => Math.abs(cut - startMs) <= 500),
    };
  });
  const totalShotSeconds = shots.reduce((sum, shot) => sum + Math.max(0, shot.endMs - shot.startMs), 0) / 1000;
  const dialogueSeconds = shots.reduce((sum, shot) => /^(unknown|无|none)$/i.test(shot.transcript.trim()) ? sum : sum + Math.max(0, shot.endMs - shot.startMs) / 1000, 0);
  let pace = [...parsed.narrative.pace].sort((a, b) => a.timeMs - b.timeMs);
  if (pace.length >= 3 && !hasNarrativeCoverage(pace, durationMs)) {
    pace = pace.map((point, index) => ({ ...point, timeMs: Math.round(index * durationMs / (pace.length - 1)) }));
  }
  const normalized: AnalysisResult = {
    ...parsed,
    metadata: { ...parsed.metadata, durationMs },
    shots,
    narrative: {
      ...parsed.narrative,
      pace,
      stats: {
        averageShotSeconds: shots.length ? totalShotSeconds / shots.length : parsed.narrative.stats.averageShotSeconds,
        fastestShotSeconds: shots.length ? Math.min(...shots.map((shot) => (shot.endMs - shot.startMs) / 1000)) : parsed.narrative.stats.fastestShotSeconds,
        dialogueRatio: totalShotSeconds ? Math.min(1, dialogueSeconds / totalShotSeconds) : 0,
      },
    },
    provenance: { ...parsed.provenance, localCutCount: internalCuts.length },
  };
  return validateActionability(normalized) ? { ...normalized, reusableTemplate: derivedTemplate(normalized) } : normalized;
}

export function analysisToMarkdown(result: AnalysisResult) {
  const shots = result.shots.map((shot, index) =>
    `### ${String(index + 1).padStart(2, "0")} · ${formatTime(shot.startMs)}–${formatTime(shot.endMs)}\n- 画面：${shot.action}\n- 镜头：${shot.shotSize} / ${shot.camera} / ${shot.motion}\n- 叙事作用：${shot.narrativeFunction}\n- 证据：${shot.evidence}（${Math.round(shot.confidence * 100)}%）`,
  ).join("\n\n");
  const bullets = (items: string[]) => items.map((item) => `- ${item}`).join("\n") || "- unknown";
  return `# ${result.metadata.title} · 镜谱分析\n\n> ${result.narrative.logline}\n\n## 逐镜拆解\n\n${shots}\n\n## 可执行节拍\n\n${bullets(result.reusableTemplate.beatSheet)}\n\n## 全局视觉规则\n\n${bullets(result.reusableTemplate.globalVisualRules)}\n\n## 镜头提示词骨架\n\n${bullets(result.reusableTemplate.shotPrompts)}\n\n## 剪辑与声音\n\n${bullets(result.reusableTemplate.editAndSound)}\n\n## 原创边界与失败约束\n\n${bullets(result.reusableTemplate.negativeConstraints)}\n`;
}

export function analysisToCsv(result: AnalysisResult) {
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const header = ["镜号", "开始", "结束", "画面", "景别", "机位", "运动", "叙事作用", "置信度"].map(escape).join(",");
  const rows = result.shots.map((shot, index) => [index + 1, formatTime(shot.startMs), formatTime(shot.endMs), shot.action, shot.shotSize, shot.camera, shot.motion, shot.narrativeFunction, shot.confidence].map(escape).join(","));
  return `\uFEFF${[header, ...rows].join("\n")}`;
}

export function formatTime(ms: number) {
  const seconds = Math.max(0, ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}
