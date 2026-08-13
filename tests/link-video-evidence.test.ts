import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateEvidenceCoverage } from "../lib/analysis.ts";
import { linkAnalysisSchema } from "../lib/link-analysis.ts";
import { safeSessionPayload, RESEARCH_SESSION_TTL_MS } from "../lib/research-session.ts";

const analysis = {
  version: "1.0" as const,
  metadata: { title: "片段A", durationMs: 15_000, aspectRatio: "9:16", language: "zh", analyzedAt: "2026-08-09T00:00:00.000Z" },
  shots: [
    { id: "shot-01", startMs: 0, endMs: 5_000, transcript: "对白", shotSize: "近景", camera: "平视", motion: "固定", action: "人物进入", lighting: "侧光", palette: ["#111111"], audio: "人声", narrativeFunction: "钩子", evidence: "0–5秒人物进入画面", confidence: .8, localBoundary: false },
    { id: "shot-02", startMs: 5_000, endMs: 10_000, transcript: "unknown", shotSize: "中景", camera: "平视", motion: "推镜", action: "信息揭示", lighting: "冷光", palette: ["#222222"], audio: "音乐", narrativeFunction: "升级", evidence: "5–10秒镜头推进", confidence: .75, localBoundary: true },
    { id: "shot-03", startMs: 10_000, endMs: 15_000, transcript: "旁白", shotSize: "特写", camera: "俯拍", motion: "固定", action: "结果出现", lighting: "逆光", palette: ["#333333"], audio: "旁白与落点音效", narrativeFunction: "反转", evidence: "10–15秒结果揭示", confidence: .82, localBoundary: true },
  ],
  narrative: { logline: "unknown", hook: "unknown", conflict: "unknown", escalation: "unknown", reversal: "unknown", climax: "unknown", resolution: "unknown", pace: [{ label: "a", timeMs: 0, intensity: 10 }, { label: "b", timeMs: 7500, intensity: 50 }, { label: "c", timeMs: 15000, intensity: 30 }], stats: { averageShotSeconds: 5, fastestShotSeconds: 5, dialogueRatio: .5 } },
  productionHypotheses: [{ category: "灯光", estimate: "侧光", evidence: "人物侧脸明暗分界", confidence: .7 }],
  reusableTemplate: { storyVariables: [], beatSheet: [], globalVisualRules: [], shotPrompts: [], negativeConstraints: [], editAndSound: [] },
  warnings: [], provenance: { model: "fixture", localCutCount: 2, note: "fixture" },
};

test("video evidence rejects fixed duration, missing timeline coverage, and fewer than three shots", () => {
  assert.equal(validateEvidenceCoverage(analysis, 15_000), null);
  assert.equal(validateEvidenceCoverage({ ...analysis, metadata: { ...analysis.metadata, durationMs: 20_800 } }, 15_000), "duration_mismatch");
  assert.equal(validateEvidenceCoverage({ ...analysis, shots: analysis.shots.slice(0, 2) }, 15_000), "timeline_incomplete");
  assert.equal(validateEvidenceCoverage({ ...analysis, shots: [analysis.shots[0], { ...analysis.shots[1], startMs: 7_000 }] }, 15_000), "timeline_incomplete");
});

