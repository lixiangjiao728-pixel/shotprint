import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import { consumeRateLimit, releaseRateLimit, type ShotprintEnv } from "../lib/server.ts";

class StatementAdapter {
  private values: SQLInputValue[] = [];
  private statement: ReturnType<DatabaseSync["prepare"]>;
  constructor(statement: ReturnType<DatabaseSync["prepare"]>) { this.statement = statement; }
  bind(...values: unknown[]) { this.values = values as SQLInputValue[]; return this; }
  async first<T>() { return (this.statement.get(...this.values) as T | undefined) ?? null; }
  async run<T>() {
    const result = this.statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } } as D1Result<T>;
  }
}

class D1Adapter {
  private database: DatabaseSync;
  constructor(database = new DatabaseSync(":memory:")) { this.database = database; }
  prepare(query: string) { return new StatementAdapter(this.database.prepare(query)); }
  async batch<T>(statements: StatementAdapter[]) { return Promise.all(statements.map((statement) => statement.run<T>())); }
}

function runtime(): ShotprintEnv {
  return { DB: new D1Adapter() as unknown as D1Database, DAILY_IP_LIMIT: "1", DAILY_GLOBAL_LIMIT: "2", RATE_LIMIT_SALT: "test-salt" };
}

function request() {
  return new Request("https://shotprint.example/api/link-research", { headers: { "cf-connecting-ip": "203.0.113.10" } });
}

test("failed research releases its scoped daily quota", async () => {
  const env = runtime();
  const first = await consumeRateLimit(request(), env, "link-research-v2");
  assert.equal(first.ok, true);
  const blocked = await consumeRateLimit(request(), env, "link-research-v2");
  assert.equal(blocked.ok, false);
  await releaseRateLimit(env, first.lease);
  const retry = await consumeRateLimit(request(), env, "link-research-v2");
  assert.equal(retry.ok, true);
});

test("successful research retains quota and a new scope starts clean", async () => {
  const env = runtime();
  const success = await consumeRateLimit(request(), env, "link-research-v1");
  assert.equal(success.ok, true);
  const blocked = await consumeRateLimit(request(), env, "link-research-v1");
  assert.equal(blocked.ok, false);
  const migrated = await consumeRateLimit(request(), env, "link-research-v2");
  assert.equal(migrated.ok, true);
});
