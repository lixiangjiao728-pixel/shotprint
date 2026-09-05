import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { analysisResultSchema, normalizeAnalysis, sampleAuditCuts, sampleTimelineItems, validateActionability, validateEvidenceCoverage, type AnalysisResult } from "../lib/analysis.ts";
import { demoAnalysis } from "../lib/demo-data.ts";
import { buildLinkAnalysis, linkAnalysisToMarkdown } from "../lib/link-analysis.ts";
import { buildResearchQueries } from "../lib/link-research.ts";

function longAnalysis(): AnalysisResult {
  const result = structuredClone(demoAnalysis) as AnalysisResult;
  result.metadata = { ...result.metadata, title: "五分钟测试短片", durationMs: 300_000 };
  result.shots = Array.from({ length: 6 }, (_, index) => ({
    ...result.shots[index % result.shots.length],
    id: `long-${index + 1}`,
    startMs: index * 50_000,
    endMs: (index + 1) * 50_000,
    action: `第${index + 1}段发生可见信息变化`,
    narrativeFunction: index === 0 ? "开场钩子" : index === 4 ? "事实反转" : index === 5 ? "结尾行动" : "信息升级",
    evidence: `${index * 50}–${(index + 1) * 50}秒主体动作与构图发生变化`,
    confidence: .8,
  }));
  result.narrative.pace = [
    { label: "开场", timeMs: 0, intensity: 30 },
    { label: "中段", timeMs: 150_000, intensity: 70 },
    { label: "结尾", timeMs: 285_000, intensity: 90 },
  ];
  return result;
}

test("a fully covered 300-second analysis passes evidence and actionability gates", () => {
  const result = longAnalysis();
  assert.equal(validateEvidenceCoverage(result, 300_000, [0, 50_000, 100_000, 150_000, 200_000, 250_000, 300_000]), null);
  assert.equal(validateActionability(result), null);
});

test("an unknown visual palette does not invalidate otherwise complete evidence", () => {
  const result = longAnalysis();
  result.shots[4].palette = [];
  assert.equal(analysisResultSchema.safeParse(result).success, true);
  assert.equal(validateEvidenceCoverage(result, 300_000), null);
});

test("deterministic normalization closes model timecodes and distributes narrative coverage", () => {
  const result = longAnalysis();
  result.shots[0].startMs = 320;
  result.shots[2].endMs = result.shots[2].startMs;
  result.shots.at(-1)!.endMs = 340_000;
  result.narrative.pace = [
    { label: "变化一", timeMs: 120_000, intensity: 30 },
    { label: "变化二", timeMs: 150_000, intensity: 70 },
    { label: "变化三", timeMs: 180_000, intensity: 90 },
  ];
  const normalized = normalizeAnalysis(result, [0, 50_000, 100_000, 150_000, 200_000, 250_000, 300_000], 300_000);
  assert.equal(normalized.shots[0].startMs, 0);
  assert.equal(normalized.shots.at(-1)!.endMs, 300_000);
  assert.equal(normalized.shots[2].endMs, normalized.shots[3].startMs);
  assert.equal(validateEvidenceCoverage(normalized, 300_000, [0, 50_000, 100_000, 150_000, 200_000, 250_000, 300_000]), null);
});

test("deterministic normalization repairs duplicate and terminal model start times", () => {
  const result = longAnalysis();
  result.shots[3].startMs = result.shots[2].startMs;
  result.shots.at(-1)!.startMs = 300_000;
  result.shots.at(-1)!.endMs = 300_000;
  const normalized = normalizeAnalysis(result, [0, 50_000, 100_000, 150_000, 200_000, 250_000, 300_000], 300_000);
  assert.ok(normalized.shots.every((shot, index) => index === 0 || shot.startMs > normalized.shots[index - 1].startMs));
  assert.ok(normalized.shots.every((shot) => shot.endMs > shot.startMs && shot.endMs <= 300_000));
  assert.equal(validateEvidenceCoverage(normalized, 300_000, [0, 50_000, 100_000, 150_000, 200_000, 250_000, 300_000]), null);
});

test("non-operational model remake copy is rebuilt from validated shot evidence", () => {
  const result = longAnalysis();
  result.reusableTemplate = {
    storyVariables: ["主题"],
    beatSheet: ["保持节奏"],
    globalVisualRules: ["画面好看"],
    shotPrompts: ["有氛围"],
    negativeConstraints: ["不要出错"],
    editAndSound: ["声音合适"],
  };
  const normalized = normalizeAnalysis(result, [], 300_000);
  assert.equal(validateActionability(normalized), null);
  assert.ok(normalized.reusableTemplate.beatSheet.every((item) => /%.*秒/.test(item)));
  assert.ok(normalized.reusableTemplate.shotPrompts.every((item) => /原创主体.*景.*秒.*声音|原创主体.*景.*秒.*音效|原创主体.*景.*秒.*音乐/.test(item)));
  assert.ok(normalized.reusableTemplate.negativeConstraints.every((item) => /不/.test(item)));
});

