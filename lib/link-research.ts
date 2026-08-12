import type { BailianUsage } from "./cost-budget";

export const RESEARCH_CATEGORIES = [
  "original-and-reposts", "author-context", "timeline", "social-topic",
  "support-and-criticism", "ai-production", "platform-spread", "media-industry",
] as const;

export type ResearchCategory = typeof RESEARCH_CATEGORIES[number];

export type ResearchSource = {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  retrievedAt: string;
  snippet: string;
  queryIds: string[];
  relevance: number;
};

export type ResearchMemo = { queryId: string; category: ResearchCategory; query: string; summary: string; sourceIds: string[] };
export type SocialClaim = { title: string; summary: string; evidenceType: "fact" | "inference" | "unknown"; commentIds: string[]; sourceIds: string[]; counterEvidence: string[]; confidence: number };
export type SocialContext = { timeline: SocialClaim[]; socialDrivers: SocialClaim[]; audienceConsensus: SocialClaim[]; controversies: SocialClaim[]; externalFactors: SocialClaim[]; unknowns: string[] };
export type ResearchBundle = { queries: Array<{ id: string; category: ResearchCategory; query: string; freshness?: 30 | 180 }>; memos: ResearchMemo[]; sources: ResearchSource[]; retrievedAt: string };
export type ResearchReceipt = { status: "complete" | "partial" | "blocked"; queryCount: number; sourceCount: number; domainCount: number; costCny: number; retrievedAt: string; errorCode?: string; originalCommentCount?: number; commentEvidenceCount?: number };

export function buildResearchQueries(input: { platform: string; title?: string; author?: string; description?: string; videoId?: string; keywords?: string; url: string }) {
  const title = input.title?.trim() ? `“${input.title.trim()}”` : "标题未知";
  const identity = [input.platform, title, input.author, input.videoId, input.description, input.keywords].filter(Boolean).join(" ").slice(0, 300);
  const specs: Array<[ResearchCategory, string, 30 | 180 | undefined]> = [
    ["original-and-reposts", `${identity} 原视频 转载 二创 传播`, 30],
    ["author-context", `${identity} 作者 账号 背景 过往作品`, 180],
    ["timeline", `${identity} 发布时间 走红 时间线 热点`, 30],
    ["social-topic", `${identity} 社会议题 文化情绪 群体心理`, 180],
    ["support-and-criticism", `${identity} 评价 争议 批评 支持 观众反馈`, 30],
    ["ai-production", `${identity} AI制作 技术 工作流 影视制作`, 180],
    ["platform-spread", `${identity} 平台传播 推荐 转发 收藏 二创`, 30],
    ["media-industry", `${identity} 媒体 行业 报道 趋势`, 180],
  ];
  return specs.map(([category, query, freshness], index) => ({ id: `Q${String(index + 1).padStart(2, "0")}`, category, query: `${query} ${input.url}`.slice(0, 500), ...(freshness ? { freshness } : {}) }));
}

function textValue(value: unknown) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string" ? (item as Record<string, unknown>).text : "").join("\n");
}

function sourceText(value: unknown, fallback = "") {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return fallback;
  const object = value as Record<string, unknown>;
  for (const key of ["text", "value", "name", "title", "content", "summary"]) if (typeof object[key] === "string") return object[key];
  return fallback;
}

