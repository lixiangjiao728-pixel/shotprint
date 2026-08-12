import assert from "node:assert/strict";
import test from "node:test";
import { buildLinkAnalysis, linkAnalysisSchema, sanitizeComments } from "../lib/link-analysis.ts";

test("opposite comment evidence changes audience and viral output", () => {
  const warm = buildLinkAnalysis({ url: "https://www.douyin.com/video/warm", method: "manual", comments: [{ text: "温暖治愈，想看下一集" }] });
  const tense = buildLinkAnalysis({ url: "https://www.douyin.com/video/tense", method: "manual", comments: [{ text: "恐怖诡异，吓得不敢看" }] });
  assert.notDeepEqual(warm.audience.themes, tense.audience.themes);
  assert.notEqual(warm.viralFactors[0]?.title, tense.viralFactors[0]?.title);
});

test("real report blocks timecodes and production without video evidence", () => {
  const report = buildLinkAnalysis({ url: "https://www.bilibili.com/video/BV1xx", method: "extension", requireVideoEvidence: true, comments: [{ text: "评论样本" }] });
  assert.equal(report.videoStatus, "blocked");
  assert.equal(report.director.beats.length, 0);
  assert.equal(report.playbook.shots.length, 0);
  assert.equal(report.evidence.timecodes.length, 0);
  assert.equal(linkAnalysisSchema.safeParse(report).success, true);
});

test("identity-like fields never survive sanitization", () => {
  const [comment] = sanitizeComments([{ text: "回复 @alice：好看", author: "alice", avatar: "avatar", userId: "id" }]);
  assert.equal(comment.text.includes("alice"), false);
  assert.equal(JSON.stringify(comment).includes("avatar"), false);
  assert.equal(JSON.stringify(comment).includes("userId"), false);
});
