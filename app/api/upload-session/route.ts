import { createObjectKey, createUploadToken, deleteOssObject, presignOssUrl, verifyUploadToken } from "../../../lib/aliyun";
import { getBudgetStatus } from "../../../lib/cost-budget";
import { consumeRateLimit, getEnv, jsonError, releaseRateLimit } from "../../../lib/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const runtime = await getEnv();
  if (!runtime.DASHSCOPE_API_KEY || !runtime.OSS_ACCESS_KEY_ID || !runtime.OSS_ACCESS_KEY_SECRET || !runtime.OSS_BUCKET || !runtime.OSS_ENDPOINT || !runtime.RATE_LIMIT_SALT) {
    return jsonError("当前部署还没有配置百炼与 OSS。你仍可打开内置样片体验完整流程。", 503);
  }
  let body: { fileName?: string; mimeType?: string; size?: number; durationMs?: number; consent?: boolean };
  try { body = await request.json(); } catch { return jsonError("上传参数不是有效 JSON。", 400); }
  const allowed = ["video/mp4", "video/quicktime", "video/webm"];
  const configuredMaxBytes = Number(runtime.MAX_VIDEO_BYTES || 314572800);
  const configuredMaxDuration = Number(runtime.MAX_VIDEO_DURATION || 300) * 1000;
  const maxBytes = Number.isFinite(configuredMaxBytes) && configuredMaxBytes > 0 ? configuredMaxBytes : 314572800;
  const maxDuration = Number.isFinite(configuredMaxDuration) && configuredMaxDuration > 0 ? configuredMaxDuration : 300_000;
  if (!body.consent) return jsonError("请先确认你拥有素材的分析权利。", 400);
  if (!body.fileName || !body.mimeType || !allowed.includes(body.mimeType)) return jsonError("仅支持 MP4、MOV、WebM。", 415);
  if (typeof body.size !== "number" || !Number.isSafeInteger(body.size) || body.size <= 0 || body.size > maxBytes) return jsonError("视频大小无效或超过当前 300MB 上限。", 413);
  if (typeof body.durationMs !== "number" || !Number.isFinite(body.durationMs) || body.durationMs <= 0 || body.durationMs > maxDuration) return jsonError("视频时长无效或超过当前 300 秒上限。", 413);
  try {
    const budget = await getBudgetStatus(runtime);
    if (!budget.ok) return jsonError(budget.reason, 402);
  } catch {
    return jsonError("费用保护暂时无法确认余额，真实分析已安全暂停；内置样片仍可使用。", 503);
  }
  const limit = await consumeRateLimit(request, runtime);
  if (!limit.ok) return jsonError(limit.reason || "今日试用额度已用完。", 429);
  try {
    const objectKey = createObjectKey(body.mimeType, runtime.OSS_UPLOAD_PREFIX);
    const expires = Date.now() + 15 * 60 * 1000;
    const [uploadUrl, uploadToken] = await Promise.all([
      presignOssUrl(runtime, "PUT", objectKey, { contentType: body.mimeType, ttlSeconds: 900 }),
      createUploadToken(runtime, { objectKey, mimeType: body.mimeType, size: body.size, durationMs: body.durationMs, expires }),
    ]);
    return Response.json({
      uploadUrl,
      uploadToken,
      objectKey,
      uploadHeaders: { "Content-Type": body.mimeType },
      remaining: limit.remaining,
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    await releaseRateLimit(runtime, limit.lease);
    return jsonError("无法创建 OSS 临时上传地址，请检查服务端配置后重试。", 502);
  }
}

export async function DELETE(request: Request) {
  const runtime = await getEnv();
  let body: { objectKey?: string; uploadToken?: string };
  try { body = await request.json(); } catch { return jsonError("清理参数不是有效 JSON。", 400); }
  if (!body.objectKey || !body.uploadToken) return jsonError("缺少临时视频清理凭证。", 400);
  const claims = await verifyUploadToken(runtime, body.uploadToken);
  if (!claims || claims.objectKey !== body.objectKey) return jsonError("临时视频清理凭证无效或已过期。", 400);
  const cleaned = await deleteOssObject(runtime, body.objectKey);
  return cleaned ? Response.json({ cleaned: true }, { headers: { "cache-control": "no-store" } }) : jsonError("OSS 临时视频清理失败，请联系管理员。", 502);
}
