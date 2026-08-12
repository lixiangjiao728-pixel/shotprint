import { z } from "zod";

export const supportedPlatformSchema = z.enum(["douyin", "bilibili", "xiaohongshu", "unknown"]);
export type SupportedPlatform = z.infer<typeof supportedPlatformSchema>;

export const commentEvidenceSchema = z.object({
  id: z.string().min(1), text: z.string().min(1).max(2000), likes: z.number().nonnegative().optional(),
  timeLabel: z.string().max(32).optional(), replyTo: z.string().max(80).optional(), source: z.enum(["extension", "manual", "fixture"]),
}).strict();
export type CommentEvidence = z.infer<typeof commentEvidenceSchema>;

const sourceSchema = z.object({ id: z.string().optional(), title: z.string(), url: z.string().url(), publishedAt: z.string().optional(), retrievedAt: z.string(), snippet: z.string().optional(), queryIds: z.array(z.string()).optional(), relevance: z.number().min(0).max(1).optional() });
const searchReceiptSchema = z.object({ provider: z.string(), status: z.enum(["complete", "partial", "blocked"]), sourceCount: z.number().nonnegative(), retrievedAt: z.string(), errorCode: z.string().optional() });
const socialClaimSchema = z.object({ title: z.string(), summary: z.string(), evidenceType: z.enum(["fact", "inference", "unknown"]), commentIds: z.array(z.string()), sourceIds: z.array(z.string()), counterEvidence: z.array(z.string()), confidence: z.number().min(0).max(1) });
const socialContextSchema = z.object({ timeline: z.array(socialClaimSchema), socialDrivers: z.array(socialClaimSchema), audienceConsensus: z.array(socialClaimSchema), controversies: z.array(socialClaimSchema), externalFactors: z.array(socialClaimSchema), unknowns: z.array(z.string()) });
const emotionSchema = z.object({ label: z.string(), share: z.number().min(0).max(1), evidenceCount: z.number().nonnegative() });
const themeSchema = z.object({ label: z.string(), summary: z.string(), sampleCount: z.number().nonnegative(), sampleQuotes: z.array(z.string()).max(4), confidence: z.number().min(0).max(1) });
const evidenceClaimSchema = z.object({
  title: z.string(), summary: z.string(), evidence: z.array(z.string()).min(1), counterEvidence: z.array(z.string()), confidence: z.number().min(0).max(1),
  evidenceType: z.enum(["fact", "inference", "unknown"]).optional(), commentIds: z.array(z.string()).optional(), sourceIds: z.array(z.string()).optional(), timecodes: z.array(z.string()).optional(),
});
const difficultySchema = z.object({ label: z.string(), level: z.enum(["低", "中", "高"]), reason: z.string(), fallback: z.string() });
const directorBeatSchema = z.object({ startMs: z.number().nonnegative(), endMs: z.number().positive(), label: z.string(), intention: z.string(), evidence: z.string(), confidence: z.number().min(0).max(1) });
const shotSchema = z.object({ index: z.number().positive(), startMs: z.number().nonnegative(), endMs: z.number().positive(), visual: z.string(), action: z.string(), shot: z.string(), camera: z.string(), light: z.string(), audio: z.string(), narrative: z.string(), difficulty: z.enum(["低", "中", "高"]), fallback: z.string() });

