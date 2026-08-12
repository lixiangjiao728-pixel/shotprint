import type { ShotprintStateStore } from "./state-store";

export interface ShotprintEnv {
  DB?: D1Database;
  STATE_STORE?: ShotprintStateStore;
  DASHSCOPE_API_KEY?: string;
  DASHSCOPE_BASE_URL?: string;
  DASHSCOPE_MODEL?: string;
  DASHSCOPE_SEARCH_MODEL?: string;
  OSS_ACCESS_KEY_ID?: string;
  OSS_ACCESS_KEY_SECRET?: string;
  OSS_BUCKET?: string;
  OSS_ENDPOINT?: string;
  OSS_UPLOAD_PREFIX?: string;
  RATE_LIMIT_SALT?: string;
  DAILY_IP_LIMIT?: string;
  RESEARCH_DAILY_IP_LIMIT?: string;
  DAILY_GLOBAL_LIMIT?: string;
  MAX_VIDEO_BYTES?: string;
  MAX_VIDEO_DURATION?: string;
  COST_LIMIT_CNY?: string;
  COST_INPUT_CNY_PER_MILLION?: string;
  COST_OUTPUT_CNY_PER_MILLION?: string;
  COST_MAX_INPUT_TOKENS?: string;
  COST_MAX_OUTPUT_TOKENS?: string;
  COST_FIXED_CNY_PER_ANALYSIS?: string;
  SEARCH_API_URL?: string;
  SEARCH_API_KEY?: string;
  SEARCH_PROVIDER?: string;
  SHOTPRINT_API_BASE?: string;
  ALLOWED_ORIGINS?: string;
}

export async function getEnv(): Promise<ShotprintEnv> {
  const injected = (globalThis as typeof globalThis & { __SHOTPRINT_RUNTIME_ENV__?: ShotprintEnv }).__SHOTPRINT_RUNTIME_ENV__;
  if (injected) return injected;
  try {
    const cloudflare = await import("cloudflare:workers");
    return cloudflare.env as unknown as ShotprintEnv;
  } catch {
    return process.env as unknown as ShotprintEnv;
  }
}

export function jsonError(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function hashIp(request: Request, salt: string) {
  const rawIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const bytes = new TextEncoder().encode(`${salt}:${rawIp}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

type RateLimitLease = { ipKey: string; globalKey: string; day: string };
type PortableUsage = { day: string; counts: Record<string, number>; updatedAt: string };
const PORTABLE_USAGE_KEY = "rate/daily-usage.json";

export async function consumeRateLimit(request: Request, runtime: ShotprintEnv, scope = "") {
  const day = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const safeScope = scope.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  const prefix = safeScope ? `${safeScope}:` : "";
  const ipKey = `${prefix}ip:${await hashIp(request, runtime.RATE_LIMIT_SALT || "shotprint-local")}`;
  const globalKey = `${prefix}global`;
  const ipLimit = Number(runtime.DAILY_IP_LIMIT || 3);
  const globalLimit = Number(runtime.DAILY_GLOBAL_LIMIT || 50);
  if (runtime.STATE_STORE) {
    let outcome: { ok: boolean; reason?: string; remaining: number; lease: RateLimitLease | null } = { ok: false, remaining: 0, lease: null };
    await runtime.STATE_STORE.updateJson<PortableUsage>(PORTABLE_USAGE_KEY, { day, counts: {}, updatedAt: now }, (raw) => {
      const current: PortableUsage = raw.day === day ? { day, counts: { ...(raw.counts || {}) }, updatedAt: now } : { day, counts: {}, updatedAt: now };
      const ipCount = Math.max(0, Number(current.counts[ipKey]) || 0);
      const globalCount = Math.max(0, Number(current.counts[globalKey]) || 0);
      if (ipCount >= ipLimit) { outcome = { ok: false, reason: `当前网络今天的 ${ipLimit} 次成功研究额度已用完。失败研究不会占用额度。`, remaining: 0, lease: null }; return current; }
      if (globalCount >= globalLimit) { outcome = { ok: false, reason: "今天的公共成功研究额度已用完。失败研究不会占用额度。", remaining: 0, lease: null }; return current; }
      current.counts[ipKey] = ipCount + 1;
      current.counts[globalKey] = globalCount + 1;
      outcome = { ok: true, remaining: ipLimit - ipCount - 1, lease: { ipKey, globalKey, day } };
      return current;
    });
    return outcome;
  }
  if (!runtime.DB) return { ok: true, remaining: ipLimit - 1, lease: null as RateLimitLease | null };
  await runtime.DB.prepare("CREATE TABLE IF NOT EXISTS daily_usage (key TEXT PRIMARY KEY, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)").run();
  const [ipRow, globalRow] = await Promise.all([
    runtime.DB.prepare("SELECT day, count FROM daily_usage WHERE key = ?").bind(ipKey).first<{ day: string; count: number }>(),
    runtime.DB.prepare("SELECT day, count FROM daily_usage WHERE key = ?").bind(globalKey).first<{ day: string; count: number }>(),
  ]);
  const ipCount = ipRow?.day === day ? ipRow.count : 0;
  const globalCount = globalRow?.day === day ? globalRow.count : 0;
  if (ipCount >= ipLimit) return { ok: false, reason: `当前网络今天的 ${ipLimit} 次成功研究额度已用完。失败研究不会占用额度。`, remaining: 0, lease: null };
  if (globalCount >= globalLimit) return { ok: false, reason: "今天的公共成功研究额度已用完。失败研究不会占用额度。", remaining: 0, lease: null };
  await runtime.DB.batch([
    runtime.DB.prepare("INSERT INTO daily_usage (key, day, count, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET day = excluded.day, count = CASE WHEN daily_usage.day = excluded.day THEN daily_usage.count + 1 ELSE 1 END, updated_at = excluded.updated_at").bind(ipKey, day, now),
    runtime.DB.prepare("INSERT INTO daily_usage (key, day, count, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET day = excluded.day, count = CASE WHEN daily_usage.day = excluded.day THEN daily_usage.count + 1 ELSE 1 END, updated_at = excluded.updated_at").bind(globalKey, day, now),
  ]);
  return { ok: true, remaining: ipLimit - ipCount - 1, lease: { ipKey, globalKey, day } satisfies RateLimitLease };
}

export async function releaseRateLimit(runtime: ShotprintEnv, lease: RateLimitLease | null | undefined) {
  if (!lease) return;
  const now = new Date().toISOString();
  if (runtime.STATE_STORE) {
    await runtime.STATE_STORE.updateJson<PortableUsage>(PORTABLE_USAGE_KEY, { day: lease.day, counts: {}, updatedAt: now }, (raw) => {
      if (raw.day !== lease.day) return raw;
      const current = { day: raw.day, counts: { ...(raw.counts || {}) }, updatedAt: now };
      current.counts[lease.ipKey] = Math.max(0, (Number(current.counts[lease.ipKey]) || 0) - 1);
      current.counts[lease.globalKey] = Math.max(0, (Number(current.counts[lease.globalKey]) || 0) - 1);
      return current;
    });
    return;
  }
  if (!runtime.DB) return;
  await runtime.DB.batch([
    runtime.DB.prepare("UPDATE daily_usage SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END, updated_at = ? WHERE key = ? AND day = ?").bind(now, lease.ipKey, lease.day),
    runtime.DB.prepare("UPDATE daily_usage SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END, updated_at = ? WHERE key = ? AND day = ?").bind(now, lease.globalKey, lease.day),
  ]);
}
