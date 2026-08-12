import type { ShotprintEnv } from "../../lib/server";
import type { ShotprintStateStore } from "../../lib/state-store";

const encoder = new TextEncoder();

function requireOss(runtime: ShotprintEnv) {
  const accessKeyId = runtime.OSS_ACCESS_KEY_ID?.trim();
  const accessKeySecret = runtime.OSS_ACCESS_KEY_SECRET?.trim();
  const bucket = runtime.OSS_BUCKET?.trim();
  const endpoint = runtime.OSS_ENDPOINT?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!accessKeyId || !accessKeySecret || !bucket || !endpoint) throw new Error("OSS_STATE_NOT_CONFIGURED");
  return { accessKeyId, accessKeySecret, bucket, endpoint };
}

function base64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

async function sign(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return base64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

function safeKey(prefix: string, key: string) {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9/_-]/g, "").replace(/^\/+|\/+$/g, "") || "shotprint-state";
  const cleanKey = key.replace(/[^a-zA-Z0-9/_.-]/g, "").replace(/^\/+/, "");
  if (!cleanKey || cleanKey.includes("..")) throw new Error("OSS_STATE_KEY_INVALID");
  return `${cleanPrefix}/${cleanKey}`;
}

export class OssStateStore implements ShotprintStateStore {
  private readonly prefix: string;
  private readonly lockKey: string;

  constructor(private readonly runtime: ShotprintEnv) {
    this.prefix = process.env.OSS_STATE_PREFIX || "shotprint-state";
    this.lockKey = safeKey(this.prefix, "locks/global.json");
  }

  private async request(method: "GET" | "PUT" | "DELETE", objectKey: string, body?: string, extraHeaders: Record<string, string> = {}) {
    const { accessKeyId, accessKeySecret, bucket, endpoint } = requireOss(this.runtime);
    const date = new Date().toUTCString();
    const contentType = body === undefined ? "" : "application/json";
    const ossHeaders = Object.entries(extraHeaders)
      .filter(([name]) => name.toLowerCase().startsWith("x-oss-"))
      .map(([name, value]) => [name.toLowerCase().trim(), value.trim()] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    const canonicalHeaders = ossHeaders.map(([name, value]) => `${name}:${value}\n`).join("");
    const stringToSign = `${method}\n\n${contentType}\n${date}\n${canonicalHeaders}/${bucket}/${objectKey}`;
    const authorization = `OSS ${accessKeyId}:${await sign(accessKeySecret, stringToSign)}`;
    const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
    return fetch(`https://${bucket}.${endpoint}/${encodedKey}`, {
      method,
      headers: { Date: date, Authorization: authorization, ...(contentType ? { "Content-Type": contentType } : {}), ...extraHeaders },
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(10_000),
    });
  }

  async getJson<T>(key: string): Promise<T | null> {
    const response = await this.request("GET", safeKey(this.prefix, key));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`OSS_STATE_GET_${response.status}`);
    return await response.json() as T;
  }

  async putJson(key: string, value: unknown): Promise<void> {
    const response = await this.request("PUT", safeKey(this.prefix, key), JSON.stringify(value));
    if (!response.ok) throw new Error(`OSS_STATE_PUT_${response.status}`);
  }

  async delete(key: string): Promise<void> {
    const response = await this.request("DELETE", safeKey(this.prefix, key));
    if (!response.ok && response.status !== 404) throw new Error(`OSS_STATE_DELETE_${response.status}`);
  }

  private async acquireLock() {
    const token = crypto.randomUUID();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const expiresAt = Date.now() + 30_000;
      const response = await this.request("PUT", this.lockKey, JSON.stringify({ token, expiresAt }), { "x-oss-forbid-overwrite": "true" });
      if (response.ok) return token;
      if (response.status !== 409) throw new Error(`OSS_STATE_LOCK_${response.status}`);
      try {
        const existing = await this.request("GET", this.lockKey);
        if (existing.ok) {
          const value = await existing.json() as { expiresAt?: number };
          if (Number(value.expiresAt) < Date.now()) await this.request("DELETE", this.lockKey);
        }
      } catch { /* bounded retry below */ }
      await new Promise((resolve) => setTimeout(resolve, 80 + attempt * 12));
    }
    throw new Error("OSS_STATE_LOCK_TIMEOUT");
  }

  private async releaseLock(token: string) {
    try {
      const existing = await this.request("GET", this.lockKey);
      if (!existing.ok) return;
      const value = await existing.json() as { token?: string };
      if (value.token === token) await this.request("DELETE", this.lockKey);
    } catch { /* a 30-second stale lock is recoverable */ }
  }

  async updateJson<T>(key: string, fallback: T, mutate: (current: T) => T | Promise<T>): Promise<T> {
    const token = await this.acquireLock();
    try {
      const current = await this.getJson<T>(key) ?? fallback;
      const next = await mutate(current);
      await this.putJson(key, next);
      return next;
    } finally {
      await this.releaseLock(token);
    }
  }
}

