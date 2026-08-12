import assert from "node:assert/strict";
import test from "node:test";
import { buildResearchQueries, inspectResearchShape, mergeResearchSources, parseResearchResponse, parseSocialContext, signResearchBundle, verifyResearchToken } from "../lib/link-research.ts";

test("deep research emits all eight evidence categories with distinct queries", () => {
  const queries = buildResearchQueries({ platform: "bilibili", title: "AI短片", author: "创作者", description: "职场题材反转故事", videoId: "BV1fixture", url: "https://www.bilibili.com/video/BV1fixture" });
  assert.equal(queries.length, 8);
  assert.equal(new Set(queries.map((item) => item.category)).size, 8);
  assert.equal(new Set(queries.map((item) => item.query)).size, 8);
  assert.ok(queries.every((item) => item.query.includes("AI短片")));
  assert.ok(queries.every((item) => item.query.includes("BV1fixture")));
  assert.ok(queries.every((item) => item.query.includes("职场题材反转故事")));
});

test("research sources are HTTPS-only, URL-deduplicated and capped at three per domain", () => {
  const query = buildResearchQueries({ platform: "douyin", title: "fixture", url: "https://www.douyin.com/video/1" })[0];
  const parsed = parseResearchResponse({ output: { choices: [{ message: { content: "memo" } }], search_info: { search_results: [
    { title: "A", url: "https://a.example/one?utm_source=x", snippet: "one" },
    { title: "A duplicate", url: "https://a.example/one", snippet: "duplicate" },
    { title: "B", url: "https://a.example/two" }, { title: "C", url: "https://a.example/three" }, { title: "D", url: "https://a.example/four" },
    { title: "unsafe", url: "http://unsafe.example/page" }, { title: "other", url: "https://b.example/page" },
    { title: { text: "结构化来源标题" }, url: "https://c.example/page", snippet: { text: "可核验摘要" } },
  ] } } }, query, "2026-08-05T00:00:00.000Z");
  const merged = mergeResearchSources([parsed]);
  assert.equal(merged.sources.filter((source) => new URL(source.url).hostname === "a.example").length, 3);
  assert.equal(merged.sources.some((source) => source.url.startsWith("http://")), false);
  assert.equal(new Set(merged.sources.map((source) => source.url)).size, merged.sources.length);
  assert.equal(merged.domainCount, 3);
  assert.equal(merged.sources.find((source) => source.url === "https://c.example/page")?.title, "结构化来源标题");
  assert.equal(merged.sources.some((source) => source.title.includes("[object Object]")), false);
});

test("social synthesis rejects unsupported non-unknown claims and preserves explicit unknowns", () => {
  const context = parseSocialContext({ socialDrivers: [
    { title: "unsupported", summary: "no refs", evidenceType: "fact", commentIds: [], sourceIds: [], counterEvidence: [], confidence: 0.9 },
    { title: "supported", summary: "has refs", evidenceType: "inference", commentIds: ["C001"], sourceIds: ["SRC-01"], counterEvidence: ["反证"], confidence: 0.7 },
  ], unknowns: ["投流规模无法公开核验"] }, new Set(["C001"]), new Set(["SRC-01"]));
  assert.equal(context, null);
});

test("social synthesis rejects placeholder and object-string output instead of rendering garbage", () => {
  const malformed = parseSocialContext({
    timeline: [{ title: {}, summary: {}, evidenceType: "unknown", commentIds: [], sourceIds: [], counterEvidence: [], confidence: 0 }],
    socialDrivers: Array.from({ length: 4 }, () => ({ title: "未命名结论", summary: "unknown", evidenceType: "unknown", commentIds: [], sourceIds: [], counterEvidence: [], confidence: 0 })),
    audienceConsensus: [], controversies: [], externalFactors: [], unknowns: [{ reason: "投流规模无法公开核验" }],
  }, new Set(["C001"]), new Set(["SRC-01"]));
  assert.equal(malformed, null);
});

test("social synthesis accepts evidence-grounded deep research with string-only fields", () => {
  const claim = (title: string) => ({ title, summary: `${title}的证据链与社会语境分析`, evidenceType: "inference", commentIds: ["C001"], sourceIds: ["SRC-01"], counterEvidence: ["缺少平台内部数据"], confidence: 0.72 });
  const context = parseSocialContext({
    timeline: [claim("传播节点")], socialDrivers: [claim("身份共鸣"), claim("现实焦虑"), claim("转发动机")], audienceConsensus: [claim("观众共识")], controversies: [claim("审美争议")], externalFactors: [claim("平台话题")], unknowns: [{ reason: "投流规模无法公开核验" }],
  }, new Set(["C001"]), new Set(["SRC-01"]));
  assert.equal(context?.socialDrivers.length, 3);
  assert.deepEqual(context?.unknowns, ["投流规模无法公开核验"]);
});