export const linkAnalysisSchema = z.object({
  version: z.union([z.literal("link.1"), z.literal("link.2"), z.literal("link.3")]),
  analysisStatus: z.enum(["audience_only", "complete", "blocked", "partial"]).optional(),
  videoStatus: z.enum(["not_provided", "provided", "failed", "blocked"]).optional(),
  source: z.object({ platform: supportedPlatformSchema, url: z.string().url(), canonicalUrl: z.string().url(), title: z.string(), author: z.string(), coverUrl: z.string().optional(), publishedAt: z.string().optional(), durationMs: z.number().nonnegative().optional(), metrics: z.object({ views: z.number().nonnegative().optional(), likes: z.number().nonnegative().optional(), comments: z.number().nonnegative().optional(), shares: z.number().nonnegative().optional(), favorites: z.number().nonnegative().optional() }) }),
  collection: z.object({ method: z.enum(["extension", "manual", "fixture", "none"]), status: z.enum(["complete", "partial", "blocked", "none"]), engine: z.enum(["extension-api", "extension-dom", "browser-act-network", "browser-act-dom"]).optional(), strategyVersion: z.string().optional(), sampleCount: z.number().nonnegative(), evidenceSampleCount: z.number().nonnegative().optional(), totalVisible: z.number().nonnegative().optional(), targetCount: z.number().positive().optional(), pageCount: z.number().nonnegative().optional(), cursorCount: z.number().nonnegative().optional(), scrollActions: z.number().nonnegative().optional(), durationMs: z.number().nonnegative().optional(), stopReason: z.string().optional(), continuationAvailable: z.boolean().optional(), sortMode: z.string().optional(), collectedAt: z.string(), warnings: z.array(z.string()) }),
  audience: z.object({ emotions: z.array(emotionSchema).min(1), themes: z.array(themeSchema).min(1), audienceNeeds: z.array(z.string()).min(1), comments: z.array(commentEvidenceSchema).max(200) }),
  viralFactors: z.array(evidenceClaimSchema).min(1).max(5),
  director: z.object({ thesis: z.string(), audience: z.string(), beats: z.array(directorBeatSchema), strengths: z.array(z.string()), improvements: z.array(z.string()) }),
  production: z.object({ cinematography: z.array(z.string()), artAndLight: z.array(z.string()), editing: z.array(z.string()), sound: z.array(z.string()), aiWorkflow: z.array(z.string()), difficulty: z.array(difficultySchema) }),
  playbook: z.object({
    directions: z.array(z.object({ title: z.string(), premise: z.string(), retainedMechanism: z.string(), changedElements: z.string() })), recommendedDirection: z.string(),
    brief: z.object({ logline: z.string(), audience: z.string(), emotion: z.string(), durationMs: z.number().positive(), aspectRatio: z.string() }),
    beats: z.array(z.object({ startMs: z.number().nonnegative(), endMs: z.number().positive(), label: z.string(), story: z.string(), emotion: z.string() })), shots: z.array(shotSchema),
    visualBible: z.array(z.string()), promptSkeletons: z.array(z.string()), editAndSound: z.array(z.string()), budgetOptions: z.array(z.object({ label: z.string(), people: z.string(), hours: z.string(), cost: z.string() })), experiments: z.array(z.string()), risks: z.array(z.string()),
  }),
  socialContext: socialContextSchema.optional(),
  researchReceipt: z.object({ status: z.enum(["complete", "partial", "blocked"]), queryCount: z.number().nonnegative(), sourceCount: z.number().nonnegative(), domainCount: z.number().nonnegative(), costCny: z.number().nonnegative(), retrievedAt: z.string(), errorCode: z.string().optional(), originalCommentCount: z.number().nonnegative().optional(), commentEvidenceCount: z.number().nonnegative().optional() }).optional(),
  videoEvidence: z.object({
    acquisition: z.enum(["download_upload", "manual_upload", "tab_capture"]),
    durationMs: z.number().nonnegative(), aspectRatio: z.string(),
    audioStatus: z.enum(["detected", "missing", "unknown"]),
    visualStatus: z.enum(["complete", "partial", "failed"]),
    shotCount: z.number().nonnegative(), analyzedAt: z.string(), warnings: z.array(z.string()),
  }).optional(),
  videoPageEvidence: z.object({ title: z.string(), durationMs: z.number().nonnegative(), width: z.number().nonnegative(), height: z.number().nonnegative(), playerReady: z.boolean(), muted: z.boolean(), sharedAudioDetected: z.boolean().nullable(), captions: z.string().max(4000).optional() }).optional(),
  sources: z.array(sourceSchema), searchReceipt: searchReceiptSchema, evidence: z.object({ coveragePercent: z.number().min(0).max(100), timecodes: z.array(z.string()), sourceCount: z.number().nonnegative(), notes: z.array(z.string()) }), warnings: z.array(z.string()), provenance: z.object({ model: z.string(), collector: z.string(), analyzedAt: z.string(), note: z.string() }),
}).strict();
export type LinkAnalysis = z.infer<typeof linkAnalysisSchema>;

export type RawComment = Partial<CommentEvidence> & { text?: unknown; author?: unknown; avatar?: unknown; userId?: unknown };

export function detectPlatform(value: string): SupportedPlatform {
  try { const host = new URL(value).hostname.toLowerCase(); if (host.includes("douyin") || host.includes("iesdouyin")) return "douyin"; if (host.includes("bilibili") || host === "b23.tv") return "bilibili"; if (host.includes("xiaohongshu") || host === "xhslink.com") return "xiaohongshu"; } catch { /* invalid URL */ }
  return "unknown";
}

