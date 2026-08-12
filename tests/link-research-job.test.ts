import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Aliyun research returns a pollable job instead of holding the API Gateway request", async () => {
  const server = await readFile(new URL("../worker/aliyun-backend/server.ts", import.meta.url), "utf8");
  assert.match(server, /status:\s*"accepted"/);
  assert.match(server, /status:\s*202/);
  assert.match(server, /\/api\\\/link-research\\\/jobs/);
  assert.match(server, /runtime\.STATE_STORE\.putJson\(researchJobKey\(id\), base\)/);
  assert.doesNotMatch(server, /path === "\/api\/link-research"[^\n]+bufferResearchResponse/);
});

test("frontend polls an accepted research job without resubmitting the paid POST", async () => {
  const studio = await readFile(new URL("../app/ShotprintStudio.tsx", import.meta.url), "utf8");
  assert.match(studio, /response\.status === 202/);
  assert.match(studio, /\/api\/link-research\/jobs\/\$\{encodeURIComponent\(accepted\.researchJobId\)\}/);
  assert.match(studio, /Date\.now\(\) \+ 8 \* 60 \* 1000/);
});

test("failed research jobs preserve the safe backend message", async () => {
  const server = await readFile(new URL("../worker/aliyun-backend/server.ts", import.meta.url), "utf8");
  assert.match(server, /userMessage:\s*job\.userMessage/);
  assert.match(server, /userMessage\?: string/);
});
