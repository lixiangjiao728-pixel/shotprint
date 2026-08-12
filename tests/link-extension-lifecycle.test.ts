import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("site bridge keeps the MV3 worker alive and forwards port results", async () => {
  const source = await readFile(new URL("../extension/site-bridge.js", import.meta.url), "utf8");
  const windowMessages: Array<Record<string, unknown>> = [];
  const portMessages: Array<Record<string, unknown>> = [];
  const runtimeMessages: Array<Record<string, unknown>> = [];
  let portListener: ((message: Record<string, unknown>) => void) | undefined;
  let disconnectListener: (() => void) | undefined;
  let windowListener: ((event: { source: unknown; data: Record<string, unknown> }) => void) | undefined;
  const windowObject = {
    postMessage: (message: Record<string, unknown>) => windowMessages.push(message),
    addEventListener: (_type: string, listener: typeof windowListener) => { windowListener = listener; },
  };
  const port = {
    onMessage: { addListener: (listener: typeof portListener) => { portListener = listener; } },
    onDisconnect: { addListener: (listener: typeof disconnectListener) => { disconnectListener = listener; } },
    postMessage: (message: Record<string, unknown>) => portMessages.push(message),
  };
  const context = {
    window: windowObject,
    Date,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => undefined,
    chrome: {
      runtime: {
        getManifest: () => ({ version: "0.5.0", version_name: "0.5.0" }),
        connect: () => port,
        sendMessage: (message: Record<string, unknown>, callback: (response: unknown) => void) => { runtimeMessages.push(message); callback({ accepted: true }); },
        onMessage: { addListener: () => undefined },
        lastError: undefined,
      },
    },
  };
  vm.runInNewContext(source, context);
  assert.ok(windowListener);
  assert.ok(portListener);
  assert.ok(disconnectListener);
  assert.equal(portMessages[0]?.type, "shotprint:site-ready");
  portListener?.({ type: "shotprint:progress", requestId: "req-1", stage: 2 });
  assert.equal(windowMessages.at(-1)?.type, "shotprint:progress");
  assert.equal(windowMessages.at(-1)?.requestId, "req-1");
  windowListener?.({ source: windowObject, data: { type: "shotprint:receipt-ack", requestId: "req-1" } });
  assert.equal(portMessages.at(-1)?.type, "shotprint:receipt-ack");
  assert.equal(portMessages.at(-1)?.requestId, "req-1");
  windowListener?.({ source: windowObject, data: { type: "shotprint:retry-collection", previousRequestId: "req-old", requestId: "req-new", url: "https://www.douyin.com/video/123456" } });
  assert.equal(runtimeMessages.at(-2)?.type, "shotprint:cancel-collection");
  assert.equal(runtimeMessages.at(-2)?.requestId, "req-old");
  assert.equal(runtimeMessages.at(-1)?.type, "shotprint:open");
  assert.equal(runtimeMessages.at(-1)?.requestId, "req-new");
  (context.chrome as { runtime?: unknown }).runtime = undefined;
  windowListener?.({ source: windowObject, data: { type: "shotprint:ping" } });
  assert.equal(windowMessages.at(-1)?.type, "shotprint:error");
  assert.equal(windowMessages.at(-1)?.code, "EXTENSION_CONTEXT_INVALIDATED");
});

test("background uses stage-specific deadlines and retains terminal results until the page acknowledges them", async () => {
  const source = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
  assert.match(source, /SOURCE_LOAD_TIMEOUT_MS = 50000/);
  assert.match(source, /SOURCE_ROUTE_STABLE_MS = 2500/);
  assert.match(source, /pendingUrl/);
  assert.match(source, /modal_id/);
  assert.match(source, /primaryMessages/);
  assert.match(source, /BrowserAct高级兜底未启动不会阻止主流程/);
  assert.match(source, /COLLECTION_HARD_TIMEOUT_MS = 100000/);
  assert.match(source, /TERMINAL_DELIVERY_ATTEMPTS = 4/);
  assert.match(source, /function deliverTerminal/);
  assert.match(source, /shotprint:receipt-ack/);
  assert.match(source, /shotprint:cancel-collection/);
  assert.doesNotMatch(source, /finish\(sender\.tab\.id\)/);
});

test("collector waits for Bilibili comments with bounded progress instead of going silent", async () => {
  const source = await readFile(new URL("../extension/collector.js", import.meta.url), "utf8");
  assert.match(source, /waiting-bilibili-comments/);
  assert.match(source, /Date\.now\(\) \+ 20000/);
  assert.match(source, /bili-comment-reply-renderer/);
  assert.match(source, /#commentapp, \.comment-container, \.reply-list/);
  assert.doesNotMatch(source, /div\[class\*=comment\]/);
});
