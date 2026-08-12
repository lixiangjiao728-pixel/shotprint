import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSourceList, parseNativeSearchPayload } from "../lib/search-provider.ts";

const retrievedAt = "2026-08-04T00:00:00.000Z";

test("native Bailian search parser reads only output.search_info.search_results", () => {
  const parsed = parseNativeSearchPayload({
    output: {
      search_info: {
        search_results: [
          { title: "来源 A", url: "https://example.com/a", published_at: "2026-08-01" },
          { title: "重复来源", url: "https://example.com/a#fragment" },
          { title: "来源 B", url: "http://insecure.example/b" },
          { title: "来源 C", url: "https://example.com/c" },
          { title: "来源 D", url: "https://example.com/d" },
        ],
      },
    },
    usage: { input_tokens: 321, output_tokens: 45 },
    unrelated: { url: "https://should-not-be-guessed.example" },
  }, retrievedAt);

  assert.deepEqual(parsed.sources.map((source) => source.url), [
    "https://example.com/a",
    "https://example.com/c",
    "https://example.com/d",
  ]);
  assert.equal(parsed.sources[0].publishedAt, "2026-08-01");
  assert.equal(parsed.sources[1].publishedAt, "unknown");
  assert.equal(parsed.sources.every((source) => source.retrievedAt === retrievedAt), true);
  assert.deepEqual(parsed.usage, { prompt_tokens: 321, completion_tokens: 45, total_tokens: undefined });
});

test("native source normalization rejects non-HTTPS and duplicate URLs", () => {
  const sources = normalizeSourceList([
    { title: "ok", url: "https://news.example/story?utm_source=share#top" },
    { title: "dup", url: "https://news.example/story?utm_source=share" },
    { title: "bad", url: "javascript:alert(1)" },
    { title: "bad", url: "not a URL" },
  ], retrievedAt);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, "https://news.example/story?utm_source=share");
});

test("missing native search results yields no guessed sources", () => {
  const parsed = parseNativeSearchPayload({ output: { text: "https://model-text.example/not-a-source" } }, retrievedAt);
  assert.deepEqual(parsed.sources, []);
});
