import type { BailianUsage } from "./cost-budget";

export type SearchSource = { title: string; url: string; publishedAt?: string; retrievedAt: string };

function normalizePublishedAt(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim().slice(0, 64);
}

export function normalizeSourceList(values: unknown, retrievedAt: string): SearchSource[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const sources: SearchSource[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    const rawUrl = typeof item.url === "string" ? item.url : typeof item.link === "string" ? item.link : "";
    const rawTitle = typeof item.title === "string" ? item.title : typeof item.name === "string" ? item.name : "联网搜索来源";
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "https:") continue;
      parsed.hash = "";
      const url = parsed.toString();
      if (seen.has(url)) continue;
      seen.add(url);
      sources.push({
        title: rawTitle.trim().slice(0, 200) || "联网搜索来源",
        url,
        publishedAt: normalizePublishedAt(item.publishedAt ?? item.published_at ?? item.publish_time ?? item.publishedTime) || "unknown",
        retrievedAt,
      });
      if (sources.length >= 8) break;
    } catch {
      // Search results are untrusted input; invalid URLs are discarded.
    }
  }
  return sources;
}

export function normalizeUsage(value: unknown): BailianUsage | null {
  if (!value || typeof value !== "object") return null;
  const usage = value as Record<string, unknown>;
  const prompt = usage.prompt_tokens ?? usage.input_tokens;
  const completion = usage.completion_tokens ?? usage.output_tokens;
  return {
    prompt_tokens: typeof prompt === "number" ? prompt : undefined,
    completion_tokens: typeof completion === "number" ? completion : undefined,
    total_tokens: typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
  };
}

export function parseNativeSearchPayload(payload: unknown, retrievedAt: string) {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const output = root.output && typeof root.output === "object" ? root.output as Record<string, unknown> : {};
  const searchInfo = output.search_info && typeof output.search_info === "object" ? output.search_info as Record<string, unknown> : {};
  const results = searchInfo.search_results ?? searchInfo.searchResults;
  return { sources: normalizeSourceList(results, retrievedAt), usage: normalizeUsage(root.usage ?? output.usage) };
}

export function parseCustomSearchPayload(payload: unknown, retrievedAt: string) {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const values = root.results ?? root.sources ?? root.data;
  return { sources: normalizeSourceList(values, retrievedAt), usage: normalizeUsage(root.usage) };
}
