export const COMMENT_EVIDENCE_MAX_ITEMS = 100;
export const COMMENT_EVIDENCE_MAX_TEXT_CHARS = 6_000;
export const COMMENT_EVIDENCE_MAX_COMMENT_CHARS = 60;

export type CommentEvidenceReceipt = {
  originalSampleCount: number;
  evidenceSampleCount: number;
  textChars: number;
  truncated: boolean;
  contract: "comment-evidence.2";
};

export type SafeCommentEvidence = {
  id: string;
  text: string;
  likes?: number;
  timeLabel?: string;
  replyTo?: string;
  source: "extension" | "manual" | "fixture";
};

export type AudienceDigest = {
  contract: "audience-digest.1";
  originalSampleCount: number;
  evidenceSampleCount: number;
  evidenceIds: string[];
  reactions: Array<{ label: string; count: number; evidenceIds: string[] }>;
  engagement: { questionCount: number; exclamationCount: number; likedCount: number; replyCount: number };
};

const AUDIENCE_SIGNAL_MATCHERS: Array<[string, RegExp]> = [
  ["support", /喜欢|支持|赞|好看|厉害|牛|感动|共鸣|真实|说得对|确实|respect/i],
  ["criticism", /不喜欢|尴尬|虚假|烂|差|无聊|恶心|反对|质疑|不合理|离谱|欺骗/i],
  ["curiosity", /[?？]|怎么|为什么|哪里|求|想知道|教程/i],
  ["surprise", /惊|震撼|没想到|居然|天啊|反转/i],
  ["empathy", /共鸣|我也是|像我|代入|心疼|焦虑|职场|女性|关系/i],
  ["share-intent", /转发|收藏|码住|分享|二创|学习|安利/i],
  ["craft-interest", /镜头|画面|剪辑|音乐|配音|特效|生成|模型|提示词|AI/i],
];

function cleanEvidenceText(value: unknown, limit = COMMENT_EVIDENCE_MAX_COMMENT_CHARS) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/https?:\/\/\S+|www\.\S+/gi, " 网页链接 ")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, " 联系方式 ")
    .replace(/@[\w\u3400-\u9fff-]{1,40}/g, "@匿名用户")
    .replace(/\b(?:select|union|insert|update|delete|drop|alter|script|javascript|onerror|system|assistant|prompt)\b/gi, " 安全词 ")
    .replace(/[^\p{L}\p{N}\s，。！？、；：“”‘’（）《》…—·,.!?;:'"()%+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function safeSource(value: unknown): SafeCommentEvidence["source"] {
  return value === "manual" || value === "fixture" ? value : "extension";
}

export function buildCommentEvidence(rawComments: unknown[]): { comments: SafeCommentEvidence[]; receipt: CommentEvidenceReceipt } {
  const candidates = rawComments.slice(0, 200).flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const raw = value as Record<string, unknown>;
    const text = cleanEvidenceText(raw.text);
    if (text.length < 2) return [];
    return [{ index, oldId: typeof raw.id === "string" ? raw.id : "", text, likes: Number.isFinite(Number(raw.likes)) ? Math.max(0, Math.min(10_000_000, Math.round(Number(raw.likes)))) : undefined, timeLabel: cleanEvidenceText(raw.timeLabel, 32) || undefined, oldReplyTo: typeof raw.replyTo === "string" ? raw.replyTo : "", source: safeSource(raw.source) }];
  });
  const topLiked = [...candidates].sort((a, b) => (b.likes || 0) - (a.likes || 0) || a.index - b.index).slice(0, 30);
  const evenlySpaced = Array.from({ length: Math.min(70, candidates.length) }, (_, slot) => candidates[Math.floor(slot * candidates.length / Math.min(70, candidates.length))]);
  const selected = [...new Map([...topLiked, ...evenlySpaced, ...candidates].map((item) => [item.index, item])).values()]
    .slice(0, COMMENT_EVIDENCE_MAX_ITEMS)
    .sort((a, b) => a.index - b.index);
  const oldToNew = new Map(selected.filter((item) => item.oldId).map((item, index) => [item.oldId, `E${String(index + 1).padStart(3, "0")}`]));
  const comments: SafeCommentEvidence[] = [];
  let textChars = 0;
  for (const item of selected) {
    if (textChars + item.text.length > COMMENT_EVIDENCE_MAX_TEXT_CHARS) break;
    const id = `E${String(comments.length + 1).padStart(3, "0")}`;
    comments.push({ id, text: item.text, ...(item.likes === undefined ? {} : { likes: item.likes }), ...(item.timeLabel ? { timeLabel: item.timeLabel } : {}), ...(item.oldReplyTo && oldToNew.has(item.oldReplyTo) ? { replyTo: oldToNew.get(item.oldReplyTo) } : {}), source: item.source });
    textChars += item.text.length;
  }
  return { comments, receipt: { originalSampleCount: candidates.length, evidenceSampleCount: comments.length, textChars, truncated: comments.length < candidates.length || candidates.some((item) => item.text.length >= COMMENT_EVIDENCE_MAX_COMMENT_CHARS), contract: "comment-evidence.2" } };
}