export function parseResearchResponse(payload: unknown, query: ResearchBundle["queries"][number], retrievedAt: string) {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const output = root.output && typeof root.output === "object" ? root.output as Record<string, unknown> : {};
  const choices = Array.isArray(output.choices) ? output.choices : [];
  const message = choices[0] && typeof choices[0] === "object" && (choices[0] as Record<string, unknown>).message && typeof (choices[0] as Record<string, unknown>).message === "object" ? (choices[0] as Record<string, unknown>).message as Record<string, unknown> : {};
  const summary = textValue(message.content ?? output.text).replace(/\s+/g, " ").trim().slice(0, 4000);
  const searchInfo = output.search_info && typeof output.search_info === "object" ? output.search_info as Record<string, unknown> : {};
  const values = Array.isArray(searchInfo.search_results) ? searchInfo.search_results : Array.isArray(searchInfo.searchResults) ? searchInfo.searchResults : [];
  const sources = values.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const rawUrl = typeof item.url === "string" ? item.url : typeof item.link === "string" ? item.link : "";
    try {
      const parsed = new URL(rawUrl); if (parsed.protocol !== "https:") return [];
      parsed.hash = "";
      [...parsed.searchParams.keys()].forEach((key) => { if (/^(utm_|spm$|from$|share_)/i.test(key)) parsed.searchParams.delete(key); });
      return [{ title: sourceText(item.title ?? item.name, "联网来源").trim().slice(0, 200), url: parsed.toString(), publishedAt: sourceText(item.published_at ?? item.publishedAt ?? item.publish_time, "unknown").slice(0, 64), retrievedAt, snippet: sourceText(item.snippet ?? item.content ?? item.summary).replace(/\s+/g, " ").trim().slice(0, 800), queryIds: [query.id], relevance: 0.6 }];
    } catch { return []; }
  });
  const usageValue = root.usage ?? output.usage;
  const usageRoot = usageValue && typeof usageValue === "object" ? usageValue as Record<string, unknown> : {};
  const usage: BailianUsage = { input_tokens: typeof usageRoot.input_tokens === "number" ? usageRoot.input_tokens : typeof usageRoot.prompt_tokens === "number" ? usageRoot.prompt_tokens : undefined, output_tokens: typeof usageRoot.output_tokens === "number" ? usageRoot.output_tokens : typeof usageRoot.completion_tokens === "number" ? usageRoot.completion_tokens : undefined };
  return { memo: { queryId: query.id, category: query.category, query: query.query, summary: summary || "未返回可用研究摘要。", sourceIds: [] } satisfies ResearchMemo, sources, usage };
}

export function mergeResearchSources(groups: Array<{ memo: ResearchMemo; sources: Omit<ResearchSource, "id">[] }>) {
  const byUrl = new Map<string, Omit<ResearchSource, "id">>();
  for (const group of groups) for (const source of group.sources) {
    const current = byUrl.get(source.url);
    if (current) current.queryIds = [...new Set([...current.queryIds, ...source.queryIds])];
    else byUrl.set(source.url, { ...source, queryIds: [...source.queryIds] });
  }
  const domainCounts = new Map<string, number>();
  const sources: ResearchSource[] = [];
  for (const source of byUrl.values()) {
    const domain = new URL(source.url).hostname.toLowerCase();
    const count = domainCounts.get(domain) || 0; if (count >= 3) continue;
    domainCounts.set(domain, count + 1);
    sources.push({ ...source, id: `SRC-${String(sources.length + 1).padStart(2, "0")}`, relevance: Math.min(1, 0.5 + source.queryIds.length * 0.1) });
    if (sources.length >= 20) break;
  }
  const idByUrl = new Map(sources.map((source) => [source.url, source.id]));
  const memos = groups.map((group) => ({ ...group.memo, sourceIds: group.sources.map((source) => idByUrl.get(source.url)).filter((id): id is string => Boolean(id)) }));
  return { sources, memos, domainCount: new Set(sources.map((source) => new URL(source.url).hostname)).size };
}

