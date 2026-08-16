import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  analysisResultSchema,
  sampleAuditCuts,
  validateActionability,
  validateEvidenceCoverage,
} from "../lib/analysis.ts";

const origin = process.env.SHOTPRINT_TEST_ORIGIN || "http://127.0.0.1:43129";
const videoPath = process.env.REAL_VIDEO_PATH;
const video = await readFile(videoPath || new URL("./fixtures/cc0-flower.mp4", import.meta.url));
const fileName = videoPath ? basename(videoPath) : "cc0-flower.mp4";
const durationMs = Math.max(1_000, Number(process.env.REAL_VIDEO_DURATION_MS) || 5_000);
const localCuts = Array.from(
  { length: Math.max(1, Math.floor(durationMs / 5_000) - 1) },
  (_, index) => (index + 1) * 5_000,
);
const signal = AbortSignal.timeout(15 * 60 * 1000);
const testIp = `198.51.100.${Math.floor(Date.now() / 1000) % 250 + 1}`;

const sessionResponse = await fetch(`${origin}/api/upload-session`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": testIp },
  body: JSON.stringify({
    fileName,
    mimeType: "video/mp4",
    size: video.byteLength,
    durationMs,
    consent: true,
  }),
  signal,
});
const session = await sessionResponse.json();
assert.equal(sessionResponse.status, 200, `upload session failed safely: ${sessionResponse.status} ${session.error || ""}`);
assert.equal(typeof session.uploadUrl, "string");
assert.equal(typeof session.uploadToken, "string");
assert.equal(typeof session.objectKey, "string");

const uploadResponse = await fetch(session.uploadUrl, {
  method: "PUT",
  headers: session.uploadHeaders,
  body: video,
  signal,
});
assert.equal(uploadResponse.status, 200, `OSS upload failed: ${uploadResponse.status}`);

const analysisResponse = await fetch(`${origin}/api/analyze`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    objectKey: session.objectKey,
    uploadToken: session.uploadToken,
    mimeType: "video/mp4",
    durationMs,
    localCuts,
  }),
  signal,
});
let finalResponse = analysisResponse;
let payload = await finalResponse.json();
if (finalResponse.status === 202) {
  assert.equal(typeof payload.analysisJobId, "string", "analysis job was accepted without a polling id");
  const analysisJobId = payload.analysisJobId;
  const pollAfterMs = Math.max(1_000, Math.min(5_000, Number(payload.pollAfterMs) || 2_000));
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollAfterMs));
    finalResponse = await fetch(`${origin}/api/analyze/jobs/${encodeURIComponent(analysisJobId)}`, { signal });
    payload = await finalResponse.json();
    if (finalResponse.status !== 202) break;
  }
}
assert.equal(finalResponse.status, 200, `analysis failed safely: ${finalResponse.status} ${payload.error || ""}`);
const result = analysisResultSchema.parse(payload.result);
assert.equal(
  validateEvidenceCoverage(result, durationMs, sampleAuditCuts(localCuts, durationMs)),
  null,
  "analysis did not cover the full 300-second evidence timeline",
);
assert.equal(validateActionability(result), null, "analysis did not produce an operational recreation plan");
assert.ok(result.shots[0].startMs <= 500, "analysis missed the opening of the video");
assert.ok(result.shots.at(-1).endMs >= durationMs - 500, "analysis missed the end of the video");
assert.match(result.provenance.note, /cleanup=deleted/);
assert.match(result.provenance.note, /budget=settled/);

console.log(JSON.stringify({
  uploadSessionStatus: sessionResponse.status,
  uploadStatus: uploadResponse.status,
  analysisStatus: finalResponse.status,
  asyncJob: analysisResponse.status === 202,
  version: result.version,
  shots: result.shots.length,
  productionHypotheses: result.productionHypotheses.length,
  templateSections: Object.keys(result.reusableTemplate).length,
  warnings: result.warnings.length,
  model: result.provenance.model,
  cleanup: "deleted",
  budget: "settled",
}));
