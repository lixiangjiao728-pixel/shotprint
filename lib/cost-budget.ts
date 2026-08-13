import type { ShotprintEnv } from "./server";

const BUDGET_KEY = "shotprint-analysis";
const MICROS_PER_CNY = 1_000_000;
const MAX_MODEL_CALLS_PER_ANALYSIS = 2;
const OSS_BUDGET_KEY = "budget/shotprint-analysis.json";

type PortableReservation = { reservedMicros: number; createdAt: string; settled: boolean; actualMicros?: number };
type PortableBudget = { spentMicros: number; limitMicros: number; reservations: Record<string, PortableReservation>; updatedAt: string };

export interface BailianUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    text_tokens?: number | null;
    image_tokens?: number | null;
    video_tokens?: number | null;
    audio_tokens?: number | null;
  } | null;
}

export interface CostConfig {
  limitMicros: number;
  inputCnyPerMillion: number;
  outputCnyPerMillion: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  fixedMicrosPerAnalysis: number;
  maxMicrosPerCall: number;
  reservationMicros: number;
  maxModelCalls: number;
}

export interface BudgetOptions {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxModelCalls?: number;
}

export interface BudgetReservation {
  ok: true;
  id: string;
  reservedMicros: number;
  config: CostConfig;
}

export interface BudgetRejection {
  ok: false;
  reason: string;
  limitMicros: number;
  spentMicros: number;
  reservedMicros: number;
}

