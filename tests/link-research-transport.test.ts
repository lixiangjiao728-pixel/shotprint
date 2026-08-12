import assert from "node:assert/strict";
import test from "node:test";
import { bufferResearchResponse, parseResearchEventStream } from "../lib/research-transport.ts";

test("research SSE is converted to a complete gateway JSON response", async () => {
  const source = [
    "event: progress\ndata: {\"stage\":\"deep-search\",\"completed\":1}",
    "event: progress\ndata: {\"stage\":\"cross-check\",\"sourceCount\":9}",
    "event: complete\ndata: {\"researchSessionId\":\"session-safe\",\"receipt\":{\"sourceCount\":9}}",
    "",
  ].join("\r\n\r\n");
  const parsed = parseResearchEventStream(source);
  assert.equal(parsed.status, "complete");
  assert.equal(parsed.researchSessionId, "session-safe");
  assert.equal(parsed.progress.length, 2);

  const response = await bufferResearchResponse(new Response(source, { headers: { "content-type": "text/event-stream; charset=utf-8" } }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.equal((await response.json() as { status: string }).status, "complete");
});

test("research SSE failure becomes a non-success gateway JSON response", async () => {
  const source = "event: failed\ndata: {\"errorCode\":\"SEARCH_AUTH_FAILED\",\"userMessage\":\"权限不足\"}\n\n";
  const response = await bufferResearchResponse(new Response(source, { headers: { "content-type": "text/event-stream" } }));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { status: "failed", progress: [], errorCode: "SEARCH_AUTH_FAILED", userMessage: "权限不足" });
});

test("research stream without a terminal event is rejected", () => {
  assert.throws(() => parseResearchEventStream("event: progress\ndata: {\"completed\":1}\n\n"), /RESEARCH_STREAM_INCOMPLETE/);
});

