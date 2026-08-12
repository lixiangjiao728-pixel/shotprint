import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

test("link API returns a privacy-safe structured report without search configuration", async () => {
  const port = 43128;
  const server = spawn(process.execPath, ["node_modules/vinext/dist/cli.js", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, SEARCH_API_URL: "", SEARCH_API_KEY: "" },
    stdio: "ignore",
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { const response = await fetch(`http://127.0.0.1:${port}/`); if (response.ok) { ready = true; break; } } catch { /* server is still starting */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true);
    const response = await fetch(`http://127.0.0.1:${port}/api/link-analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://www.douyin.com/video/shotprint-demo-link", platform: "douyin", method: "manual", comments: [{ id: "api-1", text: "这个反转很有意思", author: "must-not-escape" }] }) });
    assert.equal(response.status, 200);
    const text = await response.text();
    const payload = JSON.parse(text) as { result: { version: string; collection: { sampleCount: number }; warnings: string[] } };
    assert.equal(payload.result.version, "link.1");
    assert.equal(payload.result.collection.sampleCount, 1);
    assert.equal(text.includes("must-not-escape"), false);
    assert.equal(payload.result.warnings.some((warning) => warning.includes("未配置联网搜索")), true);
    const emptyResponse = await fetch(`http://127.0.0.1:${port}/api/link-analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://www.bilibili.com/video/BV11mFLziEyP/", platform: "bilibili", method: "extension", comments: [] }) });
    assert.equal(emptyResponse.status, 422);
    assert.match(await emptyResponse.text(), /没有取得可分析评论/);
  } finally {
    server.kill();
  }
});