function positiveNumber(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

export function costConfig(runtime: ShotprintEnv, options: BudgetOptions = {}): CostConfig {
  const limitCny = positiveNumber(runtime.COST_LIMIT_CNY, 20, "COST_LIMIT_CNY");
  const inputCnyPerMillion = positiveNumber(runtime.COST_INPUT_CNY_PER_MILLION, 7, "COST_INPUT_CNY_PER_MILLION");
  const outputCnyPerMillion = positiveNumber(runtime.COST_OUTPUT_CNY_PER_MILLION, 40, "COST_OUTPUT_CNY_PER_MILLION");
  const maxInputTokens = Math.floor(options.maxInputTokens ?? positiveNumber(runtime.COST_MAX_INPUT_TOKENS, 196608, "COST_MAX_INPUT_TOKENS"));
  const maxOutputTokens = Math.floor(options.maxOutputTokens ?? positiveNumber(runtime.COST_MAX_OUTPUT_TOKENS, 16000, "COST_MAX_OUTPUT_TOKENS"));
  const maxModelCalls = Math.max(1, Math.floor(options.maxModelCalls ?? MAX_MODEL_CALLS_PER_ANALYSIS));
  const fixedMicrosPerAnalysis = Math.ceil(positiveNumber(runtime.COST_FIXED_CNY_PER_ANALYSIS, 0.2, "COST_FIXED_CNY_PER_ANALYSIS") * MICROS_PER_CNY);
  const maxMicrosPerCall = Math.ceil(maxInputTokens * inputCnyPerMillion + maxOutputTokens * outputCnyPerMillion);
  return {
    limitMicros: Math.floor(limitCny * MICROS_PER_CNY),
    inputCnyPerMillion,
    outputCnyPerMillion,
    maxInputTokens,
    maxOutputTokens,
    fixedMicrosPerAnalysis,
    maxMicrosPerCall,
    reservationMicros: fixedMicrosPerAnalysis + maxMicrosPerCall * maxModelCalls,
    maxModelCalls,
  };
}

export function usageCostMicros(usage: BailianUsage | null | undefined, config: CostConfig) {
  const prompt = usage?.prompt_tokens ?? usage?.input_tokens;
  const completion = usage?.completion_tokens ?? usage?.output_tokens;
  if (!usage || !Number.isFinite(prompt) || !Number.isFinite(completion)) return config.maxMicrosPerCall;
  const promptTokens = Math.max(0, Math.floor(prompt || 0));
  const completionTokens = Math.max(0, Math.floor(completion || 0));
  return Math.ceil(promptTokens * config.inputCnyPerMillion + completionTokens * config.outputCnyPerMillion);
}

export function microsToCny(micros: number) {
  return Math.max(0, micros) / MICROS_PER_CNY;
}

function changed(result: D1Result<unknown>) {
  return Number(result.meta?.changes || 0) > 0;
}

function cleanPortableBudget(value: PortableBudget, config: CostConfig, now = Date.now()) {
  const reservations: Record<string, PortableReservation> = {};
  for (const [id, reservation] of Object.entries(value.reservations || {})) {
    if (reservation.settled) continue;
    if (now - Date.parse(reservation.createdAt) >= 30 * 60 * 1000) continue;
    reservations[id] = reservation;
  }
  return { spentMicros: Math.max(0, Number(value.spentMicros) || 0), limitMicros: config.limitMicros, reservations, updatedAt: new Date(now).toISOString() } satisfies PortableBudget;
}

function portableReserved(value: PortableBudget) {
  return Object.values(value.reservations || {}).reduce((sum, reservation) => sum + Math.max(0, Number(reservation.reservedMicros) || 0), 0);
}

async function portableBudget(runtime: ShotprintEnv, config: CostConfig) {
  if (!runtime.STATE_STORE) throw new Error("Cost budget state store is unavailable");
  const fallback: PortableBudget = { spentMicros: 0, limitMicros: config.limitMicros, reservations: {}, updatedAt: new Date().toISOString() };
  return runtime.STATE_STORE.updateJson(OSS_BUDGET_KEY, fallback, (current) => cleanPortableBudget(current, config));
}

async function ensureBudget(runtime: ShotprintEnv, config: CostConfig) {
  if (!runtime.DB) throw new Error("Cost budget database is unavailable");
  const now = new Date().toISOString();
  await runtime.DB.batch([
    runtime.DB.prepare("CREATE TABLE IF NOT EXISTS cost_budget (key TEXT PRIMARY KEY, spent_micros INTEGER NOT NULL DEFAULT 0, reserved_micros INTEGER NOT NULL DEFAULT 0, limit_micros INTEGER NOT NULL, updated_at TEXT NOT NULL)"),
    runtime.DB.prepare("CREATE TABLE IF NOT EXISTS cost_reservations (id TEXT PRIMARY KEY, budget_key TEXT NOT NULL, reserved_micros INTEGER NOT NULL, actual_micros INTEGER, settled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
  ]);
  await runtime.DB.prepare("INSERT INTO cost_budget (key, spent_micros, reserved_micros, limit_micros, updated_at) VALUES (?, 0, 0, ?, ?) ON CONFLICT(key) DO UPDATE SET limit_micros = excluded.limit_micros, updated_at = excluded.updated_at")
    .bind(BUDGET_KEY, config.limitMicros, now).run();
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const stale = await runtime.DB.prepare("SELECT COALESCE(SUM(reserved_micros), 0) AS total FROM cost_reservations WHERE budget_key = ? AND settled = 0 AND created_at < ?").bind(BUDGET_KEY, cutoff).first<{ total: number }>();
  const staleMicros = Math.max(0, Number(stale?.total || 0));
  if (staleMicros > 0) {
    await runtime.DB.batch([
      runtime.DB.prepare("UPDATE cost_reservations SET actual_micros = 0, settled = 1, updated_at = ? WHERE budget_key = ? AND settled = 0 AND created_at < ?").bind(now, BUDGET_KEY, cutoff),
      runtime.DB.prepare("UPDATE cost_budget SET reserved_micros = MAX(0, reserved_micros - ?), updated_at = ? WHERE key = ?").bind(staleMicros, now, BUDGET_KEY),
    ]);
  }
}

async function budgetRow(runtime: ShotprintEnv) {
  return runtime.DB!.prepare("SELECT spent_micros, reserved_micros, limit_micros FROM cost_budget WHERE key = ?")
    .bind(BUDGET_KEY).first<{ spent_micros: number; reserved_micros: number; limit_micros: number }>();
}

export async function getBudgetStatus(runtime: ShotprintEnv, options: BudgetOptions = {}): Promise<BudgetRejection | { ok: true; availableMicros: number; config: CostConfig }> {
  const config = costConfig(runtime, options);
  if (!runtime.DB && !runtime.STATE_STORE) return { ok: false, reason: "费用保护暂时不可用，真实分析已安全暂停；内置样片仍可使用。", limitMicros: config.limitMicros, spentMicros: 0, reservedMicros: 0 };
  if (runtime.STATE_STORE) {
    const row = await portableBudget(runtime, config);
    const spentMicros = row.spentMicros;
    const reservedMicros = portableReserved(row);
    const availableMicros = config.limitMicros - spentMicros - reservedMicros;
    if (availableMicros < config.reservationMicros) return { ok: false, reason: `本项目的 ${Math.round(config.limitMicros / MICROS_PER_CNY)} 元分析预算已用完，或余额不足以安全预留下一次分析。内置样片仍可使用。`, limitMicros: config.limitMicros, spentMicros, reservedMicros };
    return { ok: true, availableMicros, config };
  }
  await ensureBudget(runtime, config);
  const row = await budgetRow(runtime);
  const spentMicros = Number(row?.spent_micros || 0);
  const reservedMicros = Number(row?.reserved_micros || 0);
  const availableMicros = config.limitMicros - spentMicros - reservedMicros;
  if (availableMicros < config.reservationMicros) {
    return { ok: false, reason: `本项目的 ${Math.round(config.limitMicros / MICROS_PER_CNY)} 元分析预算已用完，或余额不足以安全预留下一次分析。内置样片仍可使用。`, limitMicros: config.limitMicros, spentMicros, reservedMicros };
  }
  return { ok: true, availableMicros, config };
}

export async function reserveAnalysisBudget(runtime: ShotprintEnv, options: BudgetOptions = {}): Promise<BudgetReservation | BudgetRejection> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  if (runtime.STATE_STORE) {
    const config = costConfig(runtime, options);
    let rejection: BudgetRejection | null = null;
    await runtime.STATE_STORE.updateJson<PortableBudget>(OSS_BUDGET_KEY, { spentMicros: 0, limitMicros: config.limitMicros, reservations: {}, updatedAt: now }, (raw) => {
      const current = cleanPortableBudget(raw, config);
      const reservedMicros = portableReserved(current);
      if (current.spentMicros + reservedMicros + config.reservationMicros > config.limitMicros) {
        rejection = { ok: false, reason: `本项目的 ${Math.round(config.limitMicros / MICROS_PER_CNY)} 元分析预算刚刚被其他请求预留。内置样片仍可使用。`, limitMicros: config.limitMicros, spentMicros: current.spentMicros, reservedMicros };
        return current;
      }
      current.reservations[id] = { reservedMicros: config.reservationMicros, createdAt: now, settled: false };
      current.updatedAt = now;
      return current;
    });
    if (rejection) return rejection;
    return { ok: true, id, reservedMicros: config.reservationMicros, config };
  }
  const status = await getBudgetStatus(runtime, options);
  if (!status.ok) return status;
  const update = await runtime.DB!.prepare("UPDATE cost_budget SET reserved_micros = reserved_micros + ?, updated_at = ? WHERE key = ? AND spent_micros + reserved_micros + ? <= limit_micros")
    .bind(status.config.reservationMicros, now, BUDGET_KEY, status.config.reservationMicros).run();
  if (!changed(update)) {
    const row = await budgetRow(runtime);
    return {
      ok: false,
      reason: `本项目的 ${Math.round(status.config.limitMicros / MICROS_PER_CNY)} 元分析预算刚刚被其他请求预留。内置样片仍可使用。`,
      limitMicros: status.config.limitMicros,
      spentMicros: Number(row?.spent_micros || 0),
      reservedMicros: Number(row?.reserved_micros || 0),
    };
  }
  try {
    await runtime.DB!.prepare("INSERT INTO cost_reservations (id, budget_key, reserved_micros, actual_micros, settled, created_at, updated_at) VALUES (?, ?, ?, NULL, 0, ?, ?)")
      .bind(id, BUDGET_KEY, status.config.reservationMicros, now, now).run();
  } catch (error) {
    await runtime.DB!.prepare("UPDATE cost_budget SET reserved_micros = MAX(0, reserved_micros - ?), updated_at = ? WHERE key = ?")
      .bind(status.config.reservationMicros, now, BUDGET_KEY).run();
    throw error;
  }
  return { ok: true, id, reservedMicros: status.config.reservationMicros, config: status.config };
}

export async function settleAnalysisBudget(runtime: ShotprintEnv, reservationId: string, actualMicros: number) {
  if (runtime.STATE_STORE) {
    const config = costConfig(runtime);
    let found = false;
    await runtime.STATE_STORE.updateJson<PortableBudget>(OSS_BUDGET_KEY, { spentMicros: 0, limitMicros: config.limitMicros, reservations: {}, updatedAt: new Date().toISOString() }, (raw) => {
      const current = cleanPortableBudget(raw, config);
      const reservation = current.reservations[reservationId];
      if (!reservation) return current;
      found = true;
      current.spentMicros += Math.min(reservation.reservedMicros, Math.max(0, Math.ceil(actualMicros)));
      delete current.reservations[reservationId];
      current.updatedAt = new Date().toISOString();
      return current;
    });
    return found;
  }
  if (!runtime.DB) return false;
  const reservation = await runtime.DB.prepare("SELECT reserved_micros, settled FROM cost_reservations WHERE id = ? AND budget_key = ?")
    .bind(reservationId, BUDGET_KEY).first<{ reserved_micros: number; settled: number }>();
  if (!reservation || reservation.settled) return true;
  const chargedMicros = Math.max(0, Math.ceil(actualMicros));
  const now = new Date().toISOString();
  const settled = await runtime.DB.prepare("UPDATE cost_reservations SET actual_micros = ?, settled = 1, updated_at = ? WHERE id = ? AND budget_key = ? AND settled = 0")
    .bind(chargedMicros, now, reservationId, BUDGET_KEY).run();
  if (!changed(settled)) return true;
  await runtime.DB.prepare("UPDATE cost_budget SET reserved_micros = MAX(0, reserved_micros - ?), spent_micros = spent_micros + ?, updated_at = ? WHERE key = ?")
    .bind(reservation.reserved_micros, chargedMicros, now, BUDGET_KEY).run();
  return true;
}
