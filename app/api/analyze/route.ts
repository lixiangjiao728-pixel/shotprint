import { analysisResultSchema, normalizeAnalysis, sampleAuditCuts, validateActionability, validateEvidenceCoverage, type AnalysisResult } from "../../../lib/analysis";
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
    storyVariables: ["[原创主体]", "[原创冲突]", "[原创场景]"],
    beatSheet: ["0–15%：在3秒内用可见动作建立困境", "15–70%：每20秒增加一条新信息", "70–100%：完成反转并留下0.8秒尾钩"],
    globalVisualRules: ["9:16；主体眼线保持在上三分之一", "主色不超过3种", "连续镜头保持光向一致"],
    shotPrompts: ["中景，原创主体完成明确动作，固定机位，侧光，3秒，保留环境声", "近景，原创证据进入画面，缓慢推镜，冷色，2秒，加入落点音效", "特写，原创主体做出反应，平视固定，逆光，2秒，对白后留白0.3秒"],
    negativeConstraints: ["不复制原人物身份", "不复制原台词", "不使用原作品标识"],
    editAndSound: ["前3秒完成第一个信息变化", "每个转折前留0.3秒声音空隙", "结尾保留0.8秒黑场与尾音"],
  },
  warnings: ["unknown"],
  provenance: { model: "qwen3.5-omni-plus", localCutCount: 0, note: "unknown" },
});

function rawEvidencePrompt(durationMs: number, cuts: number[]) {
  const auditWindows = Array.from({ length: Math.ceil(durationMs / 60_000) }, (_, index) => `${index * 60_000}–${Math.min(durationMs, (index + 1) * 60_000)}ms`).join("、");
  return `你是影视视听取证员。逐段观看并聆听这条短片，输出一份可供另一个模型整理的中文证据记录，不要输出schema或模板。

必须覆盖：真实起止时间码、画面主体与动作、景别、机位、运动、灯光、色彩、可听到的对白/旁白、音乐、音效、叙事作用，以及每项是观察事实还是推测。听不清或看不清写unknown；“未检测到”不等于“没有”。

浏览器读取总时长：${durationMs}ms。按这些审计区间逐段检查，任何区间都不能跳过：${auditWindows}。先列逐镜证据，再单列开头15%、中段35–65%、结尾15%的叙事变化。

证据记录最多 48 个连续时间段。实际镜头更多时，合并相邻镜头并优先保留每个审计区间的开头、中部、结尾和候选切点附近变化；合并后的时间段仍必须从0ms连续覆盖到${durationMs}ms。重复或长镜头按审计区间记录可见的持续状态与变化，不要复制同一句结论充数。

本机候选切点（毫秒，仅作为复核线索，不得盲从）：${cuts.join(", ")}。证据必须连续覆盖0ms到${durationMs}ms；长视频不能只写开头或用几个泛化长镜头代替逐段观察。每段附0–1置信度。不要猜seed、checkpoint或原提示词。`;
}

function structurePrompt(rawEvidence: string, durationMs: number, cuts: number[], repairIssues?: string[], previousOutput?: string) {
  const minimumShotCount = durationMs >= 120_000 ? Math.ceil(durationMs / 60_000) + 1 : 3;
  const targetShotCount = Math.min(24, Math.max(minimumShotCount, cuts.filter((cut) => cut > 0 && cut < durationMs).length + 1));
  return `你是视听证据结构整理器。只依据下方“原始视听证据”整理 AnalysisResult v1 JSON，不添加原始证据没有的事实。

硬规则：不能从成片确认的内容写 unknown；生产参数只能写带画面或声音证据与 0–1 置信度的推测；不复制角色身份、原台词或作品标识；所有时间用毫秒。metadata.title只有画面或声音明确显示片名时才能填写，否则写unknown。

本机画面差异检测得到的候选边界：${cuts.join(", ")}；总时长必须为 ${durationMs}ms。模型判断与本机边界不一致时，以原始视听证据为准，但在 evidence 解释。

顶层字段：version 固定 1.0；metadata(title,durationMs,aspectRatio,language,analyzedAt)；shots[]；narrative；productionHypotheses[]；reusableTemplate；warnings[]；provenance。

每个 shot：id,startMs,endMs,transcript,shotSize,camera,motion,action,lighting,palette(十六进制色数组),audio,narrativeFunction,evidence,confidence,localBoundary。

shots[] 必须恰好 ${targetShotCount} 项。实际镜头更多时，把相邻镜头合并为连续证据段，优先保留本机候选边界附近的差异，但所有段仍须无空洞覆盖0ms到${durationMs}ms。每段 evidence 必须写明该时间范围内可见或可听的变化；重复画面也要如实写持续状态，不能虚构切点或叙事反转。

narrative：logline,hook,conflict,escalation,reversal,climax,resolution,pace[{label,timeMs,intensity}],stats{averageShotSeconds,fastestShotSeconds,dialogueRatio}。

reusableTemplate 必须是可以直接交给创作者执行的原创迁移方案：storyVariables至少3项；beatSheet至少3项且半数以上包含秒数、时间范围或百分比；globalVisualRules至少3项且使用可检查的构图、光色或连续性规则；shotPrompts至少3项，每项写清原创主体、动作、景别/机位、运动、灯光/色彩、建议时长与声音；negativeConstraints至少3项；editAndSound至少3项且写清节拍、帧数、秒数或声音落点。不得只写“保持节奏”“增强氛围”等空泛句子。

provenance.model 写实际模型名，localCutCount 写 ${cuts.length}，note 解释边界。必须输出完整标准 JSON，不要 Markdown。

类型硬规则：所有标为字符串的字段只能是 JSON string，无法判断时必须写字符串 "unknown"，绝不能写 null、对象、数组或数字；字符串数组的每一项也只能是字符串。严格仿照下面的键、层级和 JSON 类型，仅替换成视频分析值，不得改名或增加嵌套：
${repairIssues?.length ? `上一版结构问题：${repairIssues.join(",")}。只纠正结构和类型，不添加新事实。` : ""}
${previousOutput ? `上一版待修复 JSON（保留其中已有证据，只修正上述问题）：\n${previousOutput.slice(0, 48_000)}` : ""}

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

async function callBailian(key: string, baseUrl: string, model: string, prompt: string, maxOutputTokens: number, videoUrl?: string, structured = false, timeoutMs = 120_000) {
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
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Bailian analysis failed: ${response.status}`);
  const output = outputFromSse(await response.text());
  if (!output.text) throw new Error("Bailian returned no text");
  return output;
}

