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
      tabs: { onRemoved: { addListener: () => undefined } },
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

test("short Douyin links accept a stable same-platform SPA landing page", async () => {
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
  const resolved = await waitForLoadedSource(9, "https://v.douyin.com/5WS0PsEMhnY/", 4000);
  assert.equal(resolved.url, finalTab.url);
});
