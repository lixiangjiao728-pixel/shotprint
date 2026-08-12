import assert from "node:assert/strict";
import test from "node:test";
import { costConfig, usageCostMicros } from "../lib/cost-budget.ts";
import type { ShotprintEnv } from "../lib/server.ts";

test("search budget uses bounded native input/output reservation and usage aliases", () => {
  const runtime = {
    COST_LIMIT_CNY: "20",
    COST_INPUT_CNY_PER_MILLION: "7",
    COST_OUTPUT_CNY_PER_MILLION: "40",
    COST_FIXED_CNY_PER_ANALYSIS: "0.2",
    COST_MAX_INPUT_TOKENS: "196608",
    COST_MAX_OUTPUT_TOKENS: "12000",
  } as unknown as ShotprintEnv;
  const config = costConfig(runtime, { maxInputTokens: 8000, maxOutputTokens: 1200, maxModelCalls: 1 });
  assert.equal(config.maxInputTokens, 8000);
  assert.equal(config.maxOutputTokens, 1200);
  assert.equal(config.maxModelCalls, 1);
  assert.equal(config.reservationMicros, 200000 + 8000 * 7 + 1200 * 40);
  assert.equal(usageCostMicros({ input_tokens: 1000, output_tokens: 200 }, config), 1000 * 7 + 200 * 40);
});
