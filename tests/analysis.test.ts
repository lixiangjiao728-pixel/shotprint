import assert from "node:assert/strict";
import test from "node:test";
import { analysisResultSchema, analysisToCsv, analysisToMarkdown, calculateCutRecall, DEMO_BOUNDARIES, normalizeAnalysis } from "../lib/analysis.ts";
import { demoAnalysis } from "../lib/demo-data.ts";

test("AnalysisResult v1 fixture is complete", () => {
  assert.equal(analysisResultSchema.parse(demoAnalysis).shots.length, 8);
  assert.equal(demoAnalysis.version, "1.0");
});

test("missing required fixture field turns the schema check red", () => {
  const invalid = structuredClone(demoAnalysis) as unknown as Record<string, unknown>;
  delete invalid.metadata;
  assert.equal(analysisResultSchema.safeParse(invalid).success, false);
});

test("known cut fixture exceeds 85 percent recall at 500ms", () => {
  const jittered = [0, 2570, 5140, 7190, 9460, 12050, 15120, 17740, 20800];
  assert.equal(calculateCutRecall(DEMO_BOUNDARIES, jittered, 500), 1);
});

test("normalization records locally matched boundaries", () => {
  const result = normalizeAnalysis(demoAnalysis, DEMO_BOUNDARIES);
  assert.equal(result.shots.filter((shot) => shot.localBoundary).length, 7);
  assert.equal(result.provenance.localCutCount, 7);
});

test("JSON, Markdown and CSV exports carry the analysis", () => {
  assert.match(JSON.stringify(demoAnalysis), /productionHypotheses/);
  assert.match(analysisToMarkdown(demoAnalysis), /逐镜拆解/);
  assert.match(analysisToCsv(demoAnalysis), /叙事作用/);
});
