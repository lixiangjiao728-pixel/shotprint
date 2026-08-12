import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

type CollectorMessage = { type?: string; requestId?: string };
type CollectorResponse = (value: unknown) => void;
type CollectorListener = (message: CollectorMessage, sender: unknown, sendResponse: CollectorResponse) => void;
type OutboundMessage = { type?: string; requestId?: string; code?: string; payload?: { author?: string; comments?: Array<{ text: string; author?: string }> } };

function element(text: string) {
  return {
    textContent: text,
    tagName: "DIV",
    shadowRoot: null,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 320, height: 40 }),
  };
}

test("collector handshake is idempotent and merges comments across bounded scrolls", async () => {
  const source = await readFile(new URL("../extension/collector.js", import.meta.url), "utf8");
  let scrolls = 0;
  let listener: CollectorListener | undefined;
  const outbound: OutboundMessage[] = [];
  const document = {
    title: "fixture video",
    body: { innerText: "播放量 403 · 评论正常加载" },
    querySelectorAll: (selector: string) => { if (selector.includes("captcha") || selector.includes("geetest") || selector.includes("verify")) return []; return scrolls === 0
      ? [element("第一条评论"), element("第二条评论")]
      : [element("第二条评论"), element("第三条评论")];
    },
    querySelector: (selector: string) => selector.includes("video") ? element("video") : null,
  };
  const context = {
    console,
    document,
    location: { hostname: "www.douyin.com", href: "https://www.douyin.com/video/fixture" },
    window: {
      innerHeight: 900,
      scrollBy: () => { scrolls += 1; },
    },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    chrome: {
      runtime: {
        getManifest: () => ({ version: "0.5.0", version_name: "0.5.0" }),
        onMessage: { addListener: (fn: typeof listener) => { listener = fn; } },
        sendMessage: (message: OutboundMessage) => { outbound.push(message); },
      },
    },
    setTimeout: (callback: (...args: unknown[]) => void, ms?: number) => setTimeout(callback, Math.min(ms || 0, 10)),
    clearTimeout,
    Date,
    Promise,
    Map,
    Set,
    URL,
  };
  vm.runInNewContext(source, context);
  assert.ok(listener);

  let handshake: unknown;
  listener?.({ type: "shotprint:source-ping" }, {}, (value) => { handshake = value; });
  assert.equal(JSON.stringify(handshake), JSON.stringify({ ok: true, version: "0.5.0", platform: "douyin", url: "https://www.douyin.com/video/fixture" }));

  let accepted: unknown;
  listener?.({ type: "shotprint:collect-page", requestId: "req-1" }, {}, (value) => { accepted = value; });
  assert.equal(JSON.stringify(accepted), JSON.stringify({ accepted: true }));
  for (let attempt = 0; attempt < 150 && !outbound.some((message) => message.type === "shotprint:comments"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const result = outbound.find((message) => message.type === "shotprint:comments");
  assert.ok(result);
  assert.equal(result.requestId, "req-1");
  assert.equal(JSON.stringify(result.payload?.comments?.map((comment) => comment.text)), JSON.stringify(["第一条评论", "第二条评论", "第三条评论"]));
  assert.equal(result.payload?.comments?.some((comment) => "author" in comment), false);
  assert.equal(scrolls > 0, true);
});

test("collector reports HTTP_403 only for an actual access-denied page", async () => {
  const source = await readFile(new URL("../extension/collector.js", import.meta.url), "utf8");
  let listener: CollectorListener | undefined;
  const outbound: OutboundMessage[] = [];
  const heading = element("Sorry, you have been blocked");
  const context = {
    console,
    document: {
      title: "Attention Required! | Cloudflare",
      body: { innerText: "Sorry, you have been blocked. Cloudflare Ray ID" },
      querySelectorAll: (selector: string) => selector.includes("h1") ? [heading] : [],
      querySelector: () => null,
    },
    location: { hostname: "www.bilibili.com", href: "https://www.bilibili.com/video/fixture" },
    window: { innerHeight: 900, scrollBy: () => undefined },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    chrome: {
      runtime: {
        getManifest: () => ({ version: "0.5.0", version_name: "0.5.0" }),
        onMessage: { addListener: (fn: typeof listener) => { listener = fn; } },
        sendMessage: (message: OutboundMessage) => { outbound.push(message); },
      },
    },
    setTimeout, clearTimeout, Date, Promise, Map, Set, URL,
  };
  vm.runInNewContext(source, context);
  listener?.({ type: "shotprint:collect-page", requestId: "req-blocked" }, {}, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const error = outbound.find((message) => message.type === "shotprint:error");
  assert.equal(error?.code, "HTTP_403");
});

test("manifest keeps only required permissions and exposes user-facing v0.6.9", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.version_name, "0.6.9");
  assert.deepEqual(manifest.permissions.sort(), ["scripting", "tabs"]);
  assert.equal("cookies" in manifest.permissions, false);
  assert.equal("webRequest" in manifest.permissions, false);
  assert.deepEqual(manifest.content_scripts.map((item: { js: string[] }) => item.js), [["site-bridge.js"]]);
});

test("legacy offline extension checksum remains internally consistent", async () => {
  const zip = await readFile(new URL("../extension/shotprint-extension.zip", import.meta.url));
  const expected = (await readFile(new URL("../extension/shotprint-extension.zip.sha256", import.meta.url), "utf8")).trim();
  assert.equal(createHash("sha256").update(zip).digest("hex"), expected);
});

test("homepage download payload is a valid v0.6.9 ZIP with a matching checksum", async () => {
  const [encoded, expected, studio] = await Promise.all([
    readFile(new URL("../public/shotprint-extension-0.6.9.zip.b64", import.meta.url), "utf8"),
    readFile(new URL("../public/shotprint-extension-0.6.9.zip.sha256", import.meta.url), "utf8"),
    readFile(new URL("../app/ShotprintStudio.tsx", import.meta.url), "utf8"),
  ]);
  const zip = Buffer.from(encoded.trim(), "base64");
  assert.equal(zip.subarray(0, 2).toString("ascii"), "PK");
  assert.equal(zip.length > 10000, true);
  assert.equal(createHash("sha256").update(zip).digest("hex"), expected.trim());
  assert.match(studio, /shotprint-extension-0\.6\.9\.zip\.b64/);
  assert.match(studio, /下载0\.6\.9扩展/);
});
