// Legacy diagnostic vocabulary retained for migration: 原页面没有加载取证脚本；评论组件没有在限定时间内返回结果。
const jobs = new Map();
const sitePorts = new Map();
const collectionSessions = new Map();
let companionSession = null;
const SESSION_TTL_MS = 10 * 60 * 1000;
const SOURCE_LOAD_TIMEOUT_MS = 50000;
const SOURCE_ROUTE_STABLE_MS = 2500;
const COLLECTION_HARD_TIMEOUT_MS = 100000;
const TERMINAL_DELIVERY_RETRY_MS = 800;
const TERMINAL_DELIVERY_ATTEMPTS = 4;
const COMPANION_URL = "http://127.0.0.1:43129";
const SITE_ORIGINS = [
  "https://shotprint.xyz/*",
  "https://shotprint-ai-film.lixiangjia27.chatgpt.site/*",
  "http://localhost/*",
];
const PLATFORM_ORIGINS = [
  "https://www.douyin.com/*", "https://*.douyin.com/*", "https://*.bilibili.com/*", "https://b23.tv/*",
  "https://www.xiaohongshu.com/*", "https://xhslink.com/*",
];

function platformHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "b23.tv" || host === "xhslink.com" || host === "douyin.com" || host.endsWith(".douyin.com") || host === "iesdouyin.com" || host.endsWith(".iesdouyin.com") || host === "bilibili.com" || host.endsWith(".bilibili.com") || host === "xiaohongshu.com" || host.endsWith(".xiaohongshu.com");
  } catch { return false; }
}

function platformName(url) {
  try {
    const host = new URL(url).hostname;
    if (host === "douyin.com" || host.endsWith(".douyin.com") || host === "iesdouyin.com" || host.endsWith(".iesdouyin.com")) return "douyin";
    if (host === "b23.tv" || host === "bilibili.com" || host.endsWith(".bilibili.com")) return "bilibili";
    if (host === "xhslink.com" || host === "xiaohongshu.com" || host.endsWith(".xiaohongshu.com")) return "xiaohongshu";
  } catch { /* invalid URLs are rejected by the caller */ }
  return "unknown";
}

function shortHost(url) {
  try { const host = new URL(url).hostname.toLowerCase(); return host === "v.douyin.com" || host === "b23.tv" || host === "xhslink.com"; } catch { return false; }
}

