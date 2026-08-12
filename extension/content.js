const host = location.hostname.toLowerCase();
const isSite = host === "shotprint.xyz" || host === "shotprint-ai-film.lixiangjia27.chatgpt.site" || host === "localhost";
const platform = host.includes("douyin") || host.includes("iesdouyin") ? "douyin" : host.includes("bilibili") || host === "b23.tv" ? "bilibili" : host.includes("xiaohongshu") || host === "xhslink.com" ? "xiaohongshu" : "unknown";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function cleanCommentText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().replace(/^回复\s+@[^:：]{1,80}[:：]\s*/, "").replace(/@[^\s，。,:：；;!?！？]{1,40}/g, "@匿名用户").slice(0, 2000);
}

function visible(element) {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
}

function selectorsFor(name) {
  if (name === "douyin") return ["[data-e2e='comment-item'] [data-e2e='comment-content']", "[data-e2e='comment-item'] .comment-content"];
  if (name === "xiaohongshu") return ["[data-testid='comment-item'] [data-testid='comment-content']", ".comment-item .comment-content"];
  return [];
}

function pageBlockReason() {
  const title = String(document.title || "").replace(/\s+/g, " ").trim();
  const gateText = [title, ...[...document.querySelectorAll("h1, h2, [role='alert'], [role='dialog']")]
    .slice(0, 20)
    .map((element) => String(element.textContent || "").replace(/\s+/g, " ").trim())]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 4000);
  if (document.querySelector("iframe[src*='captcha' i], iframe[src*='verify' i], [id*='captcha' i], [class*='captcha' i], [class*='geetest' i]") || /请完成(?:安全)?验证|拖动滑块完成拼图|安全验证(?:中|失败)?/.test(gateText)) return "CAPTCHA_REQUIRED";
  if (/^(?:403(?:\s+(?:forbidden|error))?|forbidden|access denied)(?:\s*[-|:].*)?$/i.test(title) || /sorry,? you have been blocked|error\s*403\s*[:|-]?\s*forbidden|403\s+forbidden|请求被拒绝|访问被拒绝/i.test(gateText)) return "HTTP_403";
  if (/^(?:429(?:\s+(?:too many requests|error))?|too many requests)(?:\s*[-|:].*)?$/i.test(title) || /error\s*429|429\s+too many requests|请求过于频繁|操作过于频繁/i.test(gateText)) return "HTTP_429";
  if (/登录后(?:才能)?查看评论|请先登录(?:后)?查看评论|登录后参与评论/.test(gateText)) return "LOGIN_WALL";
  return "";
}

function deepFind(root, tagName) {
  const matches = [];
  if (!root) return matches;
  for (const element of root.querySelectorAll("*")) {
    if (element.tagName.toLowerCase() === tagName) matches.push(element);
    if (element.shadowRoot) matches.push(...deepFind(element.shadowRoot, tagName));
  }
  return matches;
}

function parseCount(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const number = Number.parseFloat(normalized.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(number)) return undefined;
  if (normalized.includes("万") || normalized.includes("w")) return Math.round(number * 10000);
  return Math.round(number);
}

function extractBilibiliRenderer(renderer, id, replyTo) {
  const root = renderer.shadowRoot;
  if (!root) return null;
  const richText = root.querySelector("bili-rich-text")?.shadowRoot?.querySelector("#contents");
  const text = cleanCommentText(richText?.textContent);
  if (!text) return null;
  const actions = root.querySelector("bili-comment-action-buttons-renderer")?.shadowRoot;
  const likes = parseCount(actions?.querySelector("#count")?.textContent);
  const timeLabel = (actions?.querySelector("#pubdate")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 32) || undefined;
  return { id, text, likes, timeLabel, replyTo, source: "extension" };
}

function collectBilibiliComments(deadline) {
  const commentsRoot = document.querySelector("bili-comments")?.shadowRoot;
  if (!commentsRoot) return [];
  const comments = [];
  const seen = new Set();
  const threads = deepFind(commentsRoot, "bili-comment-thread-renderer");
  threads.forEach((thread, threadIndex) => {
    if (Date.now() >= deadline || comments.length >= 200 || !thread.shadowRoot) return;
    const parentId = `bilibili-${threadIndex + 1}`;
    const parent = deepFind(thread.shadowRoot, "bili-comment-renderer")[0];
    const parentComment = parent ? extractBilibiliRenderer(parent, parentId) : null;
    if (parentComment && !seen.has(parentComment.text)) { seen.add(parentComment.text); comments.push(parentComment); }
    deepFind(thread.shadowRoot, "bili-comment-reply-renderer").forEach((reply, replyIndex) => {
      if (Date.now() >= deadline || comments.length >= 200) return;
      const comment = extractBilibiliRenderer(reply, `${parentId}-reply-${replyIndex + 1}`, parentComment ? parentId : undefined);
      if (comment && !seen.has(comment.text)) { seen.add(comment.text); comments.push(comment); }
    });
  });
  return comments;
}

