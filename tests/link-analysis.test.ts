import assert from "node:assert/strict";
import test from "node:test";
import { buildLinkAnalysis, cleanSocialTitle, detectPlatform, linkAnalysisSchema, normalizeLink, sanitizeComments } from "../lib/link-analysis.ts";
import { demoLinkAnalysis } from "../lib/link-demo-data.ts";

test("link platform detection and canonicalization are portable", () => {
  assert.equal(detectPlatform("https://v.douyin.com/example/"), "douyin");
  assert.equal(detectPlatform("https://www.bilibili.com/video/BV1xx411c7mD/?utm_source=share"), "bilibili");
  assert.equal(detectPlatform("https://www.xiaohongshu.com/explore/example"), "xiaohongshu");
  assert.equal(normalizeLink("https://www.bilibili.com/video/BV1/?utm_source=share#comment"), "https://www.bilibili.com/video/BV1/");
  assert.equal(cleanSocialTitle("一条视频_哔哩哔哩_bilibili", "bilibili"), "一条视频");
  assert.equal(cleanSocialTitle("《被裁掉的女孩》第一集 @方桃子 漂亮可以让人看见你 #AI创作浪潮计划 #抖音AI创作大赛", "douyin"), "《被裁掉的女孩》第一集");
  assert.ok(cleanSocialTitle("这是一个没有书名号但特别特别特别特别特别特别特别特别特别特别特别长的短视频标题，后面还有推广文案 #AI", "douyin").length <= 48);
});

test("comment sanitizer strips identity fields and enforces 200 comment cap", () => {
  const comments = sanitizeComments(Array.from({ length: 240 }, (_, index) => ({ id: `x-${index}`, text: `评论 ${index}`, author: "private-user", avatar: "private-avatar", userId: "private-id" })));
  assert.equal(comments.length, 200);
  assert.equal("author" in comments[0], false);
  assert.equal("avatar" in comments[0], false);
  assert.equal("userId" in comments[0], false);
  assert.equal(JSON.stringify(comments).includes("private-user"), false);
  const reply = sanitizeComments([{ text: "回复 @private-user :这条评论只保留正文" }])[0];
  assert.equal(reply.text, "这条评论只保留正文");
  assert.equal(reply.text.includes("private-user"), false);
});

test("link report includes audience, director, production and three playbook directions", () => {
  const report = buildLinkAnalysis({ url: "https://www.douyin.com/video/demo", platform: "douyin", comments: [{ text: "这个反转太绝了", likes: 4 }], method: "manual" });
  assert.equal(linkAnalysisSchema.safeParse(report).success, true);
  assert.equal(report.playbook.directions.length, 3);
  assert.ok(report.director.beats.every((beat) => beat.endMs > beat.startMs));
  assert.ok(report.production.aiWorkflow.length > 0);
});

test("fixture report is explicitly structured and duration sums are valid", () => {
  assert.equal(linkAnalysisSchema.parse(demoLinkAnalysis).version, "link.1");
  const duration = demoLinkAnalysis.playbook.beats.reduce((sum, beat) => sum + beat.endMs - beat.startMs, 0);
  assert.equal(duration, demoLinkAnalysis.playbook.brief.durationMs);
});
