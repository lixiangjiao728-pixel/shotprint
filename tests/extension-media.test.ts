import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../extension/media.js", import.meta.url), "utf8");
async function setup(src = "https://v.example.douyinvod.com/clip.mp4", size = 16) {
  let key = "douyin:123456";
  let fetchOptions: RequestInit | undefined;
  let listener: (message: object, sender: object, respond: (value: Record<string, unknown>) => void) => void;
  const context = {
    URL, Blob, Uint8Array, AbortController, btoa,
    setTimeout, clearTimeout,
    __shotprintWorkIdentity: () => ({ key }),
    window: { addEventListener: () => {} },
    document: { querySelectorAll: () => [{ currentSrc: src, duration: 20, getBoundingClientRect: () => ({ width: 640, height: 360 }) }] },
    chrome: { runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } } },
    fetch: async (_url: string, options: RequestInit) => {
      fetchOptions = options;
      return new Response(new Uint8Array(Math.min(size, 16)), { headers: { "content-type": "video/mp4", "content-length": String(size) } });
    },
  };
  vm.runInNewContext(source, context);
  const ask = (action: string, rest: object = {}) => new Promise<Record<string, unknown>>((resolve) => listener({ type: "shotprint:media-read", action, identityKey: "douyin:123456", token: "task-a", ...rest }, {}, resolve));
  const settle = async () => { await new Promise((resolve) => setTimeout(resolve, 10)); return ask("status"); };
  return { ask, settle, changeWork: () => { key = "douyin:999999"; }, options: () => fetchOptions };
}

test("media read transfers bounded chunks without cookies, redirects or source URLs", async () => {
  const media = await setup();
  try {
    await media.ask("begin");
    const state = await media.settle();
    assert.equal(state.status, "ready");
    assert.equal(media.options()?.credentials, "omit");
    assert.equal(media.options()?.redirect, "error");
    const chunk = await media.ask("chunk", { offset: 0 });
    assert.equal(Buffer.from(String(chunk.data), "base64").length, 16);
    assert.equal(JSON.stringify(state).includes("douyinvod"), false);
    assert.equal((await media.ask("chunk", { offset: -1 })).code, "VIDEO_CHUNK_INVALID");
    assert.equal((await media.ask("chunk", { offset: 0, token: "another-task" })).code, "VIDEO_SESSION_EXPIRED");
    media.changeWork();
    assert.equal((await media.ask("chunk", { offset: 0 })).code, "TARGET_VIDEO_CHANGED");
  } finally { await media.ask("release"); }
});

test("blob players, untrusted hosts and oversized files do not produce false media success", async () => {
  for (const [src, size, code] of [
    ["blob:https://www.bilibili.com/123", 16, "VIDEO_RECORDING_REQUIRED"],
    ["https://127.0.0.1/video.mp4", 16, "VIDEO_RECORDING_REQUIRED"],
    ["https://v.example.douyinvod.com/clip.mp4", 300 * 1024 * 1024 + 1, "VIDEO_SIZE_LIMIT"],
  ] as const) {
    const media = await setup(src, size);
    try { await media.ask("begin"); assert.equal((await media.settle()).code, code); }
    finally { await media.ask("release"); }
  }
});