async function prepareBilibiliComments(deadline) {
  const component = document.querySelector("bili-comments");
  if (!component) return false;
  if (!deepFind(component.shadowRoot, "bili-comment-renderer").length) component.scrollIntoView({ behavior: "smooth", block: "start" });
  const waitUntil = Math.min(deadline, Date.now() + 8000);
  while (Date.now() < waitUntil) {
    if (deepFind(component.shadowRoot, "bili-comment-renderer").length) return true;
    await delay(250);
  }
  return false;
}

function collectStandardComments(deadline) {
  const seen = new Set();
  const comments = [];
  selectorsFor(platform).flatMap((selector) => [...document.querySelectorAll(selector)]).forEach((element, index) => {
    if (Date.now() >= deadline || comments.length >= 200 || !visible(element)) return;
    const text = cleanCommentText(element.textContent);
    if (!text || text.length < 2 || seen.has(text)) return;
    seen.add(text);
    comments.push({ id: `${platform}-${index + 1}`, text, source: "extension" });
  });
  return comments;
}

async function collectPage() {
  const deadline = Date.now() + 90000;
  const blockedReason = pageBlockReason();
  if (blockedReason) return { url: location.href, platform, title: document.title.slice(0, 200), comments: [], totalVisible: 0, collectedAt: new Date().toISOString(), warnings: [blockedReason + "：已停止采集，不绕过平台风控。"] };
  if (platform === "bilibili") await prepareBilibiliComments(deadline);
  let comments = platform === "bilibili" ? collectBilibiliComments(deadline) : collectStandardComments(deadline);
  for (let scroll = 0; scroll < 5 && Date.now() < deadline && comments.length < 200; scroll += 1) {
    window.scrollBy({ top: Math.max(400, window.innerHeight * 0.8), behavior: "instant" });
    await delay(350);
    if (pageBlockReason()) break;
    comments = platform === "bilibili" ? collectBilibiliComments(deadline) : collectStandardComments(deadline);
  }
  comments = [...new Map(comments.map((comment) => [comment.text, comment])).values()].slice(0, 200);
  const title = document.querySelector("meta[property='og:title']")?.getAttribute("content") || document.title || "";
  const author = document.querySelector("meta[name='author']")?.getAttribute("content") || undefined;
  const publishedAt = document.querySelector("meta[property='video:release_date']")?.getAttribute("content") || undefined;
  const coverUrl = document.querySelector("meta[property='og:image']")?.getAttribute("content") || undefined;
  const warnings = [];
  if (Date.now() >= deadline) warnings.push("采集达到90秒上限，已停止。");
  if (!comments.length) warnings.push(platform === "bilibili" ? "已识别B站视频，但评论组件没有加载出可读评论。请在原页确认评论可见后返回镜谱重试，或改用手动评论。" : "当前页面未找到已加载的可见评论；未无限滚动或绕过验证码。");
  return { url: location.href, platform, title: title.slice(0, 200), author: author?.slice(0, 100), publishedAt, coverUrl, comments, totalVisible: comments.length, collectedAt: new Date().toISOString(), warnings };
}

if (isSite) {
  const announceBridge = () => window.postMessage({ type: "shotprint:bridge-ready", version: chrome.runtime.getManifest().version }, "*");
  announceBridge();
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "shotprint:ping") { announceBridge(); return; }
    if (event.data?.type !== "shotprint:collect") return;
    chrome.runtime.sendMessage({ type: "shotprint:open", url: event.data.url, requestId: event.data.requestId }, () => {
      if (chrome.runtime.lastError) window.postMessage({ type: "shotprint:error", requestId: event.data.requestId, error: "取证桥没有响应。请在扩展管理页重新加载扩展，然后刷新镜谱网页。" }, "*");
    });
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "shotprint:progress") window.postMessage({ type: "shotprint:progress", stage: message.stage, requestId: message.requestId }, "*");
    if (message?.type === "shotprint:comments") window.postMessage({ type: "shotprint:comments", payload: message.payload, requestId: message.requestId }, "*");
    if (message?.type === "shotprint:error") window.postMessage({ type: "shotprint:error", error: message.error, requestId: message.requestId }, "*");
  });
} else if (platform !== "unknown") {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "shotprint:collect-page") return;
    chrome.runtime.sendMessage({ type: "shotprint:progress", stage: 2, requestId: message.requestId });
    void collectPage().then((payload) => chrome.runtime.sendMessage({ type: "shotprint:comments", payload, requestId: message.requestId })).catch(() => chrome.runtime.sendMessage({ type: "shotprint:comments", requestId: message.requestId, payload: { url: location.href, platform, comments: [], warnings: ["页面评论读取失败，请刷新原页后重试。"] } }));
  });
}
