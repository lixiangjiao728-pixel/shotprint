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

type VideoEvidence = {
  metadata?: { durationMs?: number; title?: string; aspectRatio?: string };
  shots?: Array<{ startMs?: number; endMs?: number; narrativeFunction?: string; action?: string; shotSize?: string; camera?: string; motion?: string; lighting?: string; transcript?: string; audio?: string; evidence?: string; confidence?: number }>;
  narrative?: { logline?: string; hook?: string; conflict?: string; escalation?: string; reversal?: string; climax?: string; resolution?: string };
  productionHypotheses?: Array<{ category?: string; estimate?: string; evidence?: string; confidence?: number }>;
  reusableTemplate?: { storyVariables?: string[]; beatSheet?: string[]; globalVisualRules?: string[]; shotPrompts?: string[]; negativeConstraints?: string[]; editAndSound?: string[] };
};

function hasCoveredVideo(video: VideoEvidence | undefined, fallbackDuration?: number) {
  const durationMs = Math.round(Number(video?.metadata?.durationMs ?? fallbackDuration) || 0);
  const shots = (video?.shots ?? []).filter((shot) => Number(shot.startMs) >= 0 && Number(shot.endMs) > Number(shot.startMs)).sort((a, b) => Number(a.startMs) - Number(b.startMs));
  const minimum = durationMs >= 120_000 ? Math.ceil(durationMs / 60_000) + 1 : durationMs >= 15_000 ? 3 : 1;
  return durationMs > 0 && durationMs <= 300_000 && shots.length >= minimum && Number(shots[0]?.startMs) <= 500 && Number(shots.at(-1)?.endMs) >= durationMs - 500 && shots.every((shot) => String(shot.evidence || "").trim() && String(shot.evidence).toLowerCase() !== "unknown");
}

function evenlySample<T>(items: T[], limit: number) {
  if (items.length <= limit) return items;
  return Array.from({ length: limit }, (_, index) => items[Math.round(index * (items.length - 1) / (limit - 1))]);
}

function uniqueUseful(items: Array<string | undefined>, fallback: string, limit = 8) {
  const values = [...new Set(items.map((item) => item?.trim()).filter((item): item is string => Boolean(item && item.toLowerCase() !== "unknown")))];
  return (values.length ? values : [fallback]).slice(0, limit);
}

function blockedSections(): Pick<LinkAnalysis, "director" | "production" | "playbook"> {
  return { director: { thesis: "未取得视频/录屏，无法进行导演层面的时间码判断。", audience: "unknown", beats: [], strengths: [], improvements: [] }, production: { cinematography: [], artAndLight: [], editing: [], sound: [], aiWorkflow: [], difficulty: [] }, playbook: { directions: [], recommendedDirection: "blocked", brief: { logline: "补传视频或录屏后生成复刻方案。", audience: "unknown", emotion: "unknown", durationMs: 1, aspectRatio: "unknown" }, beats: [], shots: [], visualBible: [], promptSkeletons: [], editAndSound: [], budgetOptions: [], experiments: [], risks: ["未完成逐镜取证，禁止把评论推测当作镜头事实。"] } };
}