export function buildAudienceDigest(rawComments: unknown[]) {
  const evidence = buildCommentEvidence(rawComments);
  const signalRows = AUDIENCE_SIGNAL_MATCHERS.map(([label, matcher]) => {
    const matches = evidence.comments.filter((comment) => matcher.test(comment.text));
    return { label, count: matches.length, evidenceIds: matches.slice(0, 12).map((comment) => comment.id) };
  });
  const matchedIds = new Set(signalRows.flatMap((row) => row.evidenceIds));
  const otherIds = evidence.comments.filter((comment) => !matchedIds.has(comment.id)).slice(0, 12).map((comment) => comment.id);
  const digest: AudienceDigest = {
    contract: "audience-digest.1",
    originalSampleCount: evidence.receipt.originalSampleCount,
    evidenceSampleCount: evidence.receipt.evidenceSampleCount,
    evidenceIds: evidence.comments.map((comment) => comment.id),
    reactions: [...signalRows, { label: "other", count: Math.max(0, evidence.comments.length - signalRows.reduce((sum, row) => sum + row.count, 0)), evidenceIds: otherIds }],
    engagement: {
      questionCount: evidence.comments.filter((comment) => /[?？]/.test(comment.text)).length,
      exclamationCount: evidence.comments.filter((comment) => /[!！]/.test(comment.text)).length,
      likedCount: evidence.comments.filter((comment) => Number(comment.likes) > 0).length,
      replyCount: evidence.comments.filter((comment) => Boolean(comment.replyTo)).length,
    },
  };
  return { evidence, digest };
}

export function normalizeAudienceDigest(value: unknown): AudienceDigest | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.contract !== "audience-digest.1") return null;
  const evidenceIds = Array.isArray(raw.evidenceIds) ? raw.evidenceIds.filter((id): id is string => typeof id === "string" && /^E\d{3}$/.test(id)).slice(0, 100) : [];
  if (!evidenceIds.length) return null;
  const allowedIds = new Set(evidenceIds);
  const reactions = Array.isArray(raw.reactions) ? raw.reactions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const label = typeof row.label === "string" && /^[a-z-]{2,24}$/.test(row.label) ? row.label : "";
    if (!label) return [];
    return [{ label, count: Math.max(0, Math.min(200, Math.round(Number(row.count) || 0))), evidenceIds: Array.isArray(row.evidenceIds) ? row.evidenceIds.filter((id): id is string => typeof id === "string" && allowedIds.has(id)).slice(0, 12) : [] }];
  }).slice(0, 12) : [];
  const engagementRaw = raw.engagement && typeof raw.engagement === "object" ? raw.engagement as Record<string, unknown> : {};
  const safeCount = (input: unknown) => Math.max(0, Math.min(200, Math.round(Number(input) || 0)));
  return {
    contract: "audience-digest.1",
    originalSampleCount: Math.max(evidenceIds.length, Math.min(200, safeCount(raw.originalSampleCount))),
    evidenceSampleCount: evidenceIds.length,
    evidenceIds,
    reactions,
    engagement: { questionCount: safeCount(engagementRaw.questionCount), exclamationCount: safeCount(engagementRaw.exclamationCount), likedCount: safeCount(engagementRaw.likedCount), replyCount: safeCount(engagementRaw.replyCount) },
  };
}

export function buildResearchRequest(input: { url: string; platform?: string; title?: string; author?: string; description?: string; videoId?: string; keywords?: string; comments: unknown[] }) {
  const { evidence, digest } = buildAudienceDigest(input.comments);
  return {
    evidence,
    digest,
    body: {
      url: String(input.url || "").slice(0, 800),
      platform: String(input.platform || "unknown").slice(0, 24),
      title: String(input.title || "").replace(/\s+/g, " ").trim().slice(0, 120),
      author: String(input.author || "").replace(/\s+/g, " ").trim().slice(0, 80),
      description: String(input.description || "").replace(/\s+/g, " ").trim().slice(0, 300),
      videoId: String(input.videoId || "").replace(/[^\w-]/g, "").slice(0, 80),
      keywords: String(input.keywords || "").replace(/\s+/g, " ").trim().slice(0, 160),
      commentEvidence: evidence.comments,
      audienceDigest: digest,
      commentReceipt: evidence.receipt,
    },
  };
}

export async function readSafeApiError(response: Response, fallback: string) {
  const rayId = response.headers.get("cf-ray") || response.headers.get("x-request-id") || "unknown";
  const contentType = response.headers.get("content-type") || "";
  if (response.status === 403 && !contentType.includes("application/json")) return `EDGE_BLOCKED_BEFORE_WORKER：Cloudflare在请求进入镜谱前返回HTTP 403；Ray ID ${rayId}。评论证据已留在本页内存，未启动百炼研究。`;
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (payload?.error) return payload.error;
  }
  return `${fallback}（HTTP ${response.status}${rayId !== "unknown" ? ` · Ray ID ${rayId}` : ""}）`;
}
