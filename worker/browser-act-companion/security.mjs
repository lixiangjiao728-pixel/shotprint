import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const HOST = "127.0.0.1";
export const PORT = 43129;
export const TOKEN_TTL_MS = 30 * 60 * 1000;
export const MAX_BODY_BYTES = 64 * 1024;
export const PLATFORMS = Object.freeze({
  bilibili: ["www.bilibili.com", "bilibili.com", "b23.tv"],
  douyin: ["www.douyin.com", "douyin.com", "v.douyin.com"],
  xiaohongshu: ["www.xiaohongshu.com", "xiaohongshu.com", "xhslink.com"],
});

export function classifyUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    for (const [platform, hosts] of Object.entries(PLATFORMS)) {
      if (hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
        url.username = "";
        url.password = "";
        url.hash = "";
        return { platform, url: url.toString() };
      }
    }
  } catch { /* rejected below */ }
  return null;
}

export function videoKey(platform, value) {
  try {
    const url = new URL(String(value || ""));
    const path = url.pathname;
    if (platform === "bilibili") return path.match(/\/video\/(BV[\w]+)/i)?.[1]?.toUpperCase() || "";
    if (platform === "douyin") return path.match(/\/(?:video|share\/video)\/(\d+)/)?.[1] || "";
    if (platform === "xiaohongshu") return path.match(/\/(?:explore|search_result|discovery\/item)\/([a-f0-9]{16,})/i)?.[1]?.toLowerCase() || "";
  } catch { /* rejected below */ }
  return "";
}

export function sameVideoPage(platform, left, right) {
  const a = videoKey(platform, left);
  return Boolean(a && a === videoKey(platform, right));
}

export function shouldReusePage(platform, requested, current, previousRequested = "", previousResolvedKey = "") {
  if (sameVideoPage(platform, requested, current)) return true;
  const currentKey = videoKey(platform, current);
  return Boolean(previousRequested && previousRequested === requested && previousResolvedKey && currentKey === previousResolvedKey);
}

export function navigationReachedTarget(platform, requested, before, loaded, previousRequested = "", previousResolvedKey = "") {
  if (videoKey(platform, requested)) return sameVideoPage(platform, requested, loaded);
  const loadedKey = videoKey(platform, loaded);
  if (!loadedKey) return false;
  if (previousRequested === requested && previousResolvedKey) return loadedKey === previousResolvedKey;
  return loaded !== before;
}

export function allowExtensionOrigin(origin) {
  return typeof origin === "string" && /^chrome-extension:\/\/[a-p]{32}$/i.test(origin);
}

export function makePairingCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function makeSession() {
  const raw = randomBytes(32).toString("base64url");
  return { raw, digest: createHash("sha256").update(raw).digest(), expiresAt: Date.now() + TOKEN_TTL_MS };
}

export function tokenMatches(session, candidate) {
  if (!session || session.expiresAt <= Date.now() || typeof candidate !== "string") return false;
  const digest = createHash("sha256").update(candidate).digest();
  return digest.length === session.digest.length && timingSafeEqual(digest, session.digest);
}

export function sanitizeComments(raw, limit = 200) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).flatMap((item) => {
    if (seen.size >= Math.min(200, Math.max(1, limit))) return [];
    const text = String(item?.text || "").replace(/^回复\s+@[^:：]{1,80}[:：]\s*/i, "").replace(/@[\w\u4e00-\u9fff-]{1,40}/g, "@匿名用户").replace(/\s+/g, " ").trim().slice(0, 2000);
    if (text.length < 2) return [];
    const key = createHash("sha256").update(text).digest("hex");
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      id: `anon-${key.slice(0, 16)}`,
      text,
      ...(Number.isFinite(Number(item?.likes)) && Number(item.likes) >= 0 ? { likes: Math.floor(Number(item.likes)) } : {}),
      ...(typeof item?.timeLabel === "string" ? { timeLabel: item.timeLabel.slice(0, 32) } : {}),
      ...(item?.replyTo ? { replyTo: "匿名回复" } : {}),
      source: "extension",
    }];
  });
}
