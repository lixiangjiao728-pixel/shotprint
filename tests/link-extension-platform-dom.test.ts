import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

type Message = { type?: string; requestId?: string; payload?: { comments?: Array<Record<string, unknown>>; scrollActions?: number } };

function visibleElement(text = "") {
  return { textContent: text, getBoundingClientRect: () => ({ width: 200, height: 30 }) };
}

async function runCollector(platform: "douyin" | "xiaohongshu", douyinVariant: "detail" | "search-modal" | "search-button" | "virtualized" = "detail") {
  const source = await readFile(new URL("../extension/collector.js", import.meta.url), "utf8");
  const outbound: Message[] = [];
  let listener: ((message: Message, sender: unknown, respond: (value: unknown) => void) => void) | undefined;
  const scroller = { scrollTop: 0, scrollHeight: douyinVariant === "virtualized" ? 10000 : 1200, clientHeight: 500 };
  let commentOpened = douyinVariant !== "search-button";
  const xhsItem = {
    ...visibleElement(),
    querySelector: (selector: string) => selector.includes("note-text") ? visibleElement("小红书真实结构正文") : selector.includes("like") ? visibleElement("12") : selector.includes("date") ? visibleElement("08-08 上海") : null,
    closest: () => null,
  };
  const douyinItem = {
    ...visibleElement(),
    querySelector: (selector: string) => douyinVariant !== "detail"
      ? selector === "[data-e2e='comment-content']" ? visibleElement("抖音搜索弹层评论正文") : null
      : selector === ".comment-item-info-wrap" ? { nextElementSibling: visibleElement("抖音真实结构正文") } : null,
    parentElement: null,
  };
  const virtualizedItems = () => Array.from({ length: 5 }, (_, index) => ({
    ...visibleElement(),
    querySelector: (selector: string) => selector === "[data-e2e='comment-content']" ? visibleElement(`虚拟评论-${Math.floor(scroller.scrollTop / 600)}-${index}`) : null,
    parentElement: scroller,
  }));
  const document = {
    title: "fixture video",
    body: { innerText: "公开评论页" },
    scrollingElement: scroller,
    querySelectorAll: (selector: string) => {
      if (selector.includes("iframe[src*='captcha'") && douyinVariant === "virtualized") return [{ ...visibleElement(), id: "nocaptcha-container", getBoundingClientRect: () => ({ width: 0, height: 0 }) }];
      if (selector === ".comment-item") return platform === "xiaohongshu" ? [xhsItem] : [];
      if (selector === "[data-e2e='comment-item']") return platform === "douyin" && douyinVariant === "detail" ? [douyinItem] : platform === "douyin" && douyinVariant === "virtualized" ? virtualizedItems() : [];
      if (selector === "[data-e2e='search-comment-item']") return platform === "douyin" && douyinVariant !== "detail" && commentOpened ? [douyinItem] : [];
      if (selector === "[data-e2e='search-comment-container']") return platform === "douyin" && douyinVariant !== "detail" && commentOpened ? [scroller] : [];
      return [];
    },
    querySelector: (selector: string) => {
      if (selector === ".note-scroller" && platform === "xiaohongshu") return scroller;
      if (selector === ".parent-route-container.route-scroll-container" && platform === "douyin") return scroller;
      if (selector === "[data-e2e='video-comment-icon']" && platform === "douyin" && douyinVariant === "search-button") return { ...visibleElement("评论"), click: () => { commentOpened = true; } };
      return null;
    },
  };
  const hostname = platform === "douyin" ? "www.douyin.com" : "www.xiaohongshu.com";
  const context = {
    document,
    location: { hostname, href: `https://${hostname}/video/fixture` },
    window: { innerHeight: 800, scrollBy: () => undefined },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    chrome: { runtime: { getManifest: () => ({ version: "0.6.0" }), onMessage: { addListener: (fn: typeof listener) => { listener = fn; } }, sendMessage: (message: Message) => outbound.push(message) } },
    setTimeout: (callback: () => void) => { callback(); return 1; },
    clearTimeout: () => undefined,
    Date, Promise, Map, Set, URL, URLSearchParams,
  };
  vm.runInNewContext(source, context);
  listener?.({ type: "shotprint:collect-page", requestId: `fixture-${platform}` }, {}, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return outbound.find((message) => message.type === "shotprint:comments")?.payload;
}

test("extension reads Xiaohongshu content, likes and coarse date from the verified structure", async () => {
  const payload = await runCollector("xiaohongshu");
  assert.equal(payload?.comments?.[0]?.text, "小红书真实结构正文");
  assert.equal(payload?.comments?.[0]?.likes, 12);
  assert.equal(payload?.comments?.[0]?.timeLabel, "08-08 上海");
  assert.ok(Number(payload?.scrollActions) <= 15);
});

test("extension reads Douyin content after comment-item-info-wrap with bounded scrolling", async () => {
  const payload = await runCollector("douyin");
  assert.equal(payload?.comments?.[0]?.text, "抖音真实结构正文");
  assert.ok(Number(payload?.scrollActions) <= 15);
});

test("extension reads Douyin comments from a search-page video modal", async () => {
  const payload = await runCollector("douyin", "search-modal");
  assert.equal(payload?.comments?.[0]?.text, "抖音搜索弹层评论正文");
  assert.ok(Number(payload?.scrollActions) <= 15);
});

test("extension opens the Douyin comment panel before reading a search-page video", async () => {
  const payload = await runCollector("douyin", "search-button");
  assert.equal(payload?.comments?.[0]?.text, "抖音搜索弹层评论正文");
});

test("extension accumulates virtualized Douyin comments and ignores a hidden captcha placeholder", async () => {
  const payload = await runCollector("douyin", "virtualized");
  assert.ok((payload?.comments?.length || 0) >= 50);
  assert.ok(Number(payload?.scrollActions) >= 10);
});