export function parseSocialContext(value: unknown, validCommentIds: Set<string>, validSourceIds: Set<string>): SocialContext | null {
  if (!value || typeof value !== "object") return null;
  const field = (object: Record<string, unknown>, ...keys: string[]) => keys.map((key) => object[key]).find((item) => item !== undefined);
  const rootKeys = ["timeline", "socialDrivers", "social_drivers", "viralDrivers", "drivers", "audienceConsensus", "audience_consensus", "consensus", "controversies", "externalFactors", "external_factors", "unknowns"];
  const candidates: Record<string, unknown>[] = [value as Record<string, unknown>];
  for (let depth = 0; depth < 2; depth += 1) {
    for (const candidate of [...candidates]) for (const key of ["socialContext", "social_context", "result", "analysis", "data", "output"]) {
      const nested = candidate[key];
      if (nested && typeof nested === "object" && !Array.isArray(nested) && !candidates.includes(nested as Record<string, unknown>)) candidates.push(nested as Record<string, unknown>);
    }
  }
  const root = candidates.find((candidate) => rootKeys.some((key) => Array.isArray(candidate[key]))) || candidates[0];
  const scalarText = (input: unknown, max: number) => {
    if (typeof input === "string") return input.replace(/\s+/g, " ").trim().slice(0, max);
    if (!input || typeof input !== "object") return "";
    const object = input as Record<string, unknown>;
    for (const key of ["text", "value", "label", "reason", "description", "content"]) {
      if (typeof object[key] === "string") return object[key].replace(/\s+/g, " ").trim().slice(0, max);
    }
    return "";
  };
  const referenceText = (input: unknown, depth = 0): string[] => {
    if (depth > 4 || input === null || input === undefined) return [];
    if (typeof input === "string" || typeof input === "number") return [String(input)];
    if (Array.isArray(input)) return input.slice(0, 24).flatMap((item) => referenceText(item, depth + 1));
    if (typeof input === "object") return Object.values(input as Record<string, unknown>).slice(0, 24).flatMap((item) => referenceText(item, depth + 1));
    return [];
  };
  const referenceIds = (input: unknown, validIds: Set<string>) => {
    const texts = referenceText(input).map((item) => item.trim()).filter(Boolean);
    return [...validIds].filter((id) => texts.some((text) => text === id || text.split(/[\s,，;；:：|/#、()[\]{}<>"'“”‘’]+/).includes(id))).slice(0, 12);
  };
  const evidenceTypeValue = (input: unknown): SocialClaim["evidenceType"] => {
    const value = scalarText(input, 24).toLowerCase();
    if (["fact", "事实", "事实判断", "observation"].some((token) => value.includes(token))) return "fact";
    if (["inference", "infer", "推断", "推理", "推测", "分析", "hypothesis"].some((token) => value.includes(token))) return "inference";
    return "unknown";
  };
  const confidenceValue = (input: unknown) => {
    if (typeof input === "string" && input.trim().endsWith("%")) return Math.max(0, Math.min(1, Number.parseFloat(input) / 100 || 0));
    return Math.max(0, Math.min(1, Number(input) || 0));
  };
  const parseClaims = (items: unknown): SocialClaim[] => Array.isArray(items) ? items.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const claim = item as Record<string, unknown>;
    const evidenceType = evidenceTypeValue(field(claim, "evidenceType", "evidence_type", "type", "判断类型"));
    const sharedEvidence = field(claim, "evidence", "references", "citations", "证据");
    const commentIds = referenceIds([field(claim, "commentIds", "comment_ids", "comments", "commentEvidence", "评论证据"), sharedEvidence], validCommentIds);
    const sourceIds = referenceIds([field(claim, "sourceIds", "source_ids", "sources", "sourceEvidence", "来源证据"), sharedEvidence], validSourceIds);
    if (evidenceType !== "unknown" && commentIds.length + sourceIds.length === 0) return [];
    const title = scalarText(field(claim, "title", "headline", "name", "结论", "标题"), 120);
    const summary = scalarText(field(claim, "summary", "analysis", "reason", "explanation", "content", "分析", "摘要"), 1200);
    if (!title || !summary || /^(未命名结论|unknown)$/i.test(title) || /^unknown$/i.test(summary)) return [];
    const counterInput = field(claim, "counterEvidence", "counter_evidence", "counterpoints", "limitations", "反证", "限制");
    const counterEvidence = Array.isArray(counterInput) ? counterInput.map((entry) => scalarText(entry, 300)).filter(Boolean).slice(0, 5) : scalarText(counterInput, 300) ? [scalarText(counterInput, 300)] : [];
    return [{ title, summary, evidenceType, commentIds, sourceIds, counterEvidence, confidence: confidenceValue(field(claim, "confidence", "confidenceScore", "confidence_score", "置信度")) }];
  }) : [];
  const unknownInput = field(root, "unknowns", "unknown_items", "unknown", "未知项");
  const context = {
    timeline: parseClaims(field(root, "timeline", "传播时间线")),
    socialDrivers: parseClaims(field(root, "socialDrivers", "social_drivers", "viralDrivers", "drivers", "爆火原因", "社会驱动")),
    audienceConsensus: parseClaims(field(root, "audienceConsensus", "audience_consensus", "consensus", "观众共识")),
    controversies: parseClaims(field(root, "controversies", "disputes", "争议")),
    externalFactors: parseClaims(field(root, "externalFactors", "external_factors", "platformFactors", "外部因素", "平台与社会外因")),
    unknowns: (Array.isArray(unknownInput) ? unknownInput : unknownInput === undefined ? [] : [unknownInput]).map((item) => scalarText(item, 300)).filter(Boolean).slice(0, 12),
  };
  const supportedDrivers = context.socialDrivers.filter((claim) => claim.evidenceType !== "unknown" && claim.commentIds.length + claim.sourceIds.length > 0);
  const supportedContextCount = [...context.timeline, ...context.audienceConsensus, ...context.controversies, ...context.externalFactors].filter((claim) => claim.evidenceType !== "unknown").length;
  return supportedDrivers.length >= 3 && supportedContextCount >= 2 ? context : null;
}

export function extractJsonObject(text: string) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)) as unknown; } catch { return null; }
}