test("link.3 accepts the new audiovisual receipt and rejects legacy ambiguous fields", () => {
  const fixture = {
    version: "link.3", analysisStatus: "complete", videoStatus: "provided",
    source: { platform: "douyin", url: "https://www.douyin.com/video/1", canonicalUrl: "https://www.douyin.com/video/1", title: "A", author: "A", metrics: {} },
    collection: { method: "manual", status: "complete", sampleCount: 30, collectedAt: "2026-08-09T00:00:00.000Z", warnings: [] },
    audience: { emotions: [{ label: "好奇", share: 1, evidenceCount: 30 }], themes: [{ label: "故事", summary: "讨论故事", sampleCount: 30, sampleQuotes: ["好看"], confidence: .8 }], audienceNeeds: ["故事"], comments: [] },
    viralFactors: [{ title: "传播", summary: "证据", evidence: ["source:SRC-01"], counterEvidence: [], confidence: .7 }],
    director: { thesis: "叙事", audience: "观众", beats: [], strengths: [], improvements: [] },
    production: { cinematography: [], artAndLight: [], editing: [], sound: [], aiWorkflow: [], difficulty: [] },
    playbook: { directions: [], recommendedDirection: "原创", brief: { logline: "故事", audience: "观众", emotion: "好奇", durationMs: 15000, aspectRatio: "9:16" }, beats: [], shots: [], visualBible: [], promptSkeletons: [], editAndSound: [], budgetOptions: [], experiments: [], risks: [] },
    socialContext: { timeline: [], socialDrivers: [], audienceConsensus: [], controversies: [], externalFactors: [], unknowns: [] },
    videoEvidence: { acquisition: "download_upload", durationMs: 15000, aspectRatio: "9:16", audioStatus: "detected", visualStatus: "complete", shotCount: 3, analyzedAt: "2026-08-09T00:00:00.000Z", warnings: [] },
    sources: [], searchReceipt: { provider: "bailian", status: "complete", sourceCount: 0, retrievedAt: "2026-08-09T00:00:00.000Z" },
    evidence: { coveragePercent: 80, timecodes: [], sourceCount: 0, notes: [] }, warnings: [], provenance: { model: "fixture", collector: "manual", analyzedAt: "2026-08-09T00:00:00.000Z", note: "fixture" },
  };
  assert.equal(linkAnalysisSchema.safeParse(fixture).success, true);
  assert.equal(linkAnalysisSchema.safeParse({ ...fixture, videoEvidence: { acquisition: "upload", audioPresent: true, durationMs: 15000, status: "complete" } }).success, false);
});

test("temporary research payload stores only source metadata, derived conclusions and receipt", () => {
  const payload = safeSessionPayload({ queries: [{ id: "Q01", category: "timeline", query: "must-not-store", freshness: 30 }], memos: [{ queryId: "Q01", category: "timeline", query: "must-not-store", summary: "raw web body must-not-store", sourceIds: ["SRC-01"] }], sources: [{ id: "SRC-01", title: "来源", url: "https://example.com/a", publishedAt: "unknown", retrievedAt: "2026-08-09T00:00:00.000Z", snippet: "raw snippet must-not-store", queryIds: ["Q01"], relevance: .8 }], retrievedAt: "2026-08-09T00:00:00.000Z" }, { timeline: [], socialDrivers: [], audienceConsensus: [], controversies: [], externalFactors: [], unknowns: ["投流未知"] }, { status: "complete", queryCount: 8, sourceCount: 1, domainCount: 1, costCny: .1, retrievedAt: "2026-08-09T00:00:00.000Z" });
  const serialized = JSON.stringify(payload);
  assert.equal(RESEARCH_SESSION_TTL_MS, 60 * 60 * 1000);
  assert.equal(serialized.includes("must-not-store"), false);
  assert.equal(serialized.includes("snippet"), false);
  assert.equal(serialized.includes("comments"), false);
  assert.equal(payload.sources[0].url, "https://example.com/a");
});

test("GreenVideo flow opens a new tab, preserves link mode and auto-starts after file validation", async () => {
  const source = await readFile(new URL("../app/ShotprintStudio.tsx", import.meta.url), "utf8");
  assert.match(source, /window\.open\("https:\/\/greenvideo\.cc\/", "_blank"/);
  assert.match(source, /chooseFile\(selected, "download_upload"\)/);
  assert.match(source, /autoAnalyzeRef\.current/);
  assert.match(source, /runAnalysis\(file, videoUrl, fileAcquisition, fileAudioPresent, true\)/);
  assert.match(source, /researchSessionId/);
  assert.equal(source.includes("researchToken"), false);
});
