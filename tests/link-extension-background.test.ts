import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("extension waits through short-link landing pages and accepts only real platform video routes", async () => {
  const source = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
  const context: Record<string, unknown> = {
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    chrome: {
      runtime: { onConnect: { addListener: () => undefined }, onMessage: { addListener: () => undefined } },
      tabs: { onRemoved: { addListener: () => undefined }, onUpdated: { addListener: () => undefined } },
    },
  };
  vm.runInNewContext(source, context);
  const shortHost = context.shortHost as (url: string) => boolean;
  const platformHost = context.platformHost as (url: string) => boolean;
  const supportedVideoPage = context.supportedVideoPage as (url: string) => boolean;

  assert.equal(shortHost("https://v.douyin.com/5WS0PsEMhnY/"), true);
  assert.equal(supportedVideoPage("https://v.douyin.com/5WS0PsEMhnY/"), false);
  assert.equal(supportedVideoPage("https://www.douyin.com/video/7650427585301630208"), true);
  assert.equal(supportedVideoPage("https://www.douyin.com/jingxuan?modal_id=7650427585301630208"), true);
  assert.equal(supportedVideoPage("https://www.douyin.com/?aweme_id=7650427585301630208"), true);
  assert.equal(supportedVideoPage("https://www.iesdouyin.com/share/video/7650427585301630208"), true);
  assert.equal(supportedVideoPage("https://www.bilibili.com/video/BV11mFLziEyP"), true);
  assert.equal(supportedVideoPage("https://www.xiaohongshu.com/discovery/item/6a672872000000001c00d1b2"), true);
  assert.equal(supportedVideoPage("https://www.douyin.com/"), false);
  assert.equal(platformHost("https://notdouyin.com/video/123"), false);
});

test("short Douyin links do not accept a landing page without a work identity", async () => {
  const source = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
  const finalTab = { id: 9, status: "complete", url: "https://www.douyin.com/?from=short-link" };
  const context: Record<string, unknown> = {
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    chrome: {
      runtime: { lastError: null, onConnect: { addListener: () => undefined }, onMessage: { addListener: () => undefined } },
      tabs: {
        get: (_id: number, callback: (tab: typeof finalTab) => void) => callback(finalTab),
        onUpdated: { addListener: () => undefined, removeListener: () => undefined },
        onRemoved: { addListener: () => undefined },
      },
    },
  };
  vm.runInNewContext(source, context);
  const waitForLoadedSource = context.waitForLoadedSource as (tabId: number, requestedUrl: string, timeoutMs: number) => Promise<typeof finalTab>;
  await assert.rejects(() => waitForLoadedSource(9, "https://v.douyin.com/5WS0PsEMhnY/", 40), /SOURCE_LOAD_TIMEOUT/);
});

test("same-work navigation reinjects while a different work terminates the task", async () => {
  const source = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
  const updated: Array<(id: number, change: { status?: string; title?: string }, tab: { url?: string }) => void> = [];
  const runtimeListeners: Array<(message: object, sender: object) => void> = [];
  const delivered: Array<{ code?: string; type?: string }> = [];
  let injections = 0;
  const context = vm.createContext({
    URL, URLSearchParams, AbortController,
    setTimeout: () => 1, clearTimeout: () => undefined,
    chrome: {
      runtime: { lastError: null, getManifest: () => ({ version: "0.7.1" }), onConnect: { addListener: () => undefined }, onMessage: { addListener: (fn: typeof runtimeListeners[number]) => runtimeListeners.push(fn) } },
      scripting: { executeScript: async () => { injections += 1; } },
      tabs: {
        onUpdated: { addListener: (fn: typeof updated[number]) => { updated.push(fn); }, removeListener: () => undefined },
        onRemoved: { addListener: () => undefined },
        sendMessage: (id: number, message: { type?: string }, callback: (value?: object) => void) => {
          if (id === 9 && message.type === "shotprint:source-ping") callback({ ok: true, version: "0.7.1" });
          else if (id === 9 && message.type === "shotprint:collect-page") callback({ accepted: true });
          else { delivered.push(message); callback(); }
        },
      },
    },
  });
  vm.runInContext(source, context);
  vm.runInContext('jobs.set(9, { sourceTabId: 9, siteTabId: 1, requestId: "current", collecting: true, requestedUrl: "https://www.douyin.com/video/12345678", identityKey: "douyin:12345678", collectionDeadline: Date.now() + 100000 })', context);
  updated[0]?.(9, { status: "loading" }, { url: "https://www.douyin.com/video/12345678" });
  updated[0]?.(9, { status: "complete" }, { url: "https://www.douyin.com/jingxuan?modal_id=12345678" });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(injections, 1);
  assert.equal(delivered.some((message) => message.code), false);

  vm.runInContext('jobs.get(9).collecting = true', context);
  updated[0]?.(9, { status: "loading" }, { url: "https://www.douyin.com/video/87654321" });
  updated[0]?.(9, { status: "complete" }, { url: "https://www.douyin.com/video/87654321" });
  assert.equal(delivered.at(-1)?.code, "TARGET_VIDEO_CHANGED");
});
