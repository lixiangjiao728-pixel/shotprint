import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import { costConfig, getBudgetStatus, reserveAnalysisBudget, settleAnalysisBudget, usageCostMicros } from "../lib/cost-budget.ts";
import type { ShotprintEnv } from "../lib/server.ts";

class SqliteStatementAdapter {
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

class SqliteD1Adapter {
  private database: DatabaseSync;
  constructor(database: DatabaseSync) { this.database = database; }
  prepare(query: string) { return new SqliteStatementAdapter(this.database.prepare(query)); }
  async batch<T>(statements: SqliteStatementAdapter[]) { return Promise.all(statements.map((statement) => statement.run<T>())); }
}

function runtime(): ShotprintEnv {
  const database = new DatabaseSync(":memory:");
  return {
    DB: new SqliteD1Adapter(database) as unknown as D1Database,
    COST_LIMIT_CNY: "10",
    COST_INPUT_CNY_PER_MILLION: "7",
    COST_OUTPUT_CNY_PER_MILLION: "40",
    COST_MAX_INPUT_TOKENS: "196608",
    COST_MAX_OUTPUT_TOKENS: "12000",
    COST_FIXED_CNY_PER_ANALYSIS: "0.2",
  };
}

test("usage pricing uses Beijing input and output rates and reserves missing usage", () => {
  const config = costConfig(runtime());
  assert.equal(usageCostMicros({ prompt_tokens: 100_000, completion_tokens: 10_000 }, config), 1_100_000);
  assert.equal(usageCostMicros(null, config), config.maxMicrosPerCall);
  assert.equal(config.reservationMicros, 3_912_512);
});

test("budget reservations reject concurrent work that could exceed CNY 10", async () => {
  const env = runtime();
  const first = await reserveAnalysisBudget(env);
  const second = await reserveAnalysisBudget(env);
  const blocked = await reserveAnalysisBudget(env);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(blocked.ok, false);
  if (!first.ok || !second.ok) throw new Error("expected reservations");

  await settleAnalysisBudget(env, first.id, 500_000);
  await settleAnalysisBudget(env, first.id, 900_000);
  const afterSettlement = await reserveAnalysisBudget(env);
  assert.equal(afterSettlement.ok, true);

  const row = await env.DB!.prepare("SELECT spent_micros, reserved_micros, limit_micros FROM cost_budget WHERE key = ?")
    .bind("shotprint-analysis").first<{ spent_micros: number; reserved_micros: number; limit_micros: number }>();
  assert.equal(row?.spent_micros, 500_000, "settlement is idempotent");
  assert.equal(row?.reserved_micros, second.reservedMicros + (afterSettlement.ok ? afterSettlement.reservedMicros : 0));
  assert.equal(row?.limit_micros, 10_000_000);
});

test("budget fails closed without a persistent D1 binding", async () => {
  const status = await getBudgetStatus({ COST_LIMIT_CNY: "10" });
  assert.equal(status.ok, false);
  if (!status.ok) assert.match(status.reason, /安全暂停|费用保护/);
});

test("settled spend at the CNY 10 cap stops all future analysis", async () => {
  const env = runtime();
  const reservation = await reserveAnalysisBudget(env);
  assert.equal(reservation.ok, true);
  if (!reservation.ok) throw new Error("expected reservation");
  await settleAnalysisBudget(env, reservation.id, 10_000_000);
  const status = await getBudgetStatus(env);
  assert.equal(status.ok, false);
  if (!status.ok) assert.match(status.reason, /10 元分析预算/);
});
