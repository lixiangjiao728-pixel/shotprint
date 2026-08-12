import type { ShotprintEnv } from "./server";

const encoder = new TextEncoder();

export interface UploadClaims {
  objectKey: string;
  mimeType: string;
  size: number;
  durationMs: number;
  expires: number;
}

export function normalizeBailianBaseUrl(value?: string) {
  const configured = value?.trim() || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const withScheme = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
  const url = new URL(withScheme);
  if (url.protocol !== "https:") throw new Error("Bailian API host must use HTTPS");
  if (!url.hostname.endsWith(".aliyuncs.com") && url.hostname !== "dashscope.aliyuncs.com") {
    throw new Error("Bailian API host is invalid");
  }
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = !path || path === "/" ? "/compatible-mode/v1" : path;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function normalizeBailianNativeBaseUrl(value?: string) {
  const configured = value?.trim() || "https://dashscope.aliyuncs.com";
  const withScheme = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
  const url = new URL(withScheme);
  if (url.protocol !== "https:") throw new Error("Bailian API host must use HTTPS");
  if (!url.hostname.endsWith(".aliyuncs.com") && url.hostname !== "dashscope.aliyuncs.com") {
    throw new Error("Bailian API host is invalid");
  }
  url.pathname = "/api/v1";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(secret: string, value: string, hash: "SHA-1" | "SHA-256") {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function requireOss(runtime: ShotprintEnv) {
  const accessKeyId = runtime.OSS_ACCESS_KEY_ID?.trim();
  const accessKeySecret = runtime.OSS_ACCESS_KEY_SECRET?.trim();
  const bucket = runtime.OSS_BUCKET?.trim();
  const endpoint = runtime.OSS_ENDPOINT?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!accessKeyId || !accessKeySecret || !bucket || !endpoint) throw new Error("OSS is not configured");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("OSS bucket is invalid");
  if (!/^[a-z0-9.-]+$/.test(endpoint)) throw new Error("OSS endpoint is invalid");
  return { accessKeyId, accessKeySecret, bucket, endpoint };
}

export function createObjectKey(mimeType: string, prefix = "shotprint-temp") {
  const extension = mimeType === "video/quicktime" ? "mov" : mimeType === "video/webm" ? "webm" : "mp4";
  const safePrefix = prefix.replace(/[^a-zA-Z0-9/_-]/g, "").replace(/^\/+|\/+$/g, "") || "shotprint-temp";
  return `${safePrefix}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
}

export async function presignOssUrl(runtime: ShotprintEnv, method: "GET" | "PUT" | "DELETE" | "HEAD", objectKey: string, options: { contentType?: string; ttlSeconds?: number; nowSeconds?: number } = {}) {
  const { accessKeyId, accessKeySecret, bucket, endpoint } = requireOss(runtime);
  if (!/^[a-zA-Z0-9/_.-]+$/.test(objectKey) || objectKey.includes("..")) throw new Error("OSS object key is invalid");
  const contentType = options.contentType || "";
  const expires = Math.floor(options.nowSeconds ?? Date.now() / 1000) + (options.ttlSeconds || 900);
  const canonicalResource = `/${bucket}/${objectKey}`;
  const stringToSign = `${method}\n\n${contentType}\n${expires}\n${canonicalResource}`;
  const signature = bytesToBase64(await hmac(accessKeySecret, stringToSign, "SHA-1"));
  const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
  const query = new URLSearchParams({ OSSAccessKeyId: accessKeyId, Expires: String(expires), Signature: signature });
  return `https://${bucket}.${endpoint}/${encodedKey}?${query}`;
}

export async function createUploadToken(runtime: ShotprintEnv, claims: UploadClaims) {
  const secret = runtime.RATE_LIMIT_SALT?.trim();
  if (!secret) throw new Error("Upload token secret is not configured");
  const payload = base64Url(encoder.encode(JSON.stringify(claims)));
  const signature = base64Url(await hmac(secret, payload, "SHA-256"));
  return `${payload}.${signature}`;
}

export async function verifyUploadToken(runtime: ShotprintEnv, token: string): Promise<UploadClaims | null> {
  const secret = runtime.RATE_LIMIT_SALT?.trim();
  const [payload, signature] = token.split(".");
  if (!secret || !payload || !signature) return null;
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, decodeBase64Url(signature), encoder.encode(payload));
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as UploadClaims;
    if (!claims.objectKey || !claims.mimeType || !Number.isFinite(claims.size) || claims.size <= 0 || !Number.isFinite(claims.durationMs) || claims.durationMs <= 0 || claims.expires < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function inspectOssObject(runtime: ShotprintEnv, objectKey: string) {
  const url = await presignOssUrl(runtime, "HEAD", objectKey, { ttlSeconds: 120 });
  const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`OSS object inspection failed: ${response.status}`);
  const size = Number(response.headers.get("content-length"));
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() || "";
  if (!Number.isSafeInteger(size) || size <= 0 || !mimeType) throw new Error("OSS object metadata is invalid");
  return { size, mimeType };
}

export async function deleteOssObject(runtime: ShotprintEnv, objectKey: string) {
  try {
    const url = await presignOssUrl(runtime, "DELETE", objectKey, { ttlSeconds: 120 });
    const response = await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(10_000) });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}