test("social synthesis accepts wrapped snake-case and Chinese provider output", () => {
  const claim = (title: string, type = "推断") => ({
    结论: title,
    分析: `${title}具有可核验的评论与网页来源证据`,
    判断类型: type,
    证据: { comments: "comment:E001，comment:E002", sources: [{ id: "source:SRC-01" }] },
    反证: "平台推荐权重不可见",
    置信度: "72%",
  });
  const context = parseSocialContext({
    result: {
      social_context: {
        传播时间线: [claim("传播节点", "事实")],
        social_drivers: [claim("身份投射"), claim("现实焦虑"), claim("讨论动机")],
        audience_consensus: [claim("观众共识")],
        controversies: [],
        external_factors: [],
        未知项: { reason: "投流规模无法公开核验" },
      },
    },
  }, new Set(["E001", "E002"]), new Set(["SRC-01"]));
  assert.equal(context?.socialDrivers.length, 3);
  assert.deepEqual(context?.socialDrivers[0]?.commentIds, ["E001", "E002"]);
  assert.deepEqual(context?.socialDrivers[0]?.sourceIds, ["SRC-01"]);
  assert.equal(context?.socialDrivers[0]?.confidence, 0.72);
  assert.equal(context?.timeline[0]?.evidenceType, "fact");
  assert.deepEqual(context?.unknowns, ["投流规模无法公开核验"]);
  assert.equal(JSON.stringify(context).includes("[object Object]"), false);
});

test("social synthesis recognizes prefixed evidence ids and compound evidence types", () => {
  const claim = (title: string) => ({ title, summary: "由匿名评论和公开网页共同支持", evidenceType: "事实/推断", commentIds: "comment:E001", sourceIds: "source:SRC-01", counterEvidence: "仍缺少平台内部数据", confidence: 0.7 });
  const context = parseSocialContext({
    socialDrivers: [claim("一"), claim("二"), claim("三")],
    timeline: [claim("四")],
    audienceConsensus: [claim("五")],
  }, new Set(["E001"]), new Set(["SRC-01"]));
  assert.deepEqual(context?.socialDrivers[0]?.commentIds, ["E001"]);
  assert.deepEqual(context?.socialDrivers[0]?.sourceIds, ["SRC-01"]);
  assert.equal(context?.socialDrivers[0]?.evidenceType, "fact");
});

test("social synthesis still rejects insufficient or invalid evidence after compatibility parsing", () => {
  const invalidClaim = (title: string) => ({ title, analysis: "有结论但引用不存在", evidence_type: "inference", evidence: "E999 SRC-99", confidence: "90%" });
  const invalid = parseSocialContext({ output: { social_context: {
    drivers: [invalidClaim("一"), invalidClaim("二"), invalidClaim("三")],
    timeline: [invalidClaim("时间线")],
    consensus: [invalidClaim("共识")],
  } } }, new Set(["E001"]), new Set(["SRC-01"]));
  assert.equal(invalid, null);

  const validClaim = (title: string) => ({ title, analysis: "存在有效引用", evidence_type: "inference", evidence: "E001 SRC-01", confidence: 0.8 });
  const tooFewDrivers = parseSocialContext({ analysis: { social_context: {
    drivers: [validClaim("一"), validClaim("二")],
    timeline: [validClaim("时间线")],
    consensus: [validClaim("共识")],
  } } }, new Set(["E001"]), new Set(["SRC-01"]));
  assert.equal(tooFewDrivers, null);
});

test("research shape diagnostics expose structure but never model or comment values", () => {
  const diagnostic = inspectResearchShape({ result: { drivers: [{ title: "SECRET_COMMENT", evidence: "SECRET_SOURCE" }] } });
  const serialized = JSON.stringify(diagnostic);
  assert.match(serialized, /result\.drivers/);
  assert.match(serialized, /title/);
  assert.equal(serialized.includes("SECRET_COMMENT"), false);
  assert.equal(serialized.includes("SECRET_SOURCE"), false);
});

test("signed research packages expire and reject tampering", async () => {
  const now = Date.now();
  const bundle = { queries: [], memos: [], sources: [], retrievedAt: new Date(now).toISOString() };
  const socialContext = { timeline: [], socialDrivers: [], audienceConsensus: [], controversies: [], externalFactors: [], unknowns: ["unknown"] };
  const receipt = { status: "partial" as const, queryCount: 8, sourceCount: 0, domainCount: 0, costCny: 0, retrievedAt: new Date(now).toISOString() };
  const token = await signResearchBundle(bundle, socialContext, receipt, "fixture-secret", now);
  assert.ok(await verifyResearchToken(token, "fixture-secret", now + 1));
  assert.equal(await verifyResearchToken(`${token}x`, "fixture-secret", now + 1), null);
  assert.equal(await verifyResearchToken(token, "fixture-secret", now + 31 * 60 * 1000), null);
});
