import http from "node:http";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allowExtensionOrigin, classifyUrl, HOST, makePairingCode, makeSession, MAX_BODY_BYTES, navigationReachedTarget, PORT, sanitizeComments, shouldReusePage, tokenMatches, videoKey } from "./security.mjs";
import { observedRequestIds, parseCapturedResponse } from "./network-evidence.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..");
const browserAct = process.env.SHOTPRINT_BROWSER_ACT || join(process.env.USERPROFILE || "", ".local", "bin", "browser-act.exe");
const python = process.env.SHOTPRINT_PYTHON || "python";
const directBrowserId = process.env.SHOTPRINT_BROWSER_ID || "";
const pairingCode = /^\d{6}$/.test(String(process.env.SHOTPRINT_PAIRING_CODE || "")) ? String(process.env.SHOTPRINT_PAIRING_CODE) : makePairingCode();
let session = null;
const running = new Map();
const cancelled = new Set();
const lastRequestedUrl = new Map();
const resolvedVideoKeys = new Map();
const platformStatus = { bilibili: "unknown", douyin: "unknown", xiaohongshu: "unknown" };

function json(response, status, body, origin = "") {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(allowExtensionOrigin(origin) ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
  });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    request.on("data", (chunk) => { size += chunk.length; if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error("BODY_TOO_LARGE"), { status: 413 })); request.destroy(); } else chunks.push(chunk); });
    request.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(Object.assign(new Error("INVALID_JSON"), { status: 400 })); } });
    request.on("error", reject);
  });
}

