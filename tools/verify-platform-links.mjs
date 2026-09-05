import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

// Collection-only live probe: never invokes research, upload or paid analysis.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SHOTPRINT_PLAYWRIGHT_MODULE || "playwright-core");
const extension = resolve("extension");
// Fresh profile prevents Chrome reusing a cached service worker for the same
// unpacked extension version during successive source revisions.
const profile = await mkdtemp(join(tmpdir(), "shotprint-link-verification-"));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.SHOTPRINT_CHROMIUM,
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15000 });
  console.log(JSON.stringify({ extensionLoaded: true, version: await worker.evaluate(() => chrome.runtime.getManifest().version) }));
  const page = await context.newPage();
  // Prevent the production UI from making any paid POST while testing the bridge.
  await page.route("**/api/**", (route) => route.request().method() === "POST" ? route.abort() : route.continue());
  await page.goto("https://shotprint.xyz", { waitUntil: "domcontentloaded", timeout: 30000 });
  const urls = process.argv.slice(2);
  for (const url of urls) {
    const requestId = `verify-${crypto.randomUUID()}`;
    await page.evaluate(({ url, requestId }) => {
      window.__shotprintProbe = [];
      const receive = (event) => {
        if (event.source !== window || event.data?.requestId !== requestId) return;
        const data = event.data;
        if (["shotprint:comments", "shotprint:error"].includes(data.type)) window.postMessage({ type: "shotprint:receipt-ack", requestId }, "*");
        window.__shotprintProbe.push({ type: data.type, code: data.code, step: data.step, detail: data.detail, comments: data.payload?.comments?.length, identityKey: data.payload?.identityKey, commentStatus: data.payload?.commentStatus });
        if (["shotprint:comments", "shotprint:error"].includes(data.type)) window.removeEventListener("message", receive);
      };
      window.addEventListener("message", receive);
      window.postMessage({ type: "shotprint:collect", url, requestId }, "*");
    }, { url, requestId });
    try {
      await page.waitForFunction(() => window.__shotprintProbe.some((x) => ["shotprint:comments", "shotprint:error"].includes(x.type)), undefined, { timeout: 160000 });
    } catch { /* Record the actual stage instead of reporting success. */ }
    console.log(JSON.stringify({ url, events: await page.evaluate(() => window.__shotprintProbe) }));
    console.log(JSON.stringify({ pages: await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const results = [];
      for (const tab of tabs.filter((t) => /douyin|bilibili|xiaohongshu/.test(t.url || ""))) {
        try {
          const [injected] = await Promise.race([
            chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ title: document.title, state: document.readyState, collector: Boolean(globalThis.__SHOTPRINT_COLLECTOR_V071__), runtime: Boolean(chrome.runtime), identity: globalThis.__shotprintWorkIdentity?.(), comments: document.querySelectorAll("[data-e2e='comment-item']").length, biliShadow: Boolean(document.querySelector("bili-comments")?.shadowRoot) }) }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("diagnostic-timeout")), 5000)),
          ]);
          results.push(injected.result);
        } catch { results.push({ unavailable: true }); }
      }
      return results;
    }).catch(() => [{ unavailable: true }]) }));
    await page.waitForTimeout(1000);
  }
} finally { await context.close(); }
