import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { reserveAnalysisBudget, settleAnalysisBudget } from "../lib/cost-budget.ts";
import { consumeRateLimit, releaseRateLimit, type ShotprintEnv } from "../lib/server.ts";
import { createResearchSession, readResearchSession } from "../lib/research-session.ts";
import type { ShotprintStateStore } from "../lib/state-store.ts";

class MemoryStore implements ShotprintStateStore {
  values = new Map<string, unknown>();
  async getJson<T>(key: string) { return (this.values.get(key) as T | undefined) ?? null; }
  async putJson(key: string, value: unknown) { this.values.set(key, structuredClone(value)); }
  async delete(key: string) { this.values.delete(key); }
  async updateJson<T>(key: string, fallback: T, mutate: (current: T) => T | Promise<T>) {
    const current = (this.values.get(key) as T | undefined) ?? structuredClone(fallback);
    const next = await mutate(structuredClone(current));
    this.values.set(key, structuredClone(next));
    return next;
  }
}

function runtime(store = new MemoryStore()): ShotprintEnv {
  return { STATE_STORE: store, COST_LIMIT_CNY: "20", COST_FIXED_CNY_PER_ANALYSIS: "0.2", COST_INPUT_CNY_PER_MILLION: "7", COST_OUTPUT_CNY_PER_MILLION: "40", RATE_LIMIT_SALT: "test-only", DAILY_IP_LIMIT: "2", DAILY_GLOBAL_LIMIT: "4" };
}

test("portable OSS budget reserves and settles without D1", async () => {
  const env = runtime();
  const reservation = await reserveAnalysisBudget(env, { maxInputTokens: 100, maxOutputTokens: 100, maxModelCalls: 1 });
  assert.equal(reservation.ok, true);
  if (!reservation.ok) return;
  assert.equal(await settleAnalysisBudget(env, reservation.id, 1234), true);
  const stored = await env.STATE_STORE!.getJson<{ spentMicros: number; reservations: Record<string, unknown> }>("budget/shotprint-analysis.json");
  assert.equal(stored?.spentMicros, 1234);
  assert.deepEqual(stored?.reservations, {});
});

test("portable rate lease is released after failure", async () => {
  const env = runtime();
  const request = new Request("https://backend.example/api/link-research", { headers: { "x-forwarded-for": "203.0.113.12" } });
  const first = await consumeRateLimit(request, env, "link-research-v2");
  assert.equal(first.ok, true);
  await releaseRateLimit(env, first.lease);
  const retry = await consumeRateLimit(request, env, "link-research-v2");
  assert.equal(retry.ok, true);
  assert.equal(retry.remaining, 1);
});

test("portable research session stores only safe payload and expires", async () => {
  const env = runtime();
  const now = Date.now();
  const bundle = { queries: [], memos: [], sources: [{ id: "SRC-01", title: "来源", url: "https://example.com/source", publishedAt: "unknown", retrievedAt: new Date(now).toISOString(), queryIds: ["q1"], relevance: 0.8, snippet: "仅用于创建安全会话，存储时必须删除" }], retrievedAt: new Date(now).toISOString() };
  const socialContext = { timeline: [], socialDrivers: [], audienceConsensus: [], controversies: [], externalFactors: [], unknowns: [] };
  const receipt = { status: "complete" as const, queryCount: 8, sourceCount: 8, domainCount: 3, costCny: 0.1, retrievedAt: new Date(now).toISOString(), originalCommentCount: 100, commentEvidenceCount: 20 };
  const session = await createResearchSession(env, bundle, socialContext, receipt, now);
  assert.ok(await readResearchSession(env, session.researchSessionId, now + 1000));
  assert.equal(await readResearchSession(env, session.researchSessionId, now + 61 * 60 * 1000), null);
  const serialized = JSON.stringify([...((env.STATE_STORE as MemoryStore).values.values())]);
  assert.doesNotMatch(serialized, /comments|pageText|video|raw/i);
});

test("frontend routes paid calls through the configured Aliyun base", async () => {
  const source = await readFile(new URL("../app/ShotprintStudio.tsx", import.meta.url), "utf8");
  for (const path of ["/api/link-research", "/api/link-analyze", "/api/upload-session", "/api/analyze"]) assert.match(source, new RegExp(`apiUrl\\(\\"${path}`));
  assert.match(source, /阿里云分析后端正常/);
  const backend = await readFile(new URL("../worker/aliyun-backend/server.ts", import.meta.url), "utf8");
  assert.match(backend, /ORIGIN_NOT_ALLOWED/);
  assert.match(backend, /shotprint-ai-film\.lixiangjia27\.chatgpt\.site/);
  assert.match(backend, /const runtime = \{ \.\.\.process\.env \}/);
  assert.doesNotMatch(backend, /const runtime = process\.env/);
});
