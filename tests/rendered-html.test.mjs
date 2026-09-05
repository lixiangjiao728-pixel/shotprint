import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.SHOTPRINT_TEST_URL;
assert.ok(baseUrl, "SHOTPRINT_TEST_URL is required; run through tests/e2e-runner.mjs");

async function render(path = "/") {
  return fetch(new URL(path, baseUrl), { headers: { accept: "text/html" } });
}

test("server-renders the Shotprint product, not the starter", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /镜谱 Shotprint/);
  assert.match(html, /别抄爆款/);
  assert.match(html, /打开 20\.8 秒合成样片/);
  assert.match(html, /逐镜拆解/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("homepage exposes accessible upload and demo actions", async () => {
  const html = await (await render()).text();
  assert.match(html, /type="file"/);
  assert.match(html, /aria-label="选择视频文件"/);
  assert.match(html, /我拥有该素材的分析权利/);
  assert.match(html, /开始逐镜拆解/);
});

test("missing server key rejects live analysis while demo stays available", async () => {
  const response = await fetch(new URL("/api/upload-session", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName: "fixture.mp4", mimeType: "video/mp4", size: 1024, durationMs: 20800, consent: true }),
  });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.match(payload.error, /没有配置百炼与 OSS|内置样片/);
  const homepage = await (await render()).text();
  assert.match(homepage, /打开 20\.8 秒合成样片/);
});