export function normalizeLink(value: string) {
  const parsed = new URL(value.trim()); parsed.hash = "";
  ["utm_source", "utm_medium", "utm_campaign", "share_token", "share_medium", "from_spmid"].forEach((key) => parsed.searchParams.delete(key));
  return parsed.toString();
}

export function cleanSocialTitle(value: string | undefined, platform: SupportedPlatform) {
  const fallback = "待从原页面读取标题"; if (!value?.trim()) return fallback;
  let title = value.trim().replace(/\s+/g, " ");
  if (platform === "bilibili") title = title.replace(/[_\s|·-]+哔哩哔哩(?:[_\s-]*bilibili)?\s*$/i, "");
  if (platform === "douyin") title = title.replace(/[_\s|·-]+抖音\s*$/i, "");
  if (platform === "xiaohongshu") title = title.replace(/[_\s|·-]+小红书\s*$/i, "");
  title = title
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/(?:复制此链接|打开(?:抖音|Dou音|小红书|哔哩哔哩|B站).*?$)/gi, "")
    .replace(/\s*#[^#]+(?=\s+#|$)/g, "")
    .replace(/\s*@[^\s#]+/g, "")
    .replace(/^[\d.：:\s]+/, "")
    .trim();
  const workName = title.match(/《[^》]{1,32}》(?:\s*第[一二三四五六七八九十百千万\d]+(?:集|期|章|季))?/);
  if (workName) return workName[0].replace(/\s+/g, " ").slice(0, 48);
  const sentence = title.split(/[。！？!?；;｜|]/)[0]?.trim() || title;
  return (sentence.length > 48 ? `${sentence.slice(0, 47).trimEnd()}…` : sentence) || fallback;
}

function anonymizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(/^回复\s+@[^:：]{1,80}[:：]\s*/i, "").replace(/@[\w\u4e00-\u9fff-]{1,40}/g, "@匿名用户").slice(0, 2000);
}

export function sanitizeComments(raw: RawComment[], source: CommentEvidence["source"] = "extension") {
  return raw.slice(0, 200).flatMap((item, index) => {
    const text = typeof item.text === "string" ? anonymizeText(item.text) : ""; if (!text) return [];
    return [{ id: typeof item.id === "string" && item.id ? item.id.slice(0, 80) : `comment-${index + 1}`, text, likes: typeof item.likes === "number" && item.likes >= 0 ? Math.floor(item.likes) : undefined, timeLabel: typeof item.timeLabel === "string" ? item.timeLabel.slice(0, 32) : undefined, replyTo: typeof item.replyTo === "string" ? "匿名回复" : undefined, source } satisfies CommentEvidence];
  });
}

function quote(comments: CommentEvidence[], fallback: string) { return comments.slice(0, 2).map((comment) => comment.text.slice(0, 80)).filter(Boolean).join("；") || fallback; }
function classify(comment: string) {
  if (/恐怖|害怕|吓|诡异|阴间|惊/.test(comment)) return "紧张";
  if (/感动|治愈|温暖|泪|共鸣|好哭/.test(comment)) return "共鸣";
  if (/哈哈|笑|搞笑|抽象/.test(comment)) return "娱乐";
  if (/怎么做|模型|提示词|生成|ai|AI|工具/.test(comment)) return "求知";
  if (/期待|想看|下一集|蹲|等/.test(comment)) return "期待";
  return "好奇";
}
function themeFor(comment: string) {
  if (/怎么做|模型|提示词|生成|ai|AI|工具/.test(comment)) return "制作求知";
  if (/感动|治愈|温暖|泪|共鸣|好哭/.test(comment)) return "情绪共鸣";
  if (/恐怖|害怕|吓|诡异|阴间|惊/.test(comment)) return "惊吓悬念";
  if (/期待|想看|下一集|蹲|等/.test(comment)) return "追更期待";
  return "画面与故事";
}
function normalizeSources(items: Array<{ id?: string; title: string; url: string; publishedAt?: string; retrievedAt?: string; snippet?: string; queryIds?: string[]; relevance?: number }>, retrievedAt: string) {
  const seen = new Set<string>();
  return items.flatMap((item) => { try { const url = new URL(item.url); if (url.protocol !== "https:" || seen.has(url.toString())) return []; seen.add(url.toString()); return [{ id: item.id, title: item.title.slice(0, 200), url: url.toString(), publishedAt: item.publishedAt, retrievedAt: item.retrievedAt || retrievedAt, snippet: item.snippet?.slice(0, 800), queryIds: item.queryIds?.slice(0, 8), relevance: typeof item.relevance === "number" ? Math.max(0, Math.min(1, item.relevance)) : undefined }]; } catch { return []; } }).slice(0, 20);
}

type VideoEvidence = { metadata?: { durationMs?: number; title?: string }; shots?: Array<{ startMs?: number; endMs?: number; narrativeFunction?: string; action?: string; shotSize?: string; camera?: string; motion?: string; lighting?: string; transcript?: string; audio?: string; evidence?: string; confidence?: number }>; narrative?: { logline?: string; hook?: string; conflict?: string; escalation?: string; reversal?: string; climax?: string; resolution?: string }; productionHypotheses?: Array<{ category?: string; estimate?: string; evidence?: string; confidence?: number }> };

function blockedSections(): Pick<LinkAnalysis, "director" | "production" | "playbook"> {
  return { director: { thesis: "未取得视频/录屏，无法进行导演层面的时间码判断。", audience: "unknown", beats: [], strengths: [], improvements: [] }, production: { cinematography: [], artAndLight: [], editing: [], sound: [], aiWorkflow: [], difficulty: [] }, playbook: { directions: [], recommendedDirection: "blocked", brief: { logline: "补传视频或录屏后生成复刻方案。", audience: "unknown", emotion: "unknown", durationMs: 1, aspectRatio: "unknown" }, beats: [], shots: [], visualBible: [], promptSkeletons: [], editAndSound: [], budgetOptions: [], experiments: [], risks: ["未完成逐镜取证，禁止把评论推测当作镜头事实。"] } };
}

export function buildLinkAnalysis(input: { url: string; platform?: SupportedPlatform; title?: string; author?: string; coverUrl?: string; publishedAt?: string; durationMs?: number; metrics?: LinkAnalysis["source"]["metrics"]; comments?: RawComment[]; method?: "extension" | "manual" | "fixture" | "none"; sources?: Array<{ id?: string; title: string; url: string; publishedAt?: string; retrievedAt?: string; snippet?: string; queryIds?: string[]; relevance?: number }>; searchReceipt?: { provider?: string; status?: "complete" | "partial" | "blocked"; sourceCount?: number; retrievedAt?: string; errorCode?: string }; socialContext?: LinkAnalysis["socialContext"]; researchReceipt?: LinkAnalysis["researchReceipt"]; videoEvidence?: LinkAnalysis["videoEvidence"]; videoPageEvidence?: LinkAnalysis["videoPageEvidence"]; collectionDetails?: Partial<LinkAnalysis["collection"]>; videoAnalysis?: VideoEvidence; requireVideoEvidence?: boolean }): LinkAnalysis {
  const platform = input.platform ?? detectPlatform(input.url); const canonicalUrl = normalizeLink(input.url); const method = input.method ?? (input.comments?.length ? "extension" : "none");
  const comments = sanitizeComments(input.comments ?? [], method === "manual" ? "manual" : method === "fixture" ? "fixture" : "extension"); const retrievedAt = new Date().toISOString(); const sources = normalizeSources(input.sources ?? [], retrievedAt);
  const counts = new Map<string, CommentEvidence[]>(); for (const comment of comments) { const key = themeFor(comment.text); counts.set(key, [...(counts.get(key) ?? []), comment]); }
  const themes = [...counts.entries()].slice(0, 5).map(([label, items]) => ({ label, summary: `评论集中讨论“${label}”，这是观众直接表达的主题，不等于播放因果。`, sampleCount: items.length, sampleQuotes: items.slice(0, 2).map((item) => item.text.slice(0, 80)), confidence: Math.min(.95, .35 + items.length / Math.max(1, comments.length) * .6) }));
  if (!themes.length) themes.push({ label: "样本不足", summary: "没有可用评论样本。", sampleCount: 0, sampleQuotes: [], confidence: .1 });
  const emotionCounts = new Map<string, number>(); comments.forEach((comment) => emotionCounts.set(classify(comment.text), (emotionCounts.get(classify(comment.text)) ?? 0) + 1));
  const emotions = [...emotionCounts.entries()].map(([label, count]) => ({ label, share: comments.length ? count / comments.length : 1, evidenceCount: count })); if (!emotions.length) emotions.push({ label: "unknown", share: 1, evidenceCount: 0 });
  const evidenceIds = comments.slice(0, 4).map((comment) => comment.id); const sourceIds = sources.map((source) => source.url);
  const topic = themes[0]?.label || "样本不足"; const topicQuote = quote(comments, "没有可用评论引用");
  let viralFactors: Array<z.infer<typeof evidenceClaimSchema>> = [
    { title: `观众反复讨论：${topic}`, summary: `评论样本的最高频主题是“${topic}”，可作为观众兴趣的信号。`, evidence: [`comment:${evidenceIds.join(",") || "none"}`, topicQuote], counterEvidence: [comments.length < 30 ? "评论样本少于30条，不能代表全体观众。" : "账号体量、推荐机制和投流数据不可见。"], confidence: comments.length ? Math.min(.9, .35 + comments.length / 100) : .1, evidenceType: comments.length ? "fact" : "unknown", commentIds: evidenceIds, sourceIds },
    { title: "情绪驱动互动", summary: `样本中“${emotions.sort((a, b) => b.share - a.share)[0]?.label || "unknown"}”占比最高，可能解释评论动机，但不是因果证明。`, evidence: [`emotion:${emotions.map((emotion) => `${emotion.label}:${Math.round(emotion.share * 100)}%`).join(",")}`], counterEvidence: ["没有曝光、完播、转发的对照数据。"], confidence: comments.length >= 30 ? .62 : .35, evidenceType: "inference" as const, commentIds: evidenceIds },
    { title: "平台与外部因素仍未知", summary: "账号历史表现、热点、推荐和投流无法从评论单独确认。", evidence: sources.length ? [`source:${sourceIds.join(",")}`] : ["unknown:无联网来源"], counterEvidence: ["不能把相关性写成确定因果。"], confidence: sources.length >= 3 ? .5 : .15, evidenceType: sources.length >= 3 ? "inference" : "unknown", sourceIds },
  ];
  if (input.socialContext?.socialDrivers.length) viralFactors = input.socialContext.socialDrivers.slice(0, 5).map((claim) => ({ title: claim.title, summary: claim.summary, evidence: [...claim.commentIds.map((id) => `comment:${id}`), ...claim.sourceIds.map((id) => `source:${id}`), ...(claim.evidenceType === "unknown" ? ["unknown:公开证据不足"] : [])], counterEvidence: claim.counterEvidence, confidence: claim.confidence, evidenceType: claim.evidenceType, commentIds: claim.commentIds, sourceIds: claim.sourceIds }));
  const syntheticVideo: VideoEvidence | undefined = method === "fixture" || (method === "manual" && input.requireVideoEvidence !== true) ? { metadata: { durationMs: input.durationMs ?? 20800 }, shots: [{ startMs: 0, endMs: 3000, narrativeFunction: "开场钩子", action: "建立问题", shotSize: "中景", camera: "固定机位", lighting: "屏幕光", audio: "提示音", evidence: "fixture evidence" }, { startMs: 3000, endMs: 9000, narrativeFunction: "信息释放", action: "补充线索", shotSize: "近景", camera: "慢推", lighting: "冷光", audio: "环境声", evidence: "fixture evidence" }, { startMs: 9000, endMs: 15000, narrativeFunction: "反转", action: "重写前文", shotSize: "特写", camera: "快速切换", lighting: "对比光", audio: "低频落点", evidence: "fixture evidence" }, { startMs: 15000, endMs: input.durationMs ?? 20800, narrativeFunction: "尾钩", action: "留下问题", shotSize: "字幕", camera: "静止", lighting: "黑屏", audio: "尾音", evidence: "fixture evidence" }] } : undefined;
  const video = input.videoAnalysis ?? syntheticVideo; const hasVideo = Boolean(video && Array.isArray(video.shots) && video.shots.length && Number(video.metadata?.durationMs ?? input.durationMs) > 0); const mustBlock = input.requireVideoEvidence === true && !hasVideo;
  let sections = blockedSections();
  if (hasVideo && !mustBlock) {
    const durationMs = Math.max(1, Math.round(video?.metadata?.durationMs ?? input.durationMs ?? 1)); const shots = (video?.shots ?? []).filter((shot) => Number(shot.startMs) >= 0 && Number(shot.endMs) > Number(shot.startMs)).map((shot, index) => ({ index: index + 1, startMs: Number(shot.startMs), endMs: Number(shot.endMs), visual: shot.evidence || "由视频模型观察", action: shot.action || "unknown", shot: shot.shotSize || "unknown", camera: shot.camera || "unknown", light: shot.lighting || "unknown", audio: [shot.transcript, shot.audio].filter((value) => value && value !== "unknown").join("；") || "unknown", narrative: shot.narrativeFunction || "unknown", difficulty: "中" as const, fallback: "改用固定机位与字幕叙事" }));
    const directorBeats = shots.map((shot) => ({ startMs: shot.startMs, endMs: shot.endMs, label: shot.narrative, intention: `以${shot.shot}和${shot.camera}传递信息`, evidence: shot.visual, confidence: .55 }));
    sections = { director: { thesis: video?.narrative?.logline || "根据上传视频的镜头证据拆解叙事意图。", audience: "由评论主题与视频内容共同推断", beats: directorBeats, strengths: ["开头信息在时间码内可核验", "镜头节奏与观众情绪可以对照", "制作判断保留证据边界"], improvements: ["补充真实留存/转发数据以验证传播假设", "对低置信度镜头进行人工复核"] }, production: { cinematography: shots.slice(0, 4).map((shot) => `${shot.shot} / ${shot.camera} / ${shot.visual}`), artAndLight: shots.slice(0, 3).map((shot) => shot.light), editing: shots.slice(0, 4).map((shot) => `${shot.startMs}–${shot.endMs}ms 镜头切换`), sound: shots.slice(0, 3).map((shot) => shot.audio), aiWorkflow: ["只记录可从成片观察到的生成/后期迹象，不还原 seed、checkpoint 或原提示词。"], difficulty: [{ label: "镜头一致性", level: "中", reason: "跨镜头角色与空间需要保持连续。", fallback: "固定参考图并减少复杂运动。" }] }, playbook: { directions: ["现实职业迁移", "家庭关系迁移", "原创奇幻迁移"].map((title, index) => ({ title, premise: `${topic}机制迁移方向 ${index + 1}`, retainedMechanism: `保留${topic}带来的情绪触发`, changedElements: "替换人物、场景、台词与IP元素" })), recommendedDirection: "现实职业迁移", brief: { logline: `围绕“${topic}”创作一个原创短故事。`, audience: "与原视频情绪需求相近的移动端观众", emotion: emotions[0]?.label || "好奇", durationMs, aspectRatio: "9:16" }, beats: shots.map((shot) => ({ startMs: shot.startMs, endMs: shot.endMs, label: shot.narrative, story: shot.action, emotion: emotions[0]?.label || "好奇" })), shots, visualBible: ["保持原创人物与场景，不复制原作身份", "9:16，统一色彩和参考图"], promptSkeletons: shots.slice(0, 6).map((shot) => `[${shot.shot}] 原创主体，${shot.camera}，${shot.light}，${shot.visual}，避免可识别IP`), editAndSound: ["按原片可核验节奏剪辑", "为每次信息变化保留声音落点"], budgetOptions: [{ label: "个人低成本版", people: "1人", hours: "6–10小时", cost: "约200–800元" }, { label: "2–3人标准版", people: "导演/剪辑/声音或美术", hours: "1–2天", cost: "约1000–4000元" }], experiments: ["前三秒两版钩子A/B", "记录3秒留存、完播、评论、转发、收藏"], risks: ["替换原作身份、台词、IP元素，避免高相似复刻"] } };
    viralFactors = viralFactors.map((factor, index) => {
      const beat = sections.director.beats[index % Math.max(1, sections.director.beats.length)];
      const timecode = beat ? `${beat.startMs}–${beat.endMs}ms` : "unknown";
      const commentId = factor.commentIds?.[0] || comments[0]?.id;
      const sourceId = factor.sourceIds?.[0] || sources[0]?.id || sources[0]?.url;
      return {
        ...factor,
        commentIds: commentId ? [...new Set([...(factor.commentIds || []), commentId])] : factor.commentIds,
        sourceIds: sourceId ? [...new Set([...(factor.sourceIds || []), sourceId])] : factor.sourceIds,
        timecodes: beat ? [timecode] : [],
        evidence: [...factor.evidence, ...(beat ? [`video:${timecode} ${beat.evidence}`] : [])],
      };
    });
  }
  const coverageItems = [comments.length > 0, comments.length >= 30, sources.length >= 3, hasVideo, hasVideo && (sections.director.beats.length > 0)]; const coveragePercent = Math.round(coverageItems.filter(Boolean).length / coverageItems.length * 100);
  const warningList = [comments.length ? "评论已去标识化，仅用于本次分析。" : "评论样本不足，观众结论为unknown。", comments.length < 30 ? "评论少于30条，报告标记为partial。" : "", sources.length < 3 ? "联网来源少于3个，网页事实为unknown。" : "", !hasVideo ? "未取得视频/录屏；导演、制作、时间码和复刻方案已阻断。" : ""].filter(Boolean);
  const searchReceipt = { provider: input.searchReceipt?.provider || "bailian-native", status: input.searchReceipt?.status || (sources.length >= 3 ? "complete" : sources.length ? "partial" : "blocked"), sourceCount: sources.length, retrievedAt: input.searchReceipt?.retrievedAt || retrievedAt, ...(input.searchReceipt?.errorCode ? { errorCode: input.searchReceipt.errorCode } : {}) } as LinkAnalysis["searchReceipt"];
  const report: LinkAnalysis = { version: input.socialContext ? "link.3" : method === "fixture" ? "link.1" : hasVideo ? "link.2" : "link.1", analysisStatus: hasVideo ? (comments.length >= 30 && sources.length >= 3 ? "complete" : "partial") : "audience_only", videoStatus: hasVideo ? "provided" : "blocked", source: { platform, url: input.url, canonicalUrl, title: cleanSocialTitle(input.title, platform), author: input.author || "待从原页面读取作者", coverUrl: input.coverUrl, publishedAt: input.publishedAt, durationMs: hasVideo ? Number(video?.metadata?.durationMs) : input.durationMs, metrics: input.metrics ?? {} }, collection: { method, status: method === "none" ? "none" : comments.length < 30 ? "partial" : "complete", sampleCount: comments.length, evidenceSampleCount: comments.length, totalVisible: comments.length, collectedAt: retrievedAt, warnings: warningList, ...input.collectionDetails }, audience: { emotions, themes, audienceNeeds: [...new Set(themes.map((theme) => theme.label))].slice(0, 3), comments }, viralFactors, ...sections, ...(input.socialContext ? { socialContext: input.socialContext } : {}), ...(input.researchReceipt ? { researchReceipt: input.researchReceipt } : {}), ...(input.videoEvidence ? { videoEvidence: input.videoEvidence } : {}), ...(input.videoPageEvidence ? { videoPageEvidence: input.videoPageEvidence } : {}), sources, searchReceipt, evidence: { coveragePercent, timecodes: hasVideo ? sections.director.beats.map((beat) => `${beat.startMs}–${beat.endMs}ms`) : [], sourceCount: sources.length, notes: ["覆盖率按评论、30条阈值、3个来源、真实视频和时间码五项实际证据计算。", ...warningList] }, warnings: warningList, provenance: { model: input.socialContext ? "shotprint-deep-research-v3" : hasVideo ? "shotprint-link-evidence-v2" : "shotprint-link-audience-v2", collector: method, analyzedAt: retrievedAt, note: "评论与网页文本按不可信输入处理；观察事实、模型推测和unknown分开标记。" } };
  return linkAnalysisSchema.parse(report);
}

export function mergeLocalAudienceEvidence(
  report: LinkAnalysis,
  rawComments: RawComment[],
  method: "extension" | "manual",
  collectionDetails: Partial<LinkAnalysis["collection"]> = {},
) {
  const comments = sanitizeComments(rawComments, method === "manual" ? "manual" : "extension");
  if (!comments.length) return report;
  const counts = new Map<string, CommentEvidence[]>();
  for (const comment of comments) {
    const label = themeFor(comment.text);
    counts.set(label, [...(counts.get(label) ?? []), comment]);
  }
  const themes = [...counts.entries()].slice(0, 5).map(([label, items]) => ({
    label,
    summary: `评论集中讨论“${label}”；原文仅在当前浏览器内参与分析，不经过Cloudflare。`,
    sampleCount: items.length,
    sampleQuotes: items.slice(0, 2).map((item) => item.text.slice(0, 80)),
    confidence: Math.min(.95, .35 + items.length / Math.max(1, comments.length) * .6),
  }));
  const emotionCounts = new Map<string, number>();
  comments.forEach((comment) => emotionCounts.set(classify(comment.text), (emotionCounts.get(classify(comment.text)) ?? 0) + 1));
  const emotions = [...emotionCounts.entries()].map(([label, count]) => ({ label, share: count / comments.length, evidenceCount: count }));
  const validCommentIds = new Set(comments.map((comment) => comment.id));
  const fallbackIds = comments.slice(0, 4).map((comment) => comment.id);
  const viralFactors = report.viralFactors.map((factor) => {
    const localIds = (factor.commentIds ?? []).filter((id) => validCommentIds.has(id));
    const commentIds = localIds.length ? localIds : fallbackIds;
    return { ...factor, commentIds, evidence: [...factor.evidence.filter((item) => !item.startsWith("comment:")), `comment:${commentIds.join(",")}`] };
  });
  const localWarnings = [
    "评论原文仅保留在当前浏览器内存；Cloudflare只接收匿名统计摘要和证据编号。",
    ...(comments.length < 30 ? ["评论少于30条，观众结论标记为partial。"] : []),
  ];
  const warnings = [...report.warnings.filter((warning) => !warning.includes("评论")), ...localWarnings];
  const hasVideo = report.videoStatus === "provided";
  const coverageItems = [true, comments.length >= 30, report.sources.length >= 3, hasVideo, hasVideo && report.director.beats.length > 0];
  const merged: LinkAnalysis = {
    ...report,
    analysisStatus: hasVideo ? (comments.length >= 30 && report.sources.length >= 3 ? "complete" : "partial") : "audience_only",
    collection: {
      ...report.collection,
      ...collectionDetails,
      method,
      status: comments.length < 30 ? "partial" : "complete",
      sampleCount: Math.max(comments.length, Number(collectionDetails.sampleCount) || 0),
      evidenceSampleCount: comments.length,
      totalVisible: Math.max(comments.length, Number(collectionDetails.totalVisible) || 0),
      warnings: localWarnings,
    },
    audience: { emotions, themes, audienceNeeds: [...new Set(themes.map((theme) => theme.label))].slice(0, 3), comments },
    viralFactors,
    evidence: {
      ...report.evidence,
      coveragePercent: Math.round(coverageItems.filter(Boolean).length / coverageItems.length * 100),
      notes: [...report.evidence.notes.filter((note) => !note.includes("评论")), ...localWarnings],
    },
    warnings,
    provenance: { ...report.provenance, note: "评论原文在浏览器本地合并；服务端仅使用匿名观众摘要、联网来源和视频证据。" },
  };
  return linkAnalysisSchema.parse(merged);
}

export function linkAnalysisToMarkdown(report: LinkAnalysis) {
  const factors = report.viralFactors.map((item) => `- **${item.title}**：${item.summary}（${Math.round(item.confidence * 100)}%）\n  - 证据：${item.evidence.join("；")}\n  - 反证：${item.counterEvidence.join("；")}`).join("\n");
  const shots = report.playbook.shots.map((shot) => `### ${String(shot.index).padStart(2, "0")} · ${shot.startMs}–${shot.endMs}ms\n- 画面：${shot.visual}\n- 摄影：${shot.shot} / ${shot.camera}\n- 声音：${shot.audio}\n- 叙事：${shot.narrative}`).join("\n\n");
  return `# ${report.source.title} · 镜谱链接分析\n\n来源：${report.source.canonicalUrl}\n状态：${report.analysisStatus ?? "unknown"}\n\n## 为什么爆\n\n${factors}\n\n## 导演拆解\n\n${report.director.thesis}\n\n${report.director.strengths.map((item) => `- 有效选择：${item}`).join("\n") || "- 未取得视频证据"}\n\n## 制作拆解\n\n${report.production.cinematography.concat(report.production.artAndLight, report.production.editing, report.production.sound, report.production.aiWorkflow).map((item) => `- ${item}`).join("\n") || "- 未取得视频证据"}\n\n## 复刻作战书\n推荐方向：${report.playbook.recommendedDirection}\n\n${report.playbook.brief.logline}\n\n${shots || "补传视频或录屏后生成逐镜作战书。"}\n`;
}

export function linkAnalysisToCsv(report: LinkAnalysis) {
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const header = ["类型", "平台", "ID/镜头", "正文/画面", "起始ms", "结束ms", "来源"].map(escape).join(",");
  const comments = report.audience.comments.map((comment) => ["comment", report.source.platform, comment.id, comment.text, "", "", comment.source].map(escape).join(","));
  const shots = report.playbook.shots.map((shot) => ["shot", report.source.platform, String(shot.index), shot.visual, shot.startMs, shot.endMs, "video-analysis"].map(escape).join(","));
  return `\uFEFF${[header, ...comments, ...shots].join("\n")}`;
}