function run(command, args, input = "", timeoutMs = 95000, requestId = "") {
  return new Promise((resolve, reject) => {
    if (requestId && cancelled.has(requestId)) {
      reject(Object.assign(new Error("Request cancelled"), { code: "REQUEST_CANCELLED" }));
      return;
    }
    if (requestId && running.has(requestId)) {
      reject(Object.assign(new Error("A request with this id is already running"), { code: "DUPLICATE_REQUEST" }));
      return;
    }
    const child = spawn(command, args, { cwd: projectRoot, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], shell: false, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
    if (requestId) running.set(requestId, child);
    const chunks = []; const errors = [];
    let settled = false;
    const cleanup = () => { if (requestId && running.get(requestId) === child) running.delete(requestId); };
    const finish = (callback) => { if (settled) return; settled = true; clearTimeout(timer); cleanup(); callback(); };
    const timer = setTimeout(() => { child.kill(); finish(() => reject(Object.assign(new Error("BROWSERACT_TIMEOUT"), { code: "BROWSERACT_UNAVAILABLE" }))); }, timeoutMs);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", (error) => finish(() => reject(Object.assign(error, { code: "BROWSERACT_UNAVAILABLE" }))));
    child.on("close", (code) => {
      finish(() => {
        if (requestId && cancelled.has(requestId)) reject(Object.assign(new Error("Request cancelled"), { code: "REQUEST_CANCELLED" }));
        else if (code === 0) resolve(Buffer.concat(chunks).toString("utf8").trim());
        else reject(Object.assign(new Error(Buffer.concat(errors).toString("utf8").slice(0, 300) || `BrowserAct exited ${code}`), { code: "BROWSERACT_UNAVAILABLE" }));
      });
    });
    child.stdin.end(input);
  });
}

function sessionName(platform) { return `shotprint-companion-${platform}`; }

async function ensureBrowser(platform, url, requestId) {
  if (!directBrowserId) throw Object.assign(new Error("SHOTPRINT_BROWSER_ID is not configured"), { code: "BROWSERACT_UNAVAILABLE" });
  const name = sessionName(platform);
  let exists = true;
  try { await run(browserAct, ["--session", name, "get", "title"], "", 8000, requestId); }
  catch (error) { if (error?.code === "REQUEST_CANCELLED") throw error; exists = false; }
  let current = "";
  if (exists) {
    try { current = parseBrowserResult(await run(browserAct, ["--session", name, "eval", "JSON.stringify({url:location.href})"], "", 8000, requestId))?.url || ""; } catch { /* navigate below */ }
  }
  try {
    if (!exists) await run(browserAct, ["--session", name, "browser", "open", directBrowserId, url], "", 60000, requestId);
    else if (!shouldReusePage(platform, url, current, lastRequestedUrl.get(platform), resolvedVideoKeys.get(platform))) await run(browserAct, ["--session", name, "navigate", url], "", 45000, requestId);
  } catch (error) {
    if (error?.code === "REQUEST_CANCELLED") throw error;
    let loaded = "";
    try { loaded = parseBrowserResult(await run(browserAct, ["--session", name, "eval", "JSON.stringify({url:location.href})"], "", 8000))?.url || ""; } catch { /* handled below */ }
    if (!navigationReachedTarget(platform, url, current, loaded, lastRequestedUrl.get(platform), resolvedVideoKeys.get(platform))) throw error;
  }
  try { await run(browserAct, ["--session", name, "wait", "stable", "--timeout", "12000"], "", 18000, requestId); }
  catch (error) {
    if (error?.code === "REQUEST_CANCELLED") throw error;
    if (!/210206|timed out waiting for page readiness/i.test(String(error?.message || ""))) throw error;
  }
  let loaded = "";
  try { loaded = parseBrowserResult(await run(browserAct, ["--session", name, "eval", "JSON.stringify({url:location.href})"], "", 8000, requestId))?.url || ""; }
  catch (error) { throw Object.assign(error, { code: "BROWSERACT_UNAVAILABLE" }); }
  if (!navigationReachedTarget(platform, url, current, loaded, lastRequestedUrl.get(platform), resolvedVideoKeys.get(platform))) throw Object.assign(new Error("Browser stayed on a different video"), { code: "UNSUPPORTED_REDIRECT" });
  lastRequestedUrl.set(platform, url);
  resolvedVideoKeys.set(platform, videoKey(platform, loaded));
  return name;
}

async function emittedScript(platform, action, targetCount) {
  const script = join(projectRoot, "worker", "browser-act-skills", `${platform}-video-comments`, "scripts", "emit_js.py");
  return run(python, [script, action, String(targetCount)], "", 10000);
}

function parseBrowserResult(output) {
  try {
    const parsed = JSON.parse(output);
    return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  } catch { throw Object.assign(new Error("BrowserAct returned an unreadable result"), { code: "NETWORK_RESPONSE_CHANGED" }); }
}

function safeObservedCommentUrls(platform, output) {
  const patterns = {
    bilibili: { host: "api.bilibili.com", path: "/x/v2/reply/wbi/main" },
    douyin: { host: "www.douyin.com", pathPrefix: "/aweme/v1/web/comment/" },
    xiaohongshu: { host: "edith.xiaohongshu.com", pathPrefix: "/api/sns/web/" },
  };
  const expected = patterns[platform]; if (!expected) return [];
  return [...new Set(String(output || "").match(/https:\/\/[^\s",]+/g) || [])].flatMap((value) => {
    try { const url = new URL(value); const pathOk = expected.path ? url.pathname === expected.path : url.pathname.startsWith(expected.pathPrefix); return url.hostname === expected.host && pathOk ? [url.toString()] : []; } catch { return []; }
  }).slice(0, 20);
}

async function capturedNetworkComments(platform, name, requestId) {
  const filters = { bilibili: "/x/v2/reply/wbi/main", douyin: "/aweme/v1/web/comment/list/", xiaohongshu: "/api/sns/web/v2/comment/" };
  let list;
  try {
    const output = await run(browserAct, ["--format", "json", "--session", name, "network", "requests", "--filter", filters[platform], "--status", "200"], "", 15000, requestId);
    list = JSON.parse(output);
  } catch {
    return { comments: [], pageCount: 0, cursorCount: 0, warnings: ["页面网络响应读取失败，已保留DOM结果"] };
  }
  const ids = observedRequestIds(platform, list);
  const comments = [];
  const cursors = new Set();
  let pageCount = 0;
  for (const id of ids) {
    try {
      const output = await run(browserAct, ["--format", "json", "--session", name, "network", "request", id], "", 12000, requestId);
      const receipt = parseCapturedResponse(platform, JSON.parse(output));
      if (!receipt) continue;
      pageCount += 1;
      if (receipt.cursor) cursors.add(receipt.cursor);
      comments.push(...receipt.comments);
    } catch {
      // One changed or evicted response must not discard other valid pages or the DOM fallback.
    }
  }
  return { comments, pageCount, cursorCount: cursors.size, warnings: [] };
}

async function collect(body, requestId) {
  const target = classifyUrl(body?.url);
  if (!target) throw Object.assign(new Error("Only supported platform URLs are allowed"), { code: "UNSUPPORTED_REDIRECT", status: 400 });
  const targetCount = body?.targetCount === 200 ? 200 : 100;
  let name;
  try { name = await ensureBrowser(target.platform, target.url, requestId); }
  catch (error) { error.step = "browser_prepare"; throw error; }
  let script;
  try { script = await emittedScript(target.platform, "comments", targetCount); }
  catch (error) { error.step = "skill_emit"; throw error; }
  let output;
  try { output = await run(browserAct, ["--session", name, "eval", "--stdin"], script, 95000, requestId); }
  catch (error) { error.step = "collector_eval"; throw error; }
  let result = parseBrowserResult(output);
  if (target.platform === "bilibili" && Array.isArray(result?.comments) && result.comments.length < targetCount && !result?.errorCode) {
    let network;
    try { network = await run(browserAct, ["--session", name, "network", "requests", "--filter", "/x/v2/reply/wbi/main", "--type", "xhr,fetch"], "", 15000); }
    catch (error) { error.step = "network_receipt"; throw error; }
    const urls = safeObservedCommentUrls(target.platform, network);
    if (urls.length > 1) {
      try {
        await run(browserAct, ["--session", name, "eval", "--stdin"], `globalThis.__SHOTPRINT_OBSERVED_COMMENT_URLS__=${JSON.stringify(urls)};true`, 10000);
        output = await run(browserAct, ["--session", name, "eval", "--stdin"], script, 95000, requestId);
      } catch (error) { error.step = "network_replay"; throw error; }
      result = parseBrowserResult(output);
    }
  }
  const captured = await capturedNetworkComments(target.platform, name, requestId);
  const combined = [...(Array.isArray(captured.comments) ? captured.comments : []), ...(Array.isArray(result?.comments) ? result.comments : [])];
  if (["CAPTCHA_REQUIRED", "HTTP_403", "HTTP_429", "LOGIN_REQUIRED"].includes(result?.errorCode)) { platformStatus[target.platform] = result.errorCode === "LOGIN_REQUIRED" ? "login_required" : "blocked"; throw Object.assign(new Error(result.errorCode), { code: result.errorCode }); }
  const comments = sanitizeComments(combined, targetCount);
  if (!comments.length) throw Object.assign(new Error("No safe comments returned"), { code: result?.errorCode || "NETWORK_RESPONSE_CHANGED" });
  platformStatus[target.platform] = "ready";
  return {
    platform: target.platform, url: target.url, title: String(result?.title || "").slice(0, 200), comments,
    engine: captured.pageCount > 0 ? "browser-act-network" : "browser-act-dom",
    strategyVersion: String(result?.strategyVersion || "unknown").slice(0, 40), sampleCount: comments.length, targetCount,
    cursorCount: Math.max(Number(captured.cursorCount) || 0, Number(result?.cursorCount) || 0), pageCount: Math.max(Number(captured.pageCount) || 0, Number(result?.pageCount) || 0),
    stopReason: String(comments.length >= targetCount ? "target_reached" : result?.stopReason || "no_growth").slice(0, 80),
    sortMode: String(result?.sortMode || "current-page-order").slice(0, 80), warnings: [...(captured.pageCount > 0 && comments.length >= targetCount ? [] : Array.isArray(result?.warnings) ? result.warnings : []), ...captured.warnings].map((v) => String(v).slice(0, 200)).slice(0, 10),
    collectedAt: new Date().toISOString(), continuationAvailable: comments.length > 0 && comments.length < 200,
  };
}

async function preparePlayback(body, requestId) {
  const target = classifyUrl(body?.url);
  if (!target) throw Object.assign(new Error("Only supported platform URLs are allowed"), { code: "UNSUPPORTED_REDIRECT", status: 400 });
  const name = await ensureBrowser(target.platform, target.url, requestId);
  const script = await emittedScript(target.platform, "playback", 1);
  const result = parseBrowserResult(await run(browserAct, ["--session", name, "eval", "--stdin"], script, 30000, requestId));
  if (!result?.playerReady) throw Object.assign(new Error("Player is not ready"), { code: "NETWORK_RESPONSE_CHANGED" });
  return { ...result, type: "PLAYBACK_READY", platform: target.platform };
}

const server = http.createServer(async (request, response) => {
  const origin = String(request.headers.origin || "");
  if (!allowExtensionOrigin(origin)) return json(response, 403, { ok: false, code: "EXTENSION_ORIGIN_REQUIRED" });
  if (request.method === "OPTIONS") {
    response.writeHead(204, { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "600", vary: "Origin" });
    return response.end();
  }
  if (request.method === "GET" && request.url === "/v1/health") return json(response, 200, { ok: true, version: "0.6.0", browserAct: "installed", chromeDirect: Boolean(directBrowserId), paired: Boolean(session && session.expiresAt > Date.now()), platformStatus }, origin);
  let body;
  try { body = await readBody(request); } catch (error) { return json(response, error.status || 400, { ok: false, code: error.message }, origin); }
  if (request.method === "POST" && request.url === "/v1/pair") {
    if (String(body?.code || "") !== pairingCode) return json(response, 401, { ok: false, code: "PAIRING_REQUIRED" }, origin);
    session = makeSession(); return json(response, 200, { ok: true, token: session.raw, expiresAt: new Date(session.expiresAt).toISOString() }, origin);
  }
  const bearer = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!tokenMatches(session, bearer)) return json(response, 401, { ok: false, code: "PAIRING_REQUIRED" }, origin);
  const requestId = typeof body?.requestId === "string" ? body.requestId.slice(0, 80) : "";
  if (!requestId) return json(response, 400, { ok: false, code: "REQUEST_ID_REQUIRED" }, origin);
  if (request.method === "POST" && request.url === "/v1/cancel") {
    const child = running.get(requestId);
    cancelled.add(requestId);
    if (child) child.kill();
    running.delete(requestId);
    return json(response, 200, { ok: true, cancelled: Boolean(child) }, origin);
  }
  cancelled.delete(requestId);
  try {
    if (request.method === "POST" && request.url === "/v1/comments") return json(response, 200, { ok: true, payload: await collect(body, requestId) }, origin);
    if (request.method === "POST" && request.url === "/v1/playback/prepare") return json(response, 200, { ok: true, evidence: await preparePlayback(body, requestId) }, origin);
    return json(response, 404, { ok: false, code: "NOT_FOUND" }, origin);
  } catch (error) {
    const code = String(error?.code || "BROWSERACT_UNAVAILABLE");
    const step = ["browser_prepare", "skill_emit", "collector_eval", "network_receipt", "network_replay"].includes(error?.step) ? error.step : "companion";
    return json(response, error?.status || 502, { ok: false, code, step, recoverable: !["CAPTCHA_REQUIRED", "HTTP_403", "HTTP_429"].includes(code) }, origin);
  } finally {
    cancelled.delete(requestId);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Shotprint companion 0.6.0 listening on http://${HOST}:${PORT}`);
  console.log(`Pairing code: ${pairingCode} (expires when this process stops)`);
  if (!directBrowserId) console.log("Set SHOTPRINT_BROWSER_ID to the local chrome-direct id before collecting.");
});
