import type { ResearchBundle, ResearchReceipt, ResearchSource, SocialContext } from "./link-research";
import type { ShotprintEnv } from "./server";

export const RESEARCH_SESSION_TTL_MS = 60 * 60 * 1000;

export type StoredResearchSession = {
  sources: Array<Pick<ResearchSource, "id" | "title" | "url" | "publishedAt" | "retrievedAt" | "queryIds" | "relevance">>;
  socialContext: SocialContext;
  receipt: ResearchReceipt;
};

const SESSION_TABLE_SQL = `CREATE TABLE IF NOT EXISTS research_sessions (
  id_hash TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
)`;

export function safeSessionPayload(bundle: ResearchBundle, socialContext: SocialContext, receipt: ResearchReceipt): StoredResearchSession {
  return {
    sources: bundle.sources.slice(0, 20).map((source) => ({
      id: source.id,
      title: source.title.slice(0, 200),
      url: source.url,
      publishedAt: source.publishedAt.slice(0, 64),
      retrievedAt: source.retrievedAt,
      queryIds: source.queryIds.slice(0, 8),
      relevance: Math.max(0, Math.min(1, source.relevance)),
    })),
    socialContext,
    receipt,
  };
}

async function hashSessionId(sessionId: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionId));
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function ensureResearchSessions(runtime: ShotprintEnv) {
  if (!runtime.DB) throw new Error("RESEARCH_SESSION_UNAVAILABLE");
  await runtime.DB.batch([
    runtime.DB.prepare(SESSION_TABLE_SQL),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS idx_research_sessions_expires_at ON research_sessions(expires_at)"),
  ]);
  await runtime.DB.prepare("DELETE FROM research_sessions WHERE expires_at <= ?").bind(new Date().toISOString()).run();
}

function portableSessionKey(idHash: string) {
  return `sessions/${idHash}.json`;
}

export async function createResearchSession(runtime: ShotprintEnv, bundle: ResearchBundle, socialContext: SocialContext, receipt: ResearchReceipt, now = Date.now()) {
  const sessionId = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll("-", "")}`;
  const idHash = await hashSessionId(sessionId);
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + RESEARCH_SESSION_TTL_MS).toISOString();
  const payload = JSON.stringify(safeSessionPayload(bundle, socialContext, receipt));
  if (runtime.STATE_STORE) {
    await runtime.STATE_STORE.putJson(portableSessionKey(idHash), { payload: JSON.parse(payload) as StoredResearchSession, expiresAt, createdAt });
    return { researchSessionId: sessionId, expiresAt };
  }
  await ensureResearchSessions(runtime);
  await runtime.DB!.prepare("INSERT INTO research_sessions (id_hash, payload_json, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(idHash, payload, expiresAt, createdAt).run();
  return { researchSessionId: sessionId, expiresAt };
}

export async function readResearchSession(runtime: ShotprintEnv, sessionId: string, now = Date.now()): Promise<StoredResearchSession | null> {
  if (!/^[0-9a-f-]{60,100}$/i.test(sessionId)) return null;
  const idHash = await hashSessionId(sessionId);
  if (runtime.STATE_STORE) {
    const stored = await runtime.STATE_STORE.getJson<{ payload?: StoredResearchSession; expiresAt?: string }>(portableSessionKey(idHash));
    if (!stored?.payload || !stored.expiresAt || Date.parse(stored.expiresAt) <= now) {
      if (stored) await runtime.STATE_STORE.delete(portableSessionKey(idHash));
      return null;
    }
    return stored.payload;
  }
  if (!runtime.DB) return null;
  await ensureResearchSessions(runtime);
  const row = await runtime.DB.prepare("SELECT payload_json, expires_at FROM research_sessions WHERE id_hash = ?")
    .bind(idHash).first<{ payload_json: string; expires_at: string }>();
  if (!row || Date.parse(row.expires_at) <= now) return null;
  try {
    return JSON.parse(row.payload_json) as StoredResearchSession;
  } catch {
    await runtime.DB.prepare("DELETE FROM research_sessions WHERE id_hash = ?").bind(idHash).run();
    return null;
  }
}

export async function deleteResearchSession(runtime: ShotprintEnv, sessionId: string) {
  if (!/^[0-9a-f-]{60,100}$/i.test(sessionId)) return false;
  const idHash = await hashSessionId(sessionId);
  if (runtime.STATE_STORE) {
    await runtime.STATE_STORE.delete(portableSessionKey(idHash));
    return true;
  }
  if (!runtime.DB) return false;
  await ensureResearchSessions(runtime);
  await runtime.DB.prepare("DELETE FROM research_sessions WHERE id_hash = ?").bind(idHash).run();
  return true;
}

export function researchSessionContainsRawData(payloadJson: string) {
  return /\b(comments?|memos?|snippet|pageText|raw|video)\b/i.test(payloadJson);
}
