import { analysisResultSchema, normalizeAnalysis, validateEvidenceCoverage, type AnalysisResult } from "../../../lib/analysis";
import { deleteOssObject, inspectOssObject, normalizeBailianBaseUrl, presignOssUrl, verifyUploadToken } from "../../../lib/aliyun";
import { reserveAnalysisBudget, settleAnalysisBudget, usageCostMicros, type BailianUsage } from "../../../lib/cost-budget";
import { getEnv, jsonError } from "../../../lib/server";

export const dynamic = "force-dynamic";

const OUTPUT_EXAMPLE = JSON.stringify({
  version: "1.0",
  metadata: { title: "unknown", durationMs: 5000, aspectRatio: "9:16", language: "unknown", analyzedAt: "2026-01-01T00:00:00.000Z" },
  shots: [{
    id: "shot-01", startMs: 0, endMs: 5000, transcript: "unknown", shotSize: "unknown", camera: "unknown",
    motion: "unknown", action: "unknown", lighting: "unknown", palette: ["#000000"], audio: "unknown",
    narrativeFunction: "unknown", evidence: "unknown", confidence: 0, localBoundary: false,
  }],
  narrative: {
    logline: "unknown", hook: "unknown", conflict: "unknown", escalation: "unknown", reversal: "unknown", climax: "unknown", resolution: "unknown",
    pace: [{ label: "opening", timeMs: 0, intensity: 10 }, { label: "middle", timeMs: 2500, intensity: 50 }, { label: "ending", timeMs: 5000, intensity: 30 }],
    stats: { averageShotSeconds: 5, fastestShotSeconds: 5, dialogueRatio: 0 },
  },
  productionHypotheses: [{ category: "unknown", estimate: "unknown", evidence: "unknown", confidence: 0 }],
  reusableTemplate: {
    storyVariables: ["unknown"], beatSheet: ["unknown"], globalVisualRules: ["unknown"], shotPrompts: ["unknown"],
    negativeConstraints: ["unknown"], editAndSound: ["unknown"],
  },
  warnings: ["unknown"],
  provenance: { model: "qwen3.5-omni-plus", localCutCount: 0, note: "unknown" },
});

function rawEvidencePrompt(durationMs: number, cuts: number[]) {
  return `你是影视视听取证员。逐段观看并聆听这条短片，输出一份可供另一个模型整理的中文证据记录，不要输出schema或模板。

必须覆盖：真实起止时间码、画面主体与动作、景别、机位、运动、灯光、色彩、可听到的对白/旁白、音乐、音效、叙事作用，以及每项是观察事实还是推测。听不清或看不清写unknown；“未检测到”不等于“没有”。

本机候选切点：${cuts.join(", ")}；浏览器读取总时长：${durationMs}ms。证据需覆盖从0ms到${durationMs}ms，不能使用固定时长。每段附0–1置信度。不要猜seed、checkpoint或原提示词。`;
}

function structurePrompt(rawEvidence: string, durationMs: number, cuts: number[], repairIssues?: string[]) {
  return `你是视听证据结构整理器。只依据下方“原始视听证据”整理 AnalysisResult v1 JSON，不添加原始证据没有的事实。

硬规则：不能从成片确认的内容写 unknown；生产参数只能写带画面或声音证据与 0–1 置信度的推测；不复制角色身份、原台词或作品标识；所有时间用毫秒。

本机画面差异检测得到的候选边界：${cuts.join(", ")}；总时长必须为 ${durationMs}ms。模型判断与本机边界不一致时，以原始视听证据为准，但在 evidence 解释。

顶层字段：version 固定 1.0；metadata(title,durationMs,aspectRatio,language,analyzedAt)；shots[]；narrative；productionHypotheses[]；reusableTemplate；warnings[]；provenance。

每个 shot：id,startMs,endMs,transcript,shotSize,camera,motion,action,lighting,palette(十六进制色数组),audio,narrativeFunction,evidence,confidence,localBoundary。

narrative：logline,hook,conflict,escalation,reversal,climax,resolution,pace[{label,timeMs,intensity}],stats{averageShotSeconds,fastestShotSeconds,dialogueRatio}。

reusableTemplate：storyVariables,beatSheet,globalVisualRules,shotPrompts,negativeConstraints,editAndSound，均为字符串数组。provenance.model 写实际模型名，localCutCount 写 ${cuts.length}，note 解释边界。必须输出完整标准 JSON，不要 Markdown。

类型硬规则：所有标为字符串的字段只能是 JSON string，无法判断时必须写字符串 "unknown"，绝不能写 null、对象、数组或数字；字符串数组的每一项也只能是字符串。严格仿照下面的键、层级和 JSON 类型，仅替换成视频分析值，不得改名或增加嵌套：
${repairIssues?.length ? `上一版结构问题：${repairIssues.join(",")}。只纠正结构和类型，不添加新事实。` : ""}

原始视听证据：
${rawEvidence.slice(0, 48_000)}

标准JSON结构：
${OUTPUT_EXAMPLE}`;
}

