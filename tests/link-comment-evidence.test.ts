import assert from "node:assert/strict";
import test from "node:test";

import { buildCommentEvidence, buildResearchRequest, normalizeAudienceDigest, readSafeApiError, readSafeApiJson } from "../lib/comment-evidence.ts";
import { buildLinkAnalysis, linkAnalysisSchema, mergeLocalAudienceEvidence } from "../lib/link-analysis.ts";

test("comment evidence contract keeps a representative, bounded and de-identified sample", () => {
  const comments = Array.from({ length: 200 }, (_, index) => ({
    id: `platform-user-${index}`,
    text: `${index} @real-user https://example.com/${index} UNION SELECT <script>prompt assistant ${"观众反馈".repeat(80)}`,
    likes: index === 199 ? 999_999 : index,
    author: `name-${index}`,
    avatar: `https://avatar.example/${index}.png`,
    userId: `uid-${index}`,
    source: "extension",
  }));

  const evidence = buildCommentEvidence(comments);
  const serialized = JSON.stringify(evidence);
  assert.equal(evidence.receipt.contract, "comment-evidence.2");
  assert.equal(evidence.receipt.originalSampleCount, 200);
  assert.ok(evidence.receipt.evidenceSampleCount <= 100);
  assert.ok(evidence.receipt.textChars <= 6_000);
  assert.ok(Buffer.byteLength(serialized, "utf8") < 32_000);
  assert.equal(evidence.receipt.truncated, true);
  assert.ok(evidence.comments.some((comment) => comment.likes === 999_999));
  assert.equal(/platform-user|real-user|avatar\.example|uid-|<script>|UNION SELECT/i.test(serialized), false);
  assert.deepEqual(evidence.comments.map((comment) => comment.id), evidence.comments.map((_, index) => `E${String(index + 1).padStart(3, "0")}`));
});

test("deep research request includes only bounded de-identified comment evidence", () => {
  const request = buildResearchRequest({
    url: "https://www.douyin.com/video/123",
    platform: "douyin",
    title: "标题".repeat(200),
    author: "作者".repeat(100),
    comments: Array.from({ length: 200 }, (_, index) => ({ id: `raw-${index}`, text: `${index} UNION SELECT <script> ${"很长的观众评论".repeat(40)}`, likes: index, timeLabel: "刚刚", replyTo: "raw-1", userId: `uid-${index}`, avatar: "https://example.com/avatar.png" })),
  });
  const serialized = JSON.stringify(request.body);
  assert.ok(Buffer.byteLength(serialized, "utf8") < 32_000);
  assert.equal(request.body.audienceDigest.contract, "audience-digest.1");
  assert.equal(request.body.audienceDigest.evidenceIds.length, 100);
  assert.equal(request.body.title.length <= 120, true);
  assert.equal(request.body.author.length <= 80, true);
  assert.equal(request.body.commentEvidence.length, 100);
  assert.equal(request.body.commentEvidence.every((comment) => /^E\d{3}$/.test(comment.id) && comment.text.length <= 60), true);
  assert.equal(/raw-|uid-|avatar|UNION SELECT|<script>/i.test(serialized), false);
  assert.ok(normalizeAudienceDigest(request.body.audienceDigest));
});

test("browser-local merge restores anonymous comments without sending them through the edge", () => {
  const base = buildLinkAnalysis({
    url: "https://www.douyin.com/video/123",
    platform: "douyin",
    comments: [],
    method: "extension",
    sources: [
      { id: "SRC-01", title: "one", url: "https://one.example/a" },
      { id: "SRC-02", title: "two", url: "https://two.example/a" },
      { id: "SRC-03", title: "three", url: "https://three.example/a" },
    ],
    socialContext: {
      timeline: [], audienceConsensus: [], controversies: [], externalFactors: [], unknowns: [],
      socialDrivers: [{ title: "观众讨论驱动", summary: "匿名摘要显示讨论集中。", evidenceType: "inference", commentIds: ["E001"], sourceIds: ["SRC-01"], counterEvidence: ["缺少平台内部数据"], confidence: .7 }],
    },
    requireVideoEvidence: true,
  });
  const evidence = buildCommentEvidence(Array.from({ length: 40 }, (_, index) => ({ text: `第${index + 1}条真实评论，为什么会这样？`, likes: index })));
  const merged = mergeLocalAudienceEvidence(base, evidence.comments, "extension", { sampleCount: 40 });
  assert.equal(linkAnalysisSchema.safeParse(merged).success, true);
  assert.equal(merged.audience.comments.length, 40);
  assert.equal(merged.collection.sampleCount, 40);
  assert.match(merged.provenance.note, /浏览器本地合并/);
});

test("non-JSON Cloudflare 403 becomes an explicit pre-worker error without claiming model spend", async () => {
  const response = new Response("<html>blocked</html>", { status: 403, headers: { "content-type": "text/html", "cf-ray": "ray-test-123" } });
  const message = await readSafeApiError(response, "研究服务没有开始");
  assert.match(message, /EDGE_BLOCKED_BEFORE_WORKER/);
  assert.match(message, /HTTP 403/);
  assert.match(message, /ray-test-123/);
  assert.match(message, /未启动百炼研究/);
});

test("JSON worker errors remain visible to the user", async () => {
  const response = Response.json({ error: "SEARCH_AUTH_FAILED：请检查模型权限。" }, { status: 403 });
  assert.equal(await readSafeApiError(response, "fallback"), "SEARCH_AUTH_FAILED：请检查模型权限。");
});

test("safe API JSON parsing replaces empty and truncated responses with actionable errors", async () => {
  await assert.rejects(() => readSafeApiJson(new Response("", { status: 504 }), "分析服务没有返回完整结果"), /HTTP 504 · 服务端返回空响应/);
  await assert.rejects(() => readSafeApiJson(new Response('{"result":', { status: 502 }), "分析服务没有返回完整结果"), /HTTP 502 · 服务端响应不完整/);
});

test("link report distinguishes collected comments from transmitted evidence", () => {
  const evidence = buildCommentEvidence(Array.from({ length: 200 }, (_, index) => ({ text: `第${index + 1}条不同的观众反馈`, likes: index })));
  const result = buildLinkAnalysis({
    url: "https://www.bilibili.com/video/BV1example",
    platform: "bilibili",
    comments: evidence.comments,
    method: "extension",
    collectionDetails: { sampleCount: 200, evidenceSampleCount: evidence.comments.length },
    requireVideoEvidence: true,
  });
  assert.equal(linkAnalysisSchema.safeParse(result).success, true);
  assert.equal(result.collection.sampleCount, 200);
  assert.equal(result.collection.evidenceSampleCount, evidence.comments.length);
  assert.equal(result.audience.comments.length, evidence.comments.length);
});