export function inspectResearchShape(value: unknown) {
  const arrays: Array<{ path: string; length: number; itemType: string; itemKeys: string[] }> = [];
  const objects: Array<{ path: string; keys: string[] }> = [];
  const visit = (input: unknown, path: string, depth: number) => {
    if (depth > 4 || arrays.length + objects.length >= 40 || !input || typeof input !== "object") return;
    if (Array.isArray(input)) {
      const first = input[0];
      arrays.push({ path, length: input.length, itemType: Array.isArray(first) ? "array" : first === null ? "null" : typeof first, itemKeys: first && typeof first === "object" && !Array.isArray(first) ? Object.keys(first as Record<string, unknown>).slice(0, 20) : [] });
      input.slice(0, 2).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    const record = input as Record<string, unknown>;
    objects.push({ path, keys: Object.keys(record).slice(0, 30) });
    Object.entries(record).slice(0, 30).forEach(([key, item]) => visit(item, path ? `${path}.${key}` : key, depth + 1));
  };
  visit(value, "$", 0);
  return { rootType: Array.isArray(value) ? "array" : value === null ? "null" : typeof value, objects, arrays };
}

function toBase64Url(bytes: Uint8Array) {
  let binary = ""; bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function signResearchBundle(bundle: ResearchBundle, socialContext: SocialContext, receipt: ResearchReceipt, secret: string, now = Date.now()) {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ bundle, socialContext, receipt, exp: now + 30 * 60 * 1000 })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${toBase64Url(signature)}`;
}

function fromBase64Url(value: string) {
  const padding = (4 - (value.length % 4)) % 4;
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padding);
  const binary = atob(base64); return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function verifyResearchToken(token: string, secret: string, now = Date.now()) {
  const [payload, signature] = token.split("."); if (!payload || !signature) return null;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(signature), new TextEncoder().encode(payload));
    if (!valid) return null;
    const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { bundle?: ResearchBundle; socialContext?: SocialContext; receipt?: ResearchReceipt; exp?: number };
    if (!decoded.bundle || !decoded.socialContext || !decoded.receipt || !decoded.exp || decoded.exp <= now) return null;
    return { bundle: decoded.bundle, socialContext: decoded.socialContext, receipt: decoded.receipt, exp: decoded.exp };
  } catch { return null; }
}