function outputFromSse(payload: string) {
  let content = "";
  let usage: BailianUsage | null = null;
  for (const line of payload.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string | null } }>; usage?: BailianUsage | null };
      const part = chunk.choices?.[0]?.delta?.content;
      if (typeof part === "string") content += part;
      if (chunk.usage && Number.isFinite(chunk.usage.prompt_tokens) && Number.isFinite(chunk.usage.completion_tokens)) usage = chunk.usage;
    } catch {
      // Ignore malformed keepalive chunks; the final JSON is validated below.
    }
  }
  return { text: content.trim(), usage };
}

function parseJsonOutput(raw: string) {
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  return JSON.parse(cleaned) as unknown;
}

async function callBailian(key: string, baseUrl: string, model: string, prompt: string, maxOutputTokens: number, videoUrl?: string, structured = false) {
  const content: Array<{ type: "video_url"; video_url: { url: string } } | { type: "text"; text: string }> = [];
  if (videoUrl) content.push({ type: "video_url", video_url: { url: videoUrl } });
  content.push({ type: "text", text: prompt });
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: structured ? "严格按用户提供的字段生成标准 JSON，不输出解释或 Markdown。" : "只记录从视频中实际观察或听到的视听证据；不猜测不可确认信息。" },
        { role: "user", content },
      ],
      stream: true,
      stream_options: { include_usage: true },
      modalities: ["text"],
      enable_thinking: false,
      max_tokens: maxOutputTokens,
      ...(structured ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(videoUrl ? 240_000 : 120_000),
  });
  if (!response.ok) throw new Error(`Bailian analysis failed: ${response.status}`);
  const output = outputFromSse(await response.text());
  if (!output.text) throw new Error("Bailian returned no text");
  return output;
}