function supportedVideoPage(url) {
  try {
    const parsed = new URL(url);
    const platform = platformName(url);
    if (platform === "douyin") {
      if (/^\/(?:video|share\/video)\/\d+/.test(parsed.pathname)) return true;
      const candidates = ["modal_id", "aweme_id", "item_id"];
      if (candidates.some((key) => /^\d{6,}$/.test(parsed.searchParams.get(key) || ""))) return true;
      const hashQuery = parsed.hash.includes("?") ? parsed.hash.slice(parsed.hash.indexOf("?") + 1) : parsed.hash.replace(/^#/, "");
      const hashParams = new URLSearchParams(hashQuery);
      return candidates.some((key) => /^\d{6,}$/.test(hashParams.get(key) || ""));
    }
    if (platform === "bilibili") return /^\/video\/(?:BV|av)[a-zA-Z0-9]+/i.test(parsed.pathname);
    if (platform === "xiaohongshu") return /^\/(?:discovery\/item|explore|search_result)\/[a-zA-Z0-9]+/.test(parsed.pathname);
  } catch { /* invalid */ }
  return false;
}

function sendToSite(job, message) {
  const payload = { ...message, platform: message.platform || platformName(job.finalUrl || job.requestedUrl), requestId: job.requestId };
  const port = sitePorts.get(job.siteTabId);
  if (port) {
    try { port.postMessage(payload); return; } catch { sitePorts.delete(job.siteTabId); }
  }
  chrome.tabs.sendMessage(job.siteTabId, payload, () => void chrome.runtime.lastError);
}

function finish(sourceTabId) {
  const job = jobs.get(sourceTabId);
  if (job?.timeoutId) clearTimeout(job.timeoutId);
  if (job?.deliveryTimeoutId) clearTimeout(job.deliveryTimeoutId);
  jobs.delete(sourceTabId);
  return job;
}

function armJobTimeout(job, timeoutMs, code, step, userMessage) {
  if (job.timeoutId) clearTimeout(job.timeoutId);
  job.timeoutId = setTimeout(() => fail(job, code, step, userMessage), timeoutMs);
}

function deliverTerminal(job, message) {
  if (job.timeoutId) clearTimeout(job.timeoutId);
  job.timeoutId = null;
  job.terminalMessage = message;
  job.deliveryAttempts = 0;
  const deliver = () => {
    if (!jobs.has(job.sourceTabId)) return;
    job.deliveryAttempts += 1;
    sendToSite(job, message);
    if (job.deliveryAttempts >= TERMINAL_DELIVERY_ATTEMPTS) {
      job.deliveryTimeoutId = setTimeout(() => finish(job.sourceTabId), TERMINAL_DELIVERY_RETRY_MS);
      return;
    }
    job.deliveryTimeoutId = setTimeout(deliver, TERMINAL_DELIVERY_RETRY_MS);
  };
  deliver();
}

function errorPayload(code, step, userMessage, recoverable = true) {
  return { code, step, recoverable, userMessage };
}

async function companionRequest(path, body, useToken = true, timeoutMs = 100000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${COMPANION_URL}${path}`, {
      method: path === "/v1/health" ? "GET" : "POST",
      headers: { "content-type": "application/json", ...(useToken && companionSession?.token ? { authorization: `Bearer ${companionSession.token}` } : {}) },
      ...(path === "/v1/health" ? {} : { body: JSON.stringify(body || {}) }), signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) throw Object.assign(new Error(payload?.code || `HTTP_${response.status}`), { code: payload?.code || `HTTP_${response.status}`, status: response.status });
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error("companion-timeout"), { code: "BROWSERACT_UNAVAILABLE" });
    if (error instanceof TypeError) throw Object.assign(new Error("companion-not-running"), { code: "COMPANION_NOT_RUNNING" });
    throw error;
  } finally { clearTimeout(timeoutId); }
}

function companionErrorMessage(code) {
  const messages = {
    COMPANION_NOT_RUNNING: "页面适配器失败，且本地BrowserAct伴侣未运行。请启动伴侣后配对，或改用手动评论。",
    PAIRING_REQUIRED: "本地伴侣尚未配对或会话已过期，请输入启动窗口显示的6位配对码。",
    BROWSERACT_UNAVAILABLE: "本地伴侣已连接，但BrowserAct或Chrome直连当前不可用。",
    NETWORK_RESPONSE_CHANGED: "平台评论接口结构已经变化，BrowserAct网络策略未返回可用评论；请改用DOM或手动导入。",
    LOGIN_REQUIRED: "原页面要求登录后才能读取评论。",
    CAPTCHA_REQUIRED: "原页面要求验证码，采集已停止。",
    HTTP_403: "原页面返回403，采集已停止。",
    HTTP_429: "原页面返回429，采集已停止。",
  };
  return messages[code] || "BrowserAct本地取证没有返回结果。";
}

async function collectViaCompanion(job, triggerCode) {
  sendToSite(job, { type: "shotprint:progress", stage: 3, detail: `browser-act-fallback:${triggerCode}` });
  try {
    const result = await companionRequest("/v1/comments", { requestId: job.requestId, url: job.finalUrl || job.requestedUrl, targetCount: job.targetCount });
    const payload = { ...result.payload, collectionId: job.collectionId, warnings: [...(result.payload?.warnings || []), `页面适配器${triggerCode}，已改用BrowserAct本地取证。`] };
    const terminal = { type: "shotprint:comments", payload };
    if (payload.continuationAvailable) collectionSessions.set(job.collectionId, { siteTabId: job.siteTabId, sourceTabId: job.sourceTabId, requestedUrl: job.requestedUrl, finalUrl: job.finalUrl, collectionId: job.collectionId, engine: "companion", expiresAt: Date.now() + SESSION_TTL_MS });
    else collectionSessions.delete(job.collectionId);
    deliverTerminal(job, terminal);
  } catch (error) {
    const code = error?.code || "BROWSERACT_UNAVAILABLE";
    if (["COMPANION_NOT_RUNNING", "PAIRING_REQUIRED", "BROWSERACT_UNAVAILABLE"].includes(code)) {
      const primaryMessages = {
        PLATFORM_LAYOUT_CHANGED: "页面已打开，但扩展没有找到可读评论。请确认目标视频的评论面板已经打开；也可以直接使用手动评论导入。高级BrowserAct兜底未启动不影响扩展主通道。",
        INJECTION_FAILED: "取证脚本没有成功进入原视频页。请确认扩展拥有该平台的网站权限，然后重试或使用手动评论导入。",
        SOURCE_HANDSHAKE_TIMEOUT: "原视频页没有完成取证握手。请确认当前页面确实是目标视频详情页，然后重试或使用手动评论导入。",
      };
      return void fail(job, triggerCode, "primary-collector", primaryMessages[triggerCode] || "扩展主采集没有取得评论，已保留手动导入入口。BrowserAct高级兜底未启动不会阻止主流程。" );
    }
    fail(job, code, "companion", companionErrorMessage(code));
  }
}

function fail(job, code, step, userMessage) {
  if (job.terminalMessage) return;
  deliverTerminal(job, { type: "shotprint:error", ...errorPayload(code, step, userMessage) });
}

function sendTabMessage(tabId, message, timeoutMs = 1800) {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => { if (!settled) { settled = true; resolve({ ok: false, reason: "timeout" }); } }, timeoutMs);
    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timeoutId);
      if (settled) return;
      settled = true;
      if (chrome.runtime.lastError) resolve({ ok: false, reason: chrome.runtime.lastError.message || "no_receiver" });
      else resolve(response || { ok: false, reason: "empty_response" });
    });
  });
}

async function waitForLoadedSource(tabId, requestedUrl, timeoutMs = SOURCE_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stableTimer = null;
    let lastCandidateUrl = "";
    const requestedPlatform = platformName(requestedUrl);
    const cleanup = () => { clearTimeout(timeoutId); if (stableTimer) clearTimeout(stableTimer); chrome.tabs.onUpdated.removeListener(listener); };
    const rejectOnce = (error) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const resolveOnce = (tab) => { if (settled) return; settled = true; cleanup(); resolve(tab); };
    const check = (tab) => {
      const url = tab?.pendingUrl || tab?.url || requestedUrl;
      if (!platformHost(url) || platformName(url) !== requestedPlatform || shortHost(url)) return;
      const strongRoute = supportedVideoPage(url);
      if (strongRoute && tab?.status === "complete") return resolveOnce({ ...tab, url });
      if (lastCandidateUrl === url && stableTimer) return;
      lastCandidateUrl = url;
      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = setTimeout(() => {
        chrome.tabs.get(tabId, (currentTab) => {
          if (chrome.runtime.lastError) return rejectOnce(new Error("SOURCE_TAB_CLOSED"));
          const currentUrl = currentTab?.pendingUrl || currentTab?.url || "";
          if (!platformHost(currentUrl) || platformName(currentUrl) !== requestedPlatform || shortHost(currentUrl)) return;
          if (currentUrl === lastCandidateUrl || supportedVideoPage(currentUrl)) resolveOnce({ ...currentTab, url: currentUrl });
        });
      }, strongRoute ? 800 : SOURCE_ROUTE_STABLE_MS);
    };
    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete" || changeInfo.url) check({ ...tab, status: changeInfo.status || tab.status, url: changeInfo.url || tab.url, pendingUrl: changeInfo.url || tab.pendingUrl });
    };
    const timeoutId = setTimeout(() => rejectOnce(new Error("SOURCE_LOAD_TIMEOUT")), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) rejectOnce(new Error("SOURCE_TAB_CLOSED"));
      else check(tab);
    });
  });
}

async function injectAndHandshake(job) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: job.sourceTabId }, files: ["collector.js"] });
  } catch (error) {
    const message = String(error?.message || error || "");
    if (/Cannot access contents|permission|host permission|not allowed/i.test(message)) throw Object.assign(new Error(message), { code: "SITE_ACCESS_DENIED" });
    if (/No tab|closed|invalid tab/i.test(message)) throw Object.assign(new Error(message), { code: "SOURCE_TAB_CLOSED" });
    throw Object.assign(new Error(message), { code: "INJECTION_FAILED" });
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await sendTabMessage(job.sourceTabId, { type: "shotprint:source-ping", requestId: job.requestId });
    if (response?.ok) {
      const manifest = chrome.runtime.getManifest();
      const expectedVersion = manifest.version_name || manifest.version;
      if (response.version !== expectedVersion) throw Object.assign(new Error("collector-version-mismatch"), { code: "EXTENSION_VERSION_MISMATCH" });
      sendToSite(job, { type: "shotprint:progress", stage: 2, detail: "source-ready" });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Object.assign(new Error("source-handshake-timeout"), { code: "SOURCE_HANDSHAKE_TIMEOUT" });
}

async function startCollection(job) {
  try {
    if (job.mode !== "continue") {
      const tab = await waitForLoadedSource(job.sourceTabId, job.requestedUrl);
      job.finalUrl = tab.url || job.requestedUrl;
      sendToSite(job, { type: "shotprint:progress", stage: 2, detail: "page-ready" });
    }
    await injectAndHandshake(job);
    sendToSite(job, { type: "shotprint:progress", stage: 3 });
    armJobTimeout(job, COLLECTION_HARD_TIMEOUT_MS, "COLLECTION_TIMEOUT", "collect", "评论采集达到100秒硬上限，已停止并保留手动导入入口。");
    const response = await sendTabMessage(job.sourceTabId, { type: "shotprint:collect-page", requestId: job.requestId, targetCount: job.targetCount }, 2500);
    if (!response?.accepted) throw Object.assign(new Error(response?.reason || "collector-not-ready"), { code: "INJECTION_FAILED" });
  } catch (error) {
    const code = error?.code || (error?.message === "SOURCE_LOAD_TIMEOUT" ? "SOURCE_LOAD_TIMEOUT" : "INJECTION_FAILED");
    const messages = {
      SOURCE_LOAD_TIMEOUT: "原视频页90秒内没有加载完成，请检查网络后重试。",
      SOURCE_TAB_CLOSED: "原视频标签页已关闭，采集已停止。",
      SITE_ACCESS_DENIED: "扩展没有获得原视频平台的网站权限；请在扩展详情把网站访问权限设为“在所有请求的网站上”。",
      EXTENSION_VERSION_MISMATCH: "原视频页使用了旧版取证脚本，请重新加载0.6.9扩展后刷新镜谱网页。",
      SOURCE_HANDSHAKE_TIMEOUT: "脚本已尝试注入，但原视频页没有返回取证握手；请确认页面不是验证码、403、429或登录墙。",
      INJECTION_FAILED: "取证脚本注入失败；请在扩展详情检查错误并重试。",
    };
    if (["INJECTION_FAILED", "SOURCE_HANDSHAKE_TIMEOUT", "SITE_ACCESS_DENIED"].includes(code)) return void collectViaCompanion(job, code);
    fail(job, code, "inject", messages[code] || "原视频页取证失败，请重试。");
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "shotprint:site-bridge" || !port.sender?.tab?.id) return;
  const siteTabId = port.sender.tab.id;
  sitePorts.set(siteTabId, port);
  port.onMessage.addListener((message) => {
    if (message?.type === "shotprint:receipt-ack" && message.requestId) {
      const job = [...jobs.values()].find((candidate) => candidate.siteTabId === siteTabId && candidate.requestId === message.requestId && candidate.terminalMessage);
      if (job) finish(job.sourceTabId);
      return;
    }
    if (!["shotprint:site-ready", "shotprint:heartbeat"].includes(message?.type)) return;
    try { port.postMessage({ type: "shotprint:bridge-alive", activeJobs: [...jobs.values()].filter((job) => job.siteTabId === siteTabId).length }); } catch { /* disconnect cleanup handles this */ }
  });
  port.onDisconnect.addListener(() => {
    if (sitePorts.get(siteTabId) === port) sitePorts.delete(siteTabId);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "shotprint:companion-health") {
    companionRequest("/v1/health", null, false, 2500).then((payload) => sendResponse({ ok: true, ...payload })).catch((error) => sendResponse({ ok: false, code: error?.code || "COMPANION_NOT_RUNNING" }));
    return true;
  }
  if (message?.type === "shotprint:pair") {
    companionRequest("/v1/pair", { code: String(message.code || "").slice(0, 6) }, false, 5000).then((payload) => { companionSession = { token: payload.token, expiresAt: payload.expiresAt }; sendResponse({ ok: true, expiresAt: payload.expiresAt }); }).catch((error) => sendResponse({ ok: false, code: error?.code || "PAIRING_REQUIRED" }));
    return true;
  }
  if (message?.type === "shotprint:playback-prepare") {
    companionRequest("/v1/playback/prepare", { requestId: message.requestId, url: message.url }).then((payload) => sendResponse(payload)).catch((error) => sendResponse({ ok: false, code: error?.code || "BROWSERACT_UNAVAILABLE" }));
    return true;
  }
  if (message?.type === "shotprint:cancel") {
    companionRequest("/v1/cancel", { requestId: message.requestId }).then((payload) => sendResponse(payload)).catch((error) => sendResponse({ ok: false, code: error?.code || "BROWSERACT_UNAVAILABLE" }));
    return true;
  }
  if (message?.type === "shotprint:cancel-collection") {
    const job = [...jobs.values()].find((candidate) => candidate.siteTabId === sender.tab?.id && candidate.requestId === message.requestId);
    if (job) finish(job.sourceTabId);
    sendResponse({ ok: true, cancelled: Boolean(job) });
    return;
  }
  if (message?.type === "shotprint:diagnose") {
    Promise.all([...SITE_ORIGINS, ...PLATFORM_ORIGINS].map((origin) => new Promise((resolve) => chrome.permissions.contains({ origins: [origin] }, resolve))))
      .then(async (permissions) => { const manifest = chrome.runtime.getManifest(); const companion = await companionRequest("/v1/health", null, false, 1500).catch((error) => ({ ok: false, code: error?.code || "COMPANION_NOT_RUNNING" })); return sendResponse({ version: manifest.version_name || manifest.version, bridge: "ready", permissions: Object.fromEntries([...SITE_ORIGINS, ...PLATFORM_ORIGINS].map((origin, index) => [origin, Boolean(permissions[index])])), activeJobs: jobs.size, companion: { ...companion, paired: Boolean(companionSession?.token) } }); })
      .catch(() => { const manifest = chrome.runtime.getManifest(); return sendResponse({ version: manifest.version_name || manifest.version, bridge: "ready", permissions: {}, activeJobs: jobs.size }); });
    return true;
  }
  if (message?.type === "shotprint:continue") {
    const siteTabId = sender.tab?.id;
    const session = collectionSessions.get(message.collectionId);
    if (!siteTabId || !message.requestId || !session || session.siteTabId !== siteTabId || session.expiresAt <= Date.now()) {
      if (session) collectionSessions.delete(message.collectionId);
      const error = errorPayload("COLLECTION_SESSION_EXPIRED", "continue", "续采会话已过期或原标签页已关闭，请重新从100条开始采集。");
      if (siteTabId) chrome.tabs.sendMessage(siteTabId, { type: "shotprint:error", requestId: message.requestId, ...error }, () => void chrome.runtime.lastError);
      sendResponse({ accepted: false, error });
      return;
    }
    if (jobs.has(session.sourceTabId)) {
      const error = errorPayload("DUPLICATE_REQUEST", "continue", "续采任务已经在运行，请等待当前任务完成。");
      sendResponse({ accepted: false, error });
      return;
    }
    const job = { ...session, requestId: message.requestId, mode: "continue", targetCount: 200, timeoutId: null, deliveryTimeoutId: null };
    jobs.set(job.sourceTabId, job);
    armJobTimeout(job, COLLECTION_HARD_TIMEOUT_MS, "COLLECTION_TIMEOUT", "timeout", "续采达到100秒硬上限，已停止并保留现有样本。");
    sendResponse({ accepted: true });
    sendToSite(job, { type: "shotprint:progress", stage: 3, detail: "continue-to-200" });
    if (session.engine === "companion") void collectViaCompanion(job, "continue"); else void startCollection(job);
    return;
  }
  if (message?.type !== "shotprint:open") return;
  if (!message.url || !message.requestId || !sender.tab?.id || !platformHost(message.url)) {
    if (sender.tab?.id) chrome.tabs.sendMessage(sender.tab.id, { type: "shotprint:error", requestId: message.requestId, ...errorPayload("UNSUPPORTED_REDIRECT", "validate", "链接平台无法识别，请粘贴抖音、B站或小红书原链接。") }, () => void chrome.runtime.lastError);
    sendResponse({ accepted: false, error: errorPayload("UNSUPPORTED_REDIRECT", "validate", "链接平台无法识别，请粘贴抖音、B站或小红书原链接。") });
    return;
  }
  const siteTabId = sender.tab.id;
  if ([...jobs.values()].some((job) => job.siteTabId === siteTabId)) {
    const error = errorPayload("DUPLICATE_REQUEST", "validate", "已有采集任务正在运行，请等待它结束或刷新网页后重试。");
    chrome.tabs.sendMessage(siteTabId, { type: "shotprint:error", requestId: message.requestId, ...error }, () => void chrome.runtime.lastError);
    sendResponse({ accepted: false, error });
    return;
  }
  sendResponse({ accepted: true });
  chrome.tabs.create({ url: message.url, active: true }, (sourceTab) => {
    if (chrome.runtime.lastError || !sourceTab.id) {
      const error = errorPayload("SOURCE_TAB_CLOSED", "open", "无法打开原视频页，请检查浏览器是否阻止扩展打开新标签页。");
      chrome.tabs.sendMessage(siteTabId, { type: "shotprint:error", requestId: message.requestId, ...error }, () => void chrome.runtime.lastError);
      return;
    }
    const sourceTabId = sourceTab.id;
    const job = { siteTabId, sourceTabId, requestedUrl: message.url, requestId: message.requestId, collectionId: message.requestId, mode: "initial", targetCount: 100, timeoutId: null, deliveryTimeoutId: null };
    jobs.set(sourceTabId, job);
    armJobTimeout(job, SOURCE_LOAD_TIMEOUT_MS, "SOURCE_LOAD_TIMEOUT", "load", "原视频页50秒内没有进入可采集状态，已停止并保留手动导入入口。");
    sendToSite(job, { type: "shotprint:progress", stage: 1 });
    void startCollection(job);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const job = jobs.get(tabId);
  if (job && !job.terminalMessage) fail(job, "SOURCE_TAB_CLOSED", "source", "原视频标签页已关闭，采集已停止。");
  for (const [collectionId, session] of collectionSessions.entries()) if (session.sourceTabId === tabId) collectionSessions.delete(collectionId);
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.tab?.id || !["shotprint:comments", "shotprint:progress", "shotprint:error"].includes(message?.type)) return;
  const job = jobs.get(sender.tab.id);
  if (!job || message.requestId !== job.requestId) return;
  if (message.type === "shotprint:error" && !["CAPTCHA_REQUIRED", "HTTP_403", "HTTP_429", "LOGIN_WALL"].includes(message.code) && ["PLATFORM_LAYOUT_CHANGED", "INJECTION_FAILED", "SOURCE_HANDSHAKE_TIMEOUT"].includes(message.code)) {
    void collectViaCompanion(job, message.code);
    return;
  }
  const outgoing = message.type === "shotprint:comments"
    ? { ...message, payload: { ...message.payload, engine: message.payload?.engine || "extension-dom", strategyVersion: message.payload?.strategyVersion || "extension-dom-v0.6.9", sampleCount: message.payload?.comments?.length || 0, pageCount: message.payload?.pageCount || 0, cursorCount: message.payload?.cursorCount || 0, collectionId: job.collectionId } }
    : message;
  if (message.type === "shotprint:progress") {
    sendToSite(job, outgoing);
    return;
  }
  if (message.type === "shotprint:comments" && message.payload?.continuationAvailable) {
    collectionSessions.set(job.collectionId, { siteTabId: job.siteTabId, sourceTabId: job.sourceTabId, requestedUrl: job.requestedUrl, finalUrl: job.finalUrl, collectionId: job.collectionId, expiresAt: Date.now() + SESSION_TTL_MS });
  } else if (message.type === "shotprint:comments") {
    collectionSessions.delete(job.collectionId);
  }
  deliverTerminal(job, outgoing);
});