export function buildLinkAnalysis(input: { url: string; platform?: SupportedPlatform; title?: string; author?: string; coverUrl?: string; publishedAt?: string; durationMs?: number; metrics?: LinkAnalysis["source"]["metrics"]; comments?: RawComment[]; method?: "extension" | "manual" | "fixture" | "none"; sources?: Array<{ id?: string; title: string; url: string; publishedAt?: string; retrievedAt?: string; snippet?: string; queryIds?: string[]; relevance?: number }>; searchReceipt?: { provider?: string; status?: "complete" | "partial" | "blocked"; sourceCount?: number; retrievedAt?: string; errorCode?: string }; socialContext?: LinkAnalysis["socialContext"]; researchReceipt?: LinkAnalysis["researchReceipt"]; videoEvidence?: LinkAnalysis["videoEvidence"]; videoPageEvidence?: LinkAnalysis["videoPageEvidence"]; collectionDetails?: Partial<LinkAnalysis["collection"]>; videoAnalysis?: VideoEvidence; requireVideoEvidence?: boolean }): LinkAnalysis {
  const platform = input.platform ?? detectPlatform(input.url); const canonicalUrl = normalizeLink(input.url); const method = input.method ?? (input.comments?.length ? "extension" : "none");
  const comments = sanitizeComments(input.comments ?? [], method === "manual" ? "manual" : method === "fixture" ? "fixture" : "extension"); const retrievedAt = new Date().toISOString(); const sources = normalizeSources(input.sources ?? [], retrievedAt);
  const counts = new Map<string, CommentEvidence[]>(); for (const comment of comments) { const key = themeFor(comment.text); counts.set(key, [...(counts.get(key) ?? []), comment]); }
  const rankedThemes = [...counts.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "zh-CN"));
  const themes = rankedThemes.slice(0, 5).map(([label, items]) => ({ label, summary: `评论集中讨论“${label}”，这是观众直接表达的主题，不等于播放因果。`, sampleCount: items.length, sampleQuotes: items.slice(0, 2).map((item) => item.text.slice(0, 80)), confidence: Math.min(.95, .35 + items.length / Math.max(1, comments.length) * .6) }));
  if (!themes.length) themes.push({ label: "样本不足", summary: "没有可用评论样本。", sampleCount: 0, sampleQuotes: [], confidence: .1 });
  const emotionCounts = new Map<string, number>(); comments.forEach((comment) => emotionCounts.set(classify(comment.text), (emotionCounts.get(classify(comment.text)) ?? 0) + 1));
  const emotions = [...emotionCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).map(([label, count]) => ({ label, share: comments.length ? count / comments.length : 1, evidenceCount: count })); if (!emotions.length) emotions.push({ label: "unknown", share: 1, evidenceCount: 0 });
  const evidenceIds = (rankedThemes[0]?.[1] ?? comments).slice(0, 4).map((comment) => comment.id); const sourceIds = sources.map((source) => source.id || source.url);
  const topic = themes[0]?.label || "样本不足"; const topicQuote = quote(comments, "没有可用评论引用");
  let viralFactors: Array<z.infer<typeof evidenceClaimSchema>> = [
    { title: `观众反复讨论：${topic}`, summary: `评论样本的最高频主题是“${topic}”，可作为观众兴趣的信号。`, evidence: [`comment:${evidenceIds.join(",") || "none"}`, topicQuote], counterEvidence: [comments.length < 30 ? "评论样本少于30条，不能代表全体观众。" : "账号体量、推荐机制和投流数据不可见。"], confidence: comments.length ? Math.min(.9, .35 + comments.length / 100) : .1, evidenceType: comments.length ? "fact" : "unknown", commentIds: evidenceIds, sourceIds },
    { title: "情绪驱动互动", summary: `样本中“${emotions[0]?.label || "unknown"}”占比最高，可能解释评论动机，但不是因果证明。`, evidence: [`emotion:${emotions.map((emotion) => `${emotion.label}:${Math.round(emotion.share * 100)}%`).join(",")}`], counterEvidence: ["没有曝光、完播、转发的对照数据。"], confidence: comments.length >= 30 ? .62 : .35, evidenceType: "inference" as const, commentIds: evidenceIds },
    { title: "平台与外部因素仍未知", summary: "账号历史表现、热点、推荐和投流无法从评论单独确认。", evidence: sources.length ? [`source:${sourceIds.join(",")}`] : ["unknown:无联网来源"], counterEvidence: ["不能把相关性写成确定因果。"], confidence: sources.length >= 3 ? .5 : .15, evidenceType: sources.length >= 3 ? "inference" : "unknown", sourceIds },
  ];
  if (input.socialContext?.socialDrivers.length) viralFactors = input.socialContext.socialDrivers.slice(0, 5).map((claim) => ({ title: claim.title, summary: claim.summary, evidence: [...claim.commentIds.map((id) => `comment:${id}`), ...claim.sourceIds.map((id) => `source:${id}`), ...(claim.evidenceType === "unknown" ? ["unknown:公开证据不足"] : [])], counterEvidence: claim.counterEvidence, confidence: claim.confidence, evidenceType: claim.evidenceType, commentIds: claim.commentIds, sourceIds: claim.sourceIds }));
  const syntheticVideo: VideoEvidence | undefined = method === "fixture" || (method === "manual" && input.requireVideoEvidence !== true) ? { metadata: { durationMs: input.durationMs ?? 20800 }, shots: [{ startMs: 0, endMs: 3000, narrativeFunction: "开场钩子", action: "建立问题", shotSize: "中景", camera: "固定机位", lighting: "屏幕光", audio: "提示音", evidence: "fixture evidence" }, { startMs: 3000, endMs: 9000, narrativeFunction: "信息释放", action: "补充线索", shotSize: "近景", camera: "慢推", lighting: "冷光", audio: "环境声", evidence: "fixture evidence" }, { startMs: 9000, endMs: 15000, narrativeFunction: "反转", action: "重写前文", shotSize: "特写", camera: "快速切换", lighting: "对比光", audio: "低频落点", evidence: "fixture evidence" }, { startMs: 15000, endMs: input.durationMs ?? 20800, narrativeFunction: "尾钩", action: "留下问题", shotSize: "字幕", camera: "静止", lighting: "黑屏", audio: "尾音", evidence: "fixture evidence" }] } : undefined;
  const video = input.videoAnalysis ?? syntheticVideo; const hasVideo = hasCoveredVideo(video, input.durationMs); const mustBlock = input.requireVideoEvidence === true && !hasVideo;
  let sections = blockedSections();
  if (hasVideo && !mustBlock) {
    const durationMs = Math.max(1, Math.round(video?.metadata?.durationMs ?? input.durationMs ?? 1));
    const shots = (video?.shots ?? []).filter((shot) => Number(shot.startMs) >= 0 && Number(shot.endMs) > Number(shot.startMs)).map((shot, index) => {
      const confidence = Math.max(0, Math.min(1, Number(shot.confidence) || 0));
      const complex = /跟拍|环绕|摇移|航拍|快速|变焦|长镜头/.test(`${shot.camera} ${shot.motion}`);
      const difficulty = confidence < .55 || complex ? "高" as const : /固定|静止/.test(`${shot.camera} ${shot.motion}`) ? "低" as const : "中" as const;
      return { index: index + 1, startMs: Number(shot.startMs), endMs: Number(shot.endMs), visual: shot.evidence || "由视频模型观察", action: shot.action || "unknown", shot: shot.shotSize || "unknown", camera: [shot.camera, shot.motion].filter((value) => value && value !== "unknown").join(" / ") || "unknown", light: shot.lighting || "unknown", audio: [shot.transcript, shot.audio].filter((value) => value && value !== "unknown").join("；") || "unknown", narrative: shot.narrativeFunction || "unknown", difficulty, fallback: difficulty === "高" ? "拆成固定机位主镜头 + 动作特写，保留信息顺序与声音落点。" : "用固定机位、单一光源和字幕完成同一叙事任务。", confidence };
    });
    const directorBeats = shots.map((shot) => ({ startMs: shot.startMs, endMs: shot.endMs, label: shot.narrative, intention: `${shot.action}；通过${shot.shot}、${shot.camera}完成该信息变化`, evidence: shot.visual, confidence: shot.confidence }));
    const productionHypotheses = (video?.productionHypotheses ?? []).filter((item) => item.estimate && item.estimate !== "unknown");
    const template = video?.reusableTemplate;
    const productionShots = evenlySample(shots, 8);
    const playbookShots = evenlySample(shots, 24).map((shot) => ({ index: shot.index, startMs: shot.startMs, endMs: shot.endMs, visual: shot.visual, action: shot.action, shot: shot.shot, camera: shot.camera, light: shot.light, audio: shot.audio, narrative: shot.narrative, difficulty: shot.difficulty, fallback: shot.fallback }));
    const visualBible = uniqueUseful([...(template?.globalVisualRules ?? []), "所有人物、场景、台词与作品标识均使用原创内容。"], "9:16；主体眼线位于上三分之一；连续镜头保持光向一致。", 10);
    const promptSkeletons = uniqueUseful(template?.shotPrompts ?? productionShots.map((shot) => `${shot.shot}，原创主体执行“${shot.action}”，${shot.camera}，${shot.light}，时长${((shot.endMs - shot.startMs) / 1000).toFixed(1)}秒，声音：${shot.audio}`), "中景，原创主体完成明确动作，固定机位，侧光，3秒，保留环境声。", 12);
    const editAndSound = uniqueUseful(template?.editAndSound ?? [], `按${(durationMs / 1000).toFixed(1)}秒总长重建节拍，每次信息变化配置清晰声音落点。`, 10);
    const hardShots = shots.filter((shot) => shot.difficulty === "高").length;
    sections = {
      director: { thesis: video?.narrative?.logline || "根据上传视频的完整时间轴，拆解每次信息变化与观众情绪节点。", audience: `核心评论主题为“${topic}”；具体传播因果仍需用留存和转发数据验证`, beats: directorBeats, strengths: uniqueUseful([video?.narrative?.hook, video?.narrative?.reversal, video?.narrative?.climax], "时间码内的信息变化可逐项核验。", 5), improvements: ["先复核低于55%置信度的镜头，再进入制作。", "上线后用3秒留存、关键转折留存、完播和转发率验证传播假设。"] },
      production: { cinematography: productionShots.map((shot) => `${shot.startMs}–${shot.endMs}ms · ${shot.shot} · ${shot.camera} · ${shot.action}`), artAndLight: uniqueUseful(productionShots.map((shot) => shot.light), "灯光信息不足，开拍前先锁定主光方向。", 8), editing: productionShots.map((shot) => `${shot.startMs}–${shot.endMs}ms · ${((shot.endMs - shot.startMs) / 1000).toFixed(1)}秒 · ${shot.narrative}`), sound: uniqueUseful(productionShots.map((shot) => shot.audio), "未确认声音证据；先制作纯画面版，再单独补声音。", 8), aiWorkflow: uniqueUseful(productionHypotheses.map((item) => `${item.category}：${item.estimate}；证据：${item.evidence || "unknown"}；置信度${Math.round((item.confidence || 0) * 100)}%`), "只复用可观察的视觉机制，不还原 seed、checkpoint 或原提示词。", 8), difficulty: [{ label: "关键镜头落地", level: hardShots > shots.length / 3 ? "高" : hardShots ? "中" : "低", reason: `${shots.length}个证据镜头中有${hardShots}个包含复杂运动或低置信度判断。`, fallback: "复杂镜头拆成固定主镜头、动作特写和反应镜头；先做3镜头样片验证一致性。" }] },
      playbook: {
        directions: [
          { title: "现实职业迁移", premise: `把“${topic}”放入一个原创职业困境`, retainedMechanism: video?.narrative?.hook || "保留开头的信息缺口与关键转折顺序", changedElements: "替换人物身份、行业、场景、台词与全部作品标识" },
          { title: "家庭关系迁移", premise: `把“${topic}”改写为原创家庭关系冲突`, retainedMechanism: video?.narrative?.reversal || "保留误解—证据—重新判断的节奏", changedElements: "重写人物关系、证据物、冲突结果与对白" },
          { title: "原创奇幻迁移", premise: `用原创规则世界承载“${topic}”`, retainedMechanism: video?.narrative?.climax || "保留逐层升级与尾钩", changedElements: "重建世界观、角色造型、规则、场景与声音设计" },
        ],
        recommendedDirection: "现实职业迁移",
        brief: { logline: `围绕“${topic}”创作原创职业故事：主角在可见困境中发现一条反常证据，并用一次主动选择完成局势反转。`, audience: "与原视频情绪需求相近的移动端观众", emotion: emotions[0]?.label || "好奇", durationMs, aspectRatio: video?.metadata?.aspectRatio || "9:16" },
        beats: evenlySample(shots, 12).map((shot) => ({ startMs: shot.startMs, endMs: shot.endMs, label: shot.narrative, story: `${shot.action}；验收：画面静音时仍能看懂这次信息变化`, emotion: emotions[0]?.label || "好奇" })),
        shots: playbookShots,
        visualBible,
        promptSkeletons,
        editAndSound,
        budgetOptions: [{ label: "个人验证版", people: "1人", hours: `${Math.max(8, Math.ceil(durationMs / 30_000) * 2)}–${Math.max(12, Math.ceil(durationMs / 30_000) * 3)}小时`, cost: "约300–1200元；先完成3个关键镜头" }, { label: "2–3人完整成片", people: "导演/摄影或AI制作/剪辑声音", hours: `${Math.max(2, Math.ceil(durationMs / 90_000))}–${Math.max(3, Math.ceil(durationMs / 60_000))}天`, cost: "约2000–8000元；按镜头复杂度调整" }],
        experiments: [`钩子A/B：保留同一故事，只替换0–${Math.min(3000, shots[0]?.endMs || 3000)}ms的第一条信息；比较3秒留存。`, "转折验证：保持画面不变，只调整转折前的声音留白；比较关键节点留存。", "发布后同时记录3秒留存、完播、转发、收藏和评论主题，不用播放量单独证明因果。"],
        risks: uniqueUseful([...(template?.negativeConstraints ?? []), "不得复制原人物身份、原台词、作品标识或可识别IP。", "低置信度生产参数必须先做小样，不得当作源工程事实。"], "使用原创人物、场景、台词和作品标识。", 10),
      },
    };
    const strongestBeat = sections.director.beats.find((beat) => /钩子|反转|高潮|揭示/.test(beat.label)) || [...sections.director.beats].sort((a, b) => b.confidence - a.confidence)[0];
    if (strongestBeat) {
      const timecode = `${strongestBeat.startMs}–${strongestBeat.endMs}ms`;
      const commentIds = comments.slice(0, 3).map((comment) => comment.id);
      viralFactors = [...viralFactors.slice(0, 4), { title: "可验证的内容机制假设", summary: `评论高频主题“${topic}”与${timecode}的“${strongestBeat.label}”可组成待验证假设：该节点可能把观众情绪转成互动，但必须用节点留存与转发数据验证。`, evidence: [...commentIds.map((id) => `comment:${id}`), `video:${timecode} ${strongestBeat.evidence}`], counterEvidence: ["评论和镜头同时出现不等于传播因果；账号体量、投流和推荐数据仍不可见。"], confidence: Math.min(.72, .35 + comments.length / 200), evidenceType: "inference", commentIds, sourceIds: [], timecodes: [timecode] }];
    }
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
  const rankedThemes = [...counts.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "zh-CN"));
  const themes = rankedThemes.slice(0, 5).map(([label, items]) => ({
    label,
    summary: `评论集中讨论“${label}”；原文仅在当前浏览器内参与分析，不经过Cloudflare。`,
    sampleCount: items.length,
    sampleQuotes: items.slice(0, 2).map((item) => item.text.slice(0, 80)),
    confidence: Math.min(.95, .35 + items.length / Math.max(1, comments.length) * .6),
  }));
  const emotionCounts = new Map<string, number>();
  comments.forEach((comment) => emotionCounts.set(classify(comment.text), (emotionCounts.get(classify(comment.text)) ?? 0) + 1));
  const emotions = [...emotionCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).map(([label, count]) => ({ label, share: count / comments.length, evidenceCount: count }));
  const validCommentIds = new Set(comments.map((comment) => comment.id));
  const viralFactors = report.viralFactors.map((factor) => {
    const commentIds = (factor.commentIds ?? []).filter((id) => validCommentIds.has(id));
    const evidence = [...factor.evidence.filter((item) => !item.startsWith("comment:")), ...(commentIds.length ? [`comment:${commentIds.join(",")}`] : [])];
    return { ...factor, commentIds, evidence: evidence.length ? evidence : ["unknown:本地评论证据编号未匹配"] };
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
  const shots = report.playbook.shots.map((shot) => `### ${String(shot.index).padStart(2, "0")} · ${shot.startMs}–${shot.endMs}ms\n- 任务：${shot.action}\n- 画面证据：${shot.visual}\n- 摄影：${shot.shot} / ${shot.camera} / ${shot.light}\n- 声音：${shot.audio}\n- 叙事：${shot.narrative}\n- 难度：${shot.difficulty}\n- 失败替代：${shot.fallback}`).join("\n\n");
  const bullets = (items: string[]) => items.map((item) => `- ${item}`).join("\n") || "- unknown";
  const budgets = report.playbook.budgetOptions.map((item) => `- ${item.label}：${item.people}；${item.hours}；${item.cost}`).join("\n") || "- unknown";
  return `# ${report.source.title} · 镜谱链接分析\n\n来源：${report.source.canonicalUrl}\n状态：${report.analysisStatus ?? "unknown"}\n\n## 为什么爆\n\n${factors}\n\n## 导演拆解\n\n${report.director.thesis}\n\n${report.director.strengths.map((item) => `- 有效选择：${item}`).join("\n") || "- 未取得视频证据"}\n\n## 制作拆解\n\n${report.production.cinematography.concat(report.production.artAndLight, report.production.editing, report.production.sound, report.production.aiWorkflow).map((item) => `- ${item}`).join("\n") || "- 未取得视频证据"}\n\n## 复刻作战书\n\n推荐方向：${report.playbook.recommendedDirection}\n\n${report.playbook.brief.logline}\n\n### 视觉圣经\n\n${bullets(report.playbook.visualBible)}\n\n### 镜头提示词骨架\n\n${bullets(report.playbook.promptSkeletons)}\n\n### 剪辑与声音\n\n${bullets(report.playbook.editAndSound)}\n\n### 预算与工期\n\n${budgets}\n\n### 上线验证\n\n${bullets(report.playbook.experiments)}\n\n### 原创边界与风险\n\n${bullets(report.playbook.risks)}\n\n## 逐镜执行清单\n\n${shots || "补传视频或录屏后生成逐镜作战书。"}\n`;
}

export function linkAnalysisToCsv(report: LinkAnalysis) {
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const header = ["类型", "平台", "ID/镜头", "正文/画面", "起始ms", "结束ms", "来源"].map(escape).join(",");
  const comments = report.audience.comments.map((comment) => ["comment", report.source.platform, comment.id, comment.text, "", "", comment.source].map(escape).join(","));
  const shots = report.playbook.shots.map((shot) => ["shot", report.source.platform, String(shot.index), shot.visual, shot.startMs, shot.endMs, "video-analysis"].map(escape).join(","));
  return `\uFEFF${[header, ...comments, ...shots].join("\n")}`;
}
