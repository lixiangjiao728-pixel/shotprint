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
  palette: z.array(z.string()).min(1),
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

export function validateEvidenceCoverage(result: AnalysisResult, expectedDurationMs: number) {
  const sorted = [...result.shots].sort((a, b) => a.startMs - b.startMs);
  if (Math.abs(result.metadata.durationMs - expectedDurationMs) > 500) return "duration_mismatch";
  if (!sorted.length || sorted[0].startMs > 500 || sorted.at(-1)!.endMs < expectedDurationMs - 500) return "timeline_incomplete";
  if (expectedDurationMs >= 15_000 && sorted.length < 3) return "shot_evidence_insufficient";
  for (let index = 0; index < sorted.length; index += 1) {
    const shot = sorted[index];
    if (shot.endMs <= shot.startMs || shot.endMs > expectedDurationMs + 500) return "timecode_invalid";
    if (index > 0 && shot.startMs > sorted[index - 1].endMs + 500) return "timeline_gap";
    if (!shot.evidence.trim() || shot.evidence.trim().toLowerCase() === "unknown") return "visual_evidence_missing";
  }
  return null;
}

export const DEMO_BOUNDARIES = [0, 2600, 5100, 7200, 9400, 12100, 15100, 17800, 20800];

export function calculateCutRecall(expected: number[], actual: number[], toleranceMs = 500) {
  const targets = expected.filter((value) => value > 0 && value < expected.at(-1)!);
  const matches = targets.filter((target) => actual.some((candidate) => Math.abs(candidate - target) <= toleranceMs));
  return targets.length === 0 ? 1 : matches.length / targets.length;
}

export function normalizeAnalysis(input: unknown, localCuts: number[]): AnalysisResult {
  const parsed = analysisResultSchema.parse(input);
  const internalCuts = localCuts.filter((cut) => cut > 0 && cut < parsed.metadata.durationMs);
  return {
    ...parsed,
    shots: parsed.shots.map((shot) => ({
      ...shot,
      localBoundary: internalCuts.some((cut) => Math.abs(cut - shot.startMs) <= 500),
    })),
    provenance: { ...parsed.provenance, localCutCount: internalCuts.length },
  };
}

export function analysisToMarkdown(result: AnalysisResult) {
  const shots = result.shots.map((shot, index) =>
    `### ${String(index + 1).padStart(2, "0")} · ${formatTime(shot.startMs)}–${formatTime(shot.endMs)}\n- 画面：${shot.action}\n- 镜头：${shot.shotSize} / ${shot.camera} / ${shot.motion}\n- 叙事作用：${shot.narrativeFunction}\n- 证据：${shot.evidence}（${Math.round(shot.confidence * 100)}%）`,
  ).join("\n\n");
  return `# ${result.metadata.title} · 镜谱分析\n\n> ${result.narrative.logline}\n\n## 逐镜拆解\n\n${shots}\n\n## 可复用节拍\n\n${result.reusableTemplate.beatSheet.map((item) => `- ${item}`).join("\n")}\n\n## 全局视觉规则\n\n${result.reusableTemplate.globalVisualRules.map((item) => `- ${item}`).join("\n")}\n`;
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
