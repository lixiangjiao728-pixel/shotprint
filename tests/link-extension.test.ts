import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("link bridge reports readiness, correlates requests, and fails closed", async () => {
  const [studio, content, background, manifest] = await Promise.all([
    readFile(new URL("app/ShotprintStudio.tsx", root), "utf8"),
    readFile(new URL("extension/site-bridge.js", root), "utf8"),
    readFile(new URL("extension/background.js", root), "utf8"),
    readFile(new URL("extension/manifest.json", root), "utf8").then(JSON.parse),
  ]);
  assert.equal(manifest.version, "0.6.9");
  assert.equal(manifest.host_permissions.includes("https://shotprint.xyz/*"), true);
  assert.equal(manifest.content_scripts[0].matches.includes("https://shotprint.xyz/*"), true);
  assert.match(studio, /phase === "idle"\) return recognized/);
  assert.match(studio, /shotprint:ping/);
  assert.match(studio, /COLLECTION_LOAD_WATCHDOG_MS = 55000/);
  assert.match(studio, /COLLECTION_STALL_WATCHDOG_MS = 18000/);
  assert.match(studio, /COLLECTION_CHANNEL_RETRY/);
  assert.match(studio, /shotprint:receipt-ack/);
  assert.match(content, /shotprint:bridge-ready/);
  assert.match(content, /shotprint:site-bridge/);
  assert.match(content, /shotprint:heartbeat/);
  assert.match(content, /activeRuntime\.lastError/);
  assert.match(content, /EXTENSION_CONTEXT_INVALIDATED/);
  assert.match(background, /requestId/);
  assert.match(background, /sitePorts/);
  assert.match(background, /原页面没有加载取证脚本/);
  assert.match(background, /评论组件没有在限定时间内返回结果/);
});