export async function POST(request: Request) {
  const runtime = await getEnv();
  if (!runtime.DASHSCOPE_API_KEY || !runtime.OSS_ACCESS_KEY_ID || !runtime.OSS_ACCESS_KEY_SECRET || !runtime.OSS_BUCKET || !runtime.OSS_ENDPOINT) {
    return jsonError("当前部署没有配置百炼与 OSS。请使用内置样片。", 503);
  }
  let body: { objectKey?: string; uploadToken?: string; mimeType?: string; durationMs?: number; localCuts?: number[] };
  try { body = await request.json(); } catch { return jsonError("分析参数不是有效 JSON。", 400); }
  if (!body.objectKey || !body.uploadToken || !body.mimeType || !body.durationMs) return jsonError("视频凭证无效，请重新上传。", 400);
  const claims = await verifyUploadToken(runtime, body.uploadToken);
  if (!claims || claims.objectKey !== body.objectKey || claims.mimeType !== body.mimeType || claims.durationMs !== body.durationMs) {
    return jsonError("视频凭证已失效或被修改，请重新上传。", 400);
  }
  let uploaded: Awaited<ReturnType<typeof inspectOssObject>>;
  try {
    uploaded = await inspectOssObject(runtime, body.objectKey);
  } catch {
    return jsonError("暂时无法核验已上传的视频，请稍后重试。", 502);
  }
  if (!uploaded) return jsonError("已上传的视频不存在或已经被清理，请重新上传。", 400);
  if (uploaded.size !== claims.size || uploaded.mimeType !== claims.mimeType) {
    const cleaned = await deleteOssObject(runtime, body.objectKey);
    return jsonError(cleaned ? "已上传的视频与上传凭证不一致，临时文件已清理，请重新上传。" : "已上传的视频与上传凭证不一致，且临时文件清理失败，请联系管理员。", 400);
  }
  let reservation: Awaited<ReturnType<typeof reserveAnalysisBudget>>;
  try {
    reservation = await reserveAnalysisBudget(runtime, { maxModelCalls: 3 });
  } catch {
    const cleaned = await deleteOssObject(runtime, body.objectKey);
    return jsonError(cleaned
      ? "费用保护暂时无法预留额度，真实分析已安全暂停；临时视频已清理。"
      : "费用保护不可用且 OSS 临时视频清理失败，请联系管理员。", 503);
  }
  if (!reservation.ok) {
    const cleaned = await deleteOssObject(runtime, body.objectKey);
    return jsonError(cleaned ? reservation.reason : `${reservation.reason} OSS 临时视频清理失败，请联系管理员。`, 402);
  }
  const localCuts = Array.isArray(body.localCuts) ? body.localCuts.filter((value) => Number.isFinite(value) && value >= 0 && value <= body.durationMs!).slice(0, 600) : [];
  const model = runtime.DASHSCOPE_MODEL || "qwen3.5-omni-plus";
  let result: AnalysisResult | null = null;
  let analysisFailed = false;
  let failureStage = "unknown";
  let actualCostMicros = reservation.config.fixedMicrosPerAnalysis;
  try {
    const baseUrl = normalizeBailianBaseUrl(runtime.DASHSCOPE_BASE_URL);
    const videoUrl = await presignOssUrl(runtime, "GET", body.objectKey, { ttlSeconds: 1200 });
    const evidenceCall = await callBailian(runtime.DASHSCOPE_API_KEY, baseUrl, model, rawEvidencePrompt(body.durationMs, localCuts), Math.min(8000, reservation.config.maxOutputTokens), videoUrl, false);
    actualCostMicros += usageCostMicros(evidenceCall.usage, reservation.config);
    const structureModel = runtime.DASHSCOPE_SEARCH_MODEL || "qwen-plus";
    const structureCall = await callBailian(runtime.DASHSCOPE_API_KEY, baseUrl, structureModel, structurePrompt(evidenceCall.text, body.durationMs, localCuts), reservation.config.maxOutputTokens, undefined, true);
    actualCostMicros += usageCostMicros(structureCall.usage, reservation.config);
    let raw = structureCall.text;
    let candidate: unknown;
    try { candidate = parseJsonOutput(raw); } catch { candidate = null; }
    const firstValidation = analysisResultSchema.safeParse(candidate);
    if (!firstValidation.success) {
      const issueSummary = firstValidation.error.issues.slice(0, 12).map((issue) => `${issue.path.join(".")}:${issue.code}`);
      console.warn("Bailian schema validation failed; repairing", issueSummary);
      const repairCall = await callBailian(runtime.DASHSCOPE_API_KEY, baseUrl, structureModel, structurePrompt(evidenceCall.text, body.durationMs, localCuts, issueSummary), reservation.config.maxOutputTokens, undefined, true);
      actualCostMicros += usageCostMicros(repairCall.usage, reservation.config);
      raw = repairCall.text;
      candidate = parseJsonOutput(raw);
    }
    const finalValidation = analysisResultSchema.safeParse(candidate);
    if (!finalValidation.success) {
      failureStage = `schema:${finalValidation.error.issues.slice(0, 12).map((issue) => `${issue.path.join(".")}:${issue.code}`).join(",")}`;
      throw new Error("Bailian response failed AnalysisResult v1 validation");
    }
    result = normalizeAnalysis(finalValidation.data, localCuts);
    const coverageError = validateEvidenceCoverage(result, body.durationMs);
    if (coverageError) { failureStage = coverageError; throw new Error(coverageError); }
    result.provenance = { ...result.provenance, model: `${model} → ${structureModel}`, note: `${result.provenance.note}; provider=aliyun-bailian; raw-evidence=omni; structuring=qwen-plus` };
  } catch (error) {
    if (failureStage === "unknown") failureStage = error instanceof Error ? error.message.slice(0, 160) : "unknown";
    console.warn("Bailian analysis stopped safely", failureStage);
    analysisFailed = true;
    actualCostMicros = reservation.reservedMicros;
  }
  const budgetSettled = await settleAnalysisBudget(runtime, reservation.id, actualCostMicros).catch(() => false);
  const cleaned = await deleteOssObject(runtime, body.objectKey);
  if (analysisFailed || !result) {
    return jsonError(cleaned
      ? "模型没有返回结构完整的分析。临时视频已清理，请重试或使用内置样片。"
      : "分析失败且 OSS 临时视频清理失败。请联系管理员检查对象存储后再重试。", 502);
  }
  if (!cleaned) {
    result.warnings = [...result.warnings, "OSS 临时视频自动清理失败；管理员需要立即检查并删除该对象。"];
    result.provenance.note += "; cleanup=failed";
  } else {
    result.provenance.note += "; cleanup=deleted";
  }
  if (!budgetSettled) {
    result.warnings = [...result.warnings, "费用结算失败；本次预留额度保持锁定，后续真实分析会安全暂停。"];
    result.provenance.note += "; budget=reserved";
  } else {
    result.provenance.note += "; budget=settled";
  }
  return Response.json({ result }, { headers: { "cache-control": "no-store" } });
}
