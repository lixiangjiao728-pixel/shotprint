const ENDPOINTS = Object.freeze({
  bilibili: { hosts: new Set(["api.bilibili.com"]), path: /^\/x\/v2\/reply\/wbi\/main\/?$/ },
  douyin: { hosts: new Set(["www.douyin.com", "www-hj.douyin.com"]), path: /^\/aweme\/v1\/web\/comment\/(?:list|list\/reply)\/?$/ },
  xiaohongshu: { hosts: new Set(["edith.xiaohongshu.com"]), path: /^\/api\/sns\/web\/v\d+\/comment\/(?:page|sub\/page)\/?$/ },
});

function safeDate(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  const millis = number < 10_000_000_000 ? number * 1000 : number;
  const date = new Date(millis);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString().slice(0, 10);
}

export function isCommentEndpoint(platform, value) {
  const expected = ENDPOINTS[platform];
  if (!expected) return false;
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && expected.hosts.has(url.hostname) && expected.path.test(url.pathname);
  } catch {
    return false;
  }
}

export function observedRequestIds(platform, payload, limit = 30) {
  const requests = Array.isArray(payload?.requests) ? payload.requests : [];
  const seen = new Set();
  return requests.flatMap((item) => {
    const id = String(item?.request_id || "");
    if (!id || seen.has(id) || String(item?.method || "").toUpperCase() !== "GET" || Number(item?.status) !== 200 || !isCommentEndpoint(platform, item?.url)) return [];
    seen.add(id);
    return [id];
  }).slice(0, Math.max(1, Math.min(30, limit)));
}

function pushXhs(target, comment, replyTo = false) {
  if (!comment || typeof comment !== "object") return;
  target.push({
    text: comment.content,
    likes: comment.like_count,
    timeLabel: safeDate(comment.create_time),
    replyTo: replyTo || Boolean(comment.target_comment || comment.parent_comment_id),
  });
  for (const reply of Array.isArray(comment.sub_comments) ? comment.sub_comments : []) pushXhs(target, reply, true);
}

function pushDouyin(target, comment, replyTo = false) {
  if (!comment || typeof comment !== "object") return;
  target.push({
    text: comment.text,
    likes: comment.digg_count,
    timeLabel: safeDate(comment.create_time),
    replyTo: replyTo || Boolean(comment.reply_id && String(comment.reply_id) !== "0"),
  });
  for (const reply of Array.isArray(comment.reply_comment) ? comment.reply_comment : []) pushDouyin(target, reply, true);
}

function pushBilibili(target, comment, replyTo = false) {
  if (!comment || typeof comment !== "object") return;
  target.push({
    text: comment.content?.message,
    likes: comment.like,
    timeLabel: safeDate(comment.ctime),
    replyTo: replyTo || Boolean(comment.parent && String(comment.parent) !== "0"),
  });
  for (const reply of Array.isArray(comment.replies) ? comment.replies : []) pushBilibili(target, reply, true);
}

export function parseCapturedResponse(platform, detail) {
  if (String(detail?.method || "").toUpperCase() !== "GET" || Number(detail?.status) !== 200 || !isCommentEndpoint(platform, detail?.url)) return null;
  let body;
  try { body = typeof detail?.response_body === "string" ? JSON.parse(detail.response_body) : detail?.response_body; }
  catch { return null; }
  if (!body || typeof body !== "object") return null;
  const comments = [];
  if (platform === "xiaohongshu") for (const item of Array.isArray(body?.data?.comments) ? body.data.comments : []) pushXhs(comments, item);
  if (platform === "douyin") for (const item of Array.isArray(body?.comments) ? body.comments : Array.isArray(body?.data?.comments) ? body.data.comments : []) pushDouyin(comments, item);
  if (platform === "bilibili") for (const item of Array.isArray(body?.data?.replies) ? body.data.replies : []) pushBilibili(comments, item);
  const dataCursor = body?.data?.cursor;
  const cursor = body?.cursor ?? (dataCursor && typeof dataCursor === "object" ? dataCursor.next : dataCursor) ?? "";
  const hasMore = Boolean(body?.has_more ?? body?.data?.has_more ?? body?.data?.cursor?.is_end === false);
  return { comments, cursor: String(cursor || "").slice(0, 80), hasMore };
}
