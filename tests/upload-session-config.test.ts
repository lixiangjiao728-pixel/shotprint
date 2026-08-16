import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("upload sessions require their signing secret before consuming work", async () => {
  const source = await readFile(new URL("../app/api/upload-session/route.ts", import.meta.url), "utf8");
  assert.match(source, /!runtime\.RATE_LIMIT_SALT/);
});

test("failed upload-session signing releases its rate-limit lease", async () => {
  const source = await readFile(new URL("../app/api/upload-session/route.ts", import.meta.url), "utf8");
  assert.match(source, /catch \{\s*await releaseRateLimit\(runtime, limit\.lease\)/);
});

test("upload sessions reject non-positive and non-integer video boundaries", async () => {
  const source = await readFile(new URL("../app/api/upload-session/route.ts", import.meta.url), "utf8");
  assert.match(source, /Number\.isSafeInteger\(body\.size\)/);
  assert.match(source, /body\.size <= 0/);
  assert.match(source, /Number\.isFinite\(body\.durationMs\)/);
  assert.match(source, /body\.durationMs <= 0/);
});

test("analysis verifies the uploaded object before reserving model budget", async () => {
  const source = await readFile(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("inspectOssObject(runtime, body.objectKey)") < source.indexOf("reserveAnalysisBudget(runtime"));
  assert.match(source, /uploaded\.size !== claims\.size/);
  assert.match(source, /uploaded\.mimeType !== claims\.mimeType/);
  assert.match(source, /\.slice\(0, 600\)/);
});

test("upload preflight and analysis share one full-video budget definition", async () => {
  const [uploadSource, analyzeSource] = await Promise.all([
    readFile(new URL("../app/api/upload-session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(uploadSource, /getBudgetStatus\(runtime, VIDEO_ANALYSIS_BUDGET\)/);
  assert.match(analyzeSource, /reserveAnalysisBudget\(runtime, VIDEO_ANALYSIS_BUDGET\)/);
});

test("video upload attempts and successful analyses use separate releasable quotas", async () => {
  const [uploadSource, analyzeSource] = await Promise.all([
    readFile(new URL("../app/api/upload-session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(uploadSource, /consumeRateLimit\(request, uploadRuntime, "video-upload"\)/);
  assert.match(uploadSource, /releaseRateLimitForRequest\(request, runtime, "video-upload"\)/);
  assert.match(analyzeSource, /consumeRateLimit\(request, runtime, "video-analysis"\)/);
  assert.match(analyzeSource, /releaseRateLimit\(runtime, analysisLimit\.lease\)/);
});