function validateCandidate(candidate: unknown, durationMs: number, localCuts: number[]) {
  const parsed = analysisResultSchema.safeParse(candidate);
  if (!parsed.success) return { result: null, issues: parsed.error.issues.slice(0, 12).map((issue) => `${issue.path.join(".")}:${issue.code}`) };
  const result = normalizeAnalysis(parsed.data, localCuts);
  const evidenceIssue = validateEvidenceCoverage(result, durationMs, localCuts);
  const actionabilityIssue = validateActionability(result);
  const issues = [evidenceIssue, actionabilityIssue].filter((issue): issue is string => Boolean(issue));
  return { result: issues.length ? null : result, issues };
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
    const videoTimeoutMs = Math.min(600_000, Math.max(240_000, body.durationMs * 2));
    const evidenceTokens = Math.min(body.durationMs >= 180_000 ? 12_000 : 8_000, reservation.config.maxOutputTokens);
    const evidenceCall = await callBailian(runtime.DASHSCOPE_API_KEY, baseUrl, model, rawEvidencePrompt(body.durationMs, localCuts), evidenceTokens, videoUrl, false, videoTimeoutMs);
    actualCostMicros += usageCostMicros(evidenceCall.usage, reservation.config);
    const structureModel = runtime.DASHSCOPE_SEARCH_MODEL || "qwen-plus";
    const auditCuts = sampleAuditCuts(localCuts, body.durationMs);
    const structureCall = await callBailian(runtime.DASHSCOPE_API_KEY, baseUrl, structureModel, structurePrompt(evidenceCall.text, body.durationMs, auditCuts), reservation.config.maxOutputTokens, undefined, true, 180_000);
    actualCostMicros += usageCostMicros(structureCall.usage, reservation.config);
    let candidate: unknown;
    let parseIssue: string | null = null;
    try { candidate = parseJsonOutput(structureCall.text); } catch { candidate = null; parseIssue = "structure_json_invalid"; }
    let validation = parseIssue ? { result: null, issues: [parseIssue] } : validateCandidate(candidate, body.durationMs, auditCuts);
    if (!validation.result) {
      console.warn("Bailian result validation failed; repairing", validation.issues);
      const repairCall = await callBailian(runtime.DASHSCOPE_API_KEY, baseUrl, structureModel, structurePrompt(evidenceCall.text, body.durationMs, auditCuts, validation.issues, structureCall.text), reservation.config.maxOutputTokens, undefined, true, 180_000);
      actualCostMicros += usageCostMicros(repairCall.usage, reservation.config);
      parseIssue = null;
      try { candidate = parseJsonOutput(repairCall.text); } catch { candidate = null; parseIssue = "repair_json_invalid"; }
      validation = parseIssue ? { result: null, issues: [parseIssue] } : validateCandidate(candidate, body.durationMs, auditCuts);
    }
    if (!validation.result) { failureStage = validation.issues.join(",") || "result_invalid"; throw new Error(failureStage); }
    result = validation.result;
    result.provenance = { ...result.provenance, model: `${model} → ${structureModel}`, localCutCount: localCuts.filter((cut) => cut > 0 && cut < body.durationMs!).length, note: `${result.provenance.note}; provider=aliyun-bailian; raw-evidence=omni; structuring=qwen-plus; audit-cuts=${auditCuts.length - 2}` };
  } catch (error) {
    if (failureStage === "unknown") failureStage = error instanceof Error ? error.message.slice(0, 160) : "unknown";
    console.warn("Bailian analysis stopped safely", failureStage);
    analysisFailed = true;
    actualCostMicros = reservation.reservedMicros;
  }
  const budgetSettled = await settleAnalysisBudget(runtime, reservation.id, actualCostMicros).catch(() => false);
  const cleaned = await deleteOssObject(runtime, body.objectKey);
  if (analysisFailed || !result) {
    const diagnosticCode = /^[a-z0-9_.:,\-+]+$/i.test(failureStage) ? failureStage.slice(0, 240) : "analysis_provider_error";
    return Response.json({
      error: cleaned
        ? "模型没有返回结构完整的分析。临时视频已清理，请重试或使用内置样片。"
        : "分析失败且 OSS 临时视频清理失败。请联系管理员检查对象存储后再重试。",
      diagnosticCode,
    }, { status: 502, headers: { "cache-control": "no-store" } });
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