test("adversarial long-video outputs cannot pass with sparse evidence, missed cuts, or generic execution copy", () => {
  const result = longAnalysis();
  assert.equal(validateEvidenceCoverage({ ...result, shots: result.shots.slice(0, 3).map((shot, index) => ({ ...shot, startMs: index * 100_000, endMs: (index + 1) * 100_000 })) }, 300_000), "long_video_evidence_sparse");
  assert.equal(validateEvidenceCoverage(result, 300_000, [0, 20_000, 40_000, 70_000, 90_000, 120_000, 140_000, 170_000, 190_000, 220_000, 240_000, 270_000, 290_000, 300_000]), "local_cut_recall_low");
  assert.equal(validateActionability({ ...result, reusableTemplate: { storyVariables: ["主题"], beatSheet: ["保持节奏"], globalVisualRules: ["画面好看"], shotPrompts: ["拍得有氛围"], negativeConstraints: ["不要出错"], editAndSound: ["声音合适"] } }), "story_variables_insufficient");
});

test("timeline compaction preserves the beginning, ending and full-duration distribution", () => {
  const shots = Array.from({ length: 121 }, (_, index) => ({ startMs: index * 2_500, endMs: (index + 1) * 2_500, index }));
  const sampled = sampleTimelineItems(shots, 72);
  assert.equal(sampled.length, 72);
  assert.equal(sampled[0].index, 0);
  assert.equal(sampled.at(-1)?.index, 120);
  assert.ok(sampled.some((shot) => shot.index >= 59 && shot.index <= 61));
});

test("local cut auditing stays representable inside a compact long-video report", () => {
  const cuts = Array.from({ length: 101 }, (_, index) => index * 3_000);
  const sampled = sampleAuditCuts(cuts, 300_000);
  assert.equal(sampled.length, 25);
  assert.equal(sampled[0], 0);
  assert.equal(sampled.at(-1), 300_000);
  assert.ok(sampled.some((cut) => cut >= 140_000 && cut <= 160_000));
});

test("the merged long-video report produces evidence-bound and executable remake work", () => {
  const video = longAnalysis();
  const comments = Array.from({ length: 40 }, (_, index) => ({ id: `c-${index + 1}`, text: index < 30 ? "这个反转让我很有共鸣，想转发" : "节奏有争议但镜头好看" }));
  const report = buildLinkAnalysis({
    url: "https://www.bilibili.com/video/BV1LONGTEST",
    platform: "bilibili",
    title: "五分钟测试短片",
    method: "manual",
    comments,
    requireVideoEvidence: true,
    videoAnalysis: video,
    sources: [1, 2, 3].map((index) => ({ id: `SRC-0${index}`, title: `来源${index}`, url: `https://source${index}.example.com/video`, retrievedAt: "2026-08-13T00:00:00.000Z" })),
  });
  assert.equal(report.videoStatus, "provided");
  assert.equal(report.audience.themes[0].label, "情绪共鸣");
  assert.ok(report.playbook.shots.at(-1)!.endMs >= 299_500);
  assert.ok(report.playbook.visualBible.some((item) => /眼线|构图|原创/.test(item)));
  assert.ok(report.playbook.promptSkeletons.every((item) => /景|镜头|主体/.test(item)));
  assert.ok(report.playbook.budgetOptions.every((item) => /小时|天/.test(item.hours)));
  assert.ok(report.playbook.experiments.some((item) => item.includes("3秒留存")));
  assert.ok(report.viralFactors.some((factor) => factor.timecodes?.length && factor.counterEvidence.length));
  assert.match(linkAnalysisToMarkdown(report), /预算与工期[\s\S]+上线验证[\s\S]+失败替代/);
});

test("research queries retain a stable URL/video identity when the page title is generic", () => {
  const queries = buildResearchQueries({ platform: "bilibili", title: "待从原页面读取标题", url: "https://www.bilibili.com/video/BV1LONGTEST" });
  assert.ok(queries.every((query) => query.query.includes("BV1LONGTEST")));
  assert.ok(queries.every((query) => !query.query.includes("待从原页面读取标题")));
});

test("five-minute production transport is asynchronous and accepts a 300MB upload boundary", async () => {
  const [server, studio, uploadRoute, analyzeRoute] = await Promise.all([
    readFile(new URL("../worker/aliyun-backend/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ShotprintStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/upload-session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(server, /analysisJobId/);
  assert.match(server, /getJson<AnalysisJob>\(analysisJobKey\(id\)\)/);
  assert.match(server, /analysisJobMatch = path\.match/);
  assert.match(studio, /\/api\/analyze\/jobs\/\$\{encodeURIComponent\(accepted\.analysisJobId\)\}/);
  assert.match(studio, /Date\.now\(\) \+ 15 \* 60 \* 1000/);
  assert.match(studio, /analysisRunRef\.current/);
  assert.match(studio, /"x-shotprint-task-id": receipt\.taskId/);
  assert.match(studio, /finally \{\s*if \(analysisRunRef\.current === runId\) analysisRunRef\.current = null/);
  assert.match(uploadRoute, /314572800/);
  assert.match(analyzeRoute, /证据记录最多 48 个连续时间段/);
  assert.match(analyzeRoute, /shots\[\] 必须恰好/);
  assert.match(analyzeRoute, /structure_json_invalid/);
  assert.match(analyzeRoute, /上一版待修复 JSON/);
  assert.match(analyzeRoute, /structureCall\.text/);
  assert.match(analyzeRoute, /accountModelCall/);
  assert.doesNotMatch(analyzeRoute, /actualCostMicros = reservation\.reservedMicros/);
  assert.match(server, /diagnosticCode/);
});
