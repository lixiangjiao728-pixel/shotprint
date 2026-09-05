(() => {
  if (globalThis.__SHOTPRINT_COLLECTOR_V071__) return;
  globalThis.__SHOTPRINT_COLLECTOR_V071__ = true;

  const manifest = chrome.runtime.getManifest();
  const version = manifest.version_name || manifest.version;
  const host = location.hostname.toLowerCase();
  const platform = host.includes("douyin") || host.includes("iesdouyin") ? "douyin" : host.includes("bilibili") || host === "b23.tv" ? "bilibili" : host.includes("xiaohongshu") || host === "xhslink.com" ? "xiaohongshu" : "unknown";
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const sessionComments = new Map();
  let totalScrollActions = 0;
  let sessionIdentity = "";
  let collecting = false;

  function workIdentity(value) {
    const url = new URL(value);
    const id = platform === "douyin"
      ? url.searchParams.get("modal_id") || url.searchParams.get("aweme_id") || url.searchParams.get("item_id") || new URLSearchParams(url.hash.replace(/^#.*?\?/, "").replace(/^#/, "")).get("modal_id") || url.pathname.match(/\/(?:share\/)?video\/([\w-]+)/)?.[1]
      : url.pathname.match(/\/(?:video|explore|discovery\/item|search_result)\/([\w-]+)/)?.[1];
    return id ? { id, key: `${platform}:${id}${platform === "bilibili" ? `:p${url.searchParams.get("p") || "1"}` : ""}` } : null;
  }
  globalThis.__shotprintWorkIdentity = () => workIdentity(location.href);

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().replace(/^回复\s+@[^:：]{1,80}[:：]\s*/i, "").replace(/@[\w\u4e00-\u9fff-]{1,40}/g, "@匿名用户").slice(0, 2000);
  }

  function pageIdentity() {
    const meta = (selector) => cleanText(document.querySelector(selector)?.getAttribute("content"));
    const canonicalCandidate = document.querySelector("link[rel='canonical']")?.getAttribute("href") || location.href;
    let canonicalUrl = location.href;
    try { const parsed = new URL(canonicalCandidate, location.href); if (parsed.protocol === "https:" && parsed.hostname === location.hostname && workIdentity(parsed.href)?.key === workIdentity(location.href)?.key) canonicalUrl = parsed.toString(); } catch { /* keep the resolved address bar URL */ }
    const title = meta("meta[property='og:title']") || meta("meta[name='title']") || cleanText(document.querySelector("h1")?.textContent) || cleanText(document.title);
    const description = meta("meta[property='og:description']") || meta("meta[name='description']");
    const author = meta("meta[name='author']") || meta("meta[property='article:author']") || cleanText(document.querySelector("[data-e2e='video-author-name'], .author-name, .username")?.textContent);
    const publishedAt = meta("meta[property='video:release_date']") || meta("meta[property='article:published_time']");
    const coverUrl = document.querySelector("meta[property='og:image']")?.getAttribute("content") || undefined;
    const keywords = meta("meta[name='keywords']");
    const identity = workIdentity(location.href);
    const videoId = identity?.id || "";
    return { canonicalUrl, identityKey: identity?.key || "", title: title.slice(0, 200), description: description.slice(0, 500), author: author.slice(0, 100), publishedAt, coverUrl, keywords: keywords.slice(0, 240), videoId: videoId.slice(0, 80) };
  }

  function visible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function blockedReason() {
    const title = String(document.title || "").replace(/\s+/g, " ").trim();
    const body = String(document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 12000);
    const gateText = [title, ...[...document.querySelectorAll("h1, h2, [role='alert'], [role='dialog']")]
      .slice(0, 20)
      .map((element) => String(element.textContent || "").replace(/\s+/g, " ").trim())]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 4000);
    const hasCaptchaUi = [...document.querySelectorAll("iframe[src*='captcha' i], iframe[src*='verify' i], [id*='captcha' i], [class*='captcha' i], [class*='geetest' i]")]
      .some((element) => visible(element));
    if (hasCaptchaUi || /请完成(?:安全)?验证|拖动滑块完成拼图|安全验证(?:中|失败)?/.test(gateText)) return "CAPTCHA_REQUIRED";
    if (/^(?:403(?:\s+(?:forbidden|error))?|forbidden|access denied)(?:\s*[-|:].*)?$/i.test(title)
      || /sorry,? you have been blocked|error\s*403\s*[:|-]?\s*forbidden|403\s+forbidden|请求被拒绝|访问被拒绝|安全限制/i.test(gateText)) return "HTTP_403";
    if (/^(?:429(?:\s+(?:too many requests|error))?|too many requests)(?:\s*[-|:].*)?$/i.test(title)
      || /error\s*429|429\s+too many requests|请求过于频繁|操作过于频繁/i.test(gateText)) return "HTTP_429";
    if (/登录后(?:才能)?查看评论|请先登录(?:后)?查看评论|登录后参与评论/.test(gateText)
      || (/登录后查看|请先登录|登录可见/.test(body) && !document.querySelector("video, bili-comments, #commentapp, [data-e2e='comment-item'], [data-testid='comment-item']"))) return "LOGIN_WALL";
    return "";
  }

  function deepFind(root, tagName) {
    const matches = [];
    if (!root?.querySelectorAll) return matches;
    for (const element of root.querySelectorAll("*")) {
      if (element.tagName?.toLowerCase() === tagName) matches.push(element);
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

  function selectorsFor(name) {
    if (name === "douyin") return [
      "[data-e2e='comment-item'] [data-e2e='comment-content']",
      "[data-e2e='comment-item'] [data-e2e='comment-text']",
      "[data-e2e='search-comment-item'] [data-e2e='comment-content']",
      "[data-e2e='browse-comment-item'] [data-e2e='comment-content']",
      "[data-e2e='comment-item'] .comment-content",
    ];
    if (name === "xiaohongshu") return ["[data-testid='comment-item'] [data-testid='comment-content']", ".comment-item .comment-content"];
    return [];
  }

  function douyinCommentRoots() {
    const selectors = [
      "[data-e2e='comment-list']",
      "[data-e2e='comment-panel']",
      "[data-e2e='search-comment-container']",
      "[data-e2e='browse-comment-container']",
    ];
    return [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))];
  }

  function douyinCommentItems() {
    const selectors = ["[data-e2e='comment-item']", "[data-e2e='search-comment-item']", "[data-e2e='browse-comment-item']"];
    const direct = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    const scoped = douyinCommentRoots().flatMap((root) => typeof root.querySelectorAll === "function" ? selectors.flatMap((selector) => [...root.querySelectorAll(selector)]) : []);
    return [...new Set([...direct, ...scoped])];
  }

  function findDouyinCommentControl() {
    const controls = [
      "[data-e2e='video-comment-icon']",
      "[data-e2e='feed-comment-icon']",
      "[data-e2e='browse-comment-icon']",
      "[data-e2e='comment-icon']",
      "button[aria-label*='评论']",
      "[role='button'][aria-label*='评论']",
    ];
    return controls.map((selector) => document.querySelector(selector)).find((element) => element && visible(element)) || null;
  }

  function extractDouyinText(item) {
    const contentSelectors = [
      "[data-e2e='comment-content']",
      "[data-e2e='comment-text']",
      "[data-testid='comment-content']",
      "[data-e2e='comment-item-content']",
    ];
    for (const selector of contentSelectors) {
      const text = cleanText(item.querySelector(selector)?.textContent);
      if (text) return text;
    }
    for (const selector of [".comment-item-info-wrap", "[data-e2e='comment-info']"]) {
      const text = cleanText(item.querySelector(selector)?.nextElementSibling?.textContent);
      if (text) return text;
    }
    return "";
  }

  function collectStandard() {
    const comments = [];
    const seen = new Set();
    if (platform === "xiaohongshu") {
      const items = [...document.querySelectorAll(".comment-item")];
      items.filter((item) => typeof item.querySelector === "function").forEach((item, index) => {
        if (comments.length >= 200 || !visible(item)) return;
        const text = cleanText(item.querySelector(".content .note-text, .content")?.textContent);
        if (!text || text.length < 2 || seen.has(text)) return;
        seen.add(text);
        comments.push({ id: `xiaohongshu-${index + 1}`, text, likes: parseCount(item.querySelector(".like .count")?.textContent), timeLabel: cleanText(item.querySelector(".date")?.textContent).slice(0, 32) || undefined, replyTo: item.closest(".sub-comment-item") ? "匿名回复" : undefined, source: "extension" });
      });
      if (items.some((item) => typeof item.querySelector === "function")) return comments;
    }
    if (platform === "douyin") {
      const items = douyinCommentItems();
      items.filter((item) => typeof item.querySelector === "function").forEach((item, index) => {
        if (comments.length >= 200 || !visible(item)) return;
        const text = extractDouyinText(item);
        if (!text || text.length < 2 || seen.has(text)) return;
        seen.add(text);
        comments.push({ id: `douyin-${index + 1}`, text, source: "extension" });
      });
      if (items.some((item) => typeof item.querySelector === "function")) return comments;
    }
    selectorsFor(platform).flatMap((selector) => [...document.querySelectorAll(selector)]).forEach((element, index) => {
      if (comments.length >= 200 || !visible(element)) return;
      const text = cleanText(element.textContent);
      if (!text || text.length < 2 || seen.has(text)) return;
      seen.add(text);
      comments.push({ id: `${platform}-${index + 1}`, text, source: "extension" });
    });
    return comments;
  }

  function platformScroller() {
    if (platform === "xiaohongshu") {
      const note = document.querySelector(".note-scroller");
      return note && note.scrollHeight > note.clientHeight + 80 ? note : document.scrollingElement;
    }
    if (platform === "douyin") {
      let ancestor = douyinCommentItems()[0]?.parentElement || null;
      for (let depth = 0; ancestor && depth < 8; depth += 1, ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (ancestor.scrollHeight > ancestor.clientHeight + 80 && /auto|scroll|overlay/i.test(String(style.overflowY || style.overflow || ""))) return ancestor;
      }
      const routeScroller = document.querySelector(".parent-route-container.route-scroll-container");
      if (routeScroller && routeScroller.scrollHeight > routeScroller.clientHeight + 80) return routeScroller;
      const roots = douyinCommentRoots();
      return roots.find((root) => root.scrollHeight > root.clientHeight + 80)
        || document.scrollingElement;
    }
    return document.scrollingElement;
  }

  function scrollerReceipt(scroller) {
    if (!scroller) return { layer: "window", top: 0, height: 0, viewport: window.innerHeight };
    return {
      layer: scroller === document.scrollingElement ? "document" : scroller.classList?.contains("route-scroll-container") ? "douyin-route" : "nested",
      top: Math.round(Number(scroller.scrollTop || 0)),
      height: Math.round(Number(scroller.scrollHeight || 0)),
      viewport: Math.round(Number(scroller.clientHeight || 0)),
    };
  }

  async function advancePlatformPage() {
    const scroller = platformScroller();
    const before = scrollerReceipt(scroller);
    if (!scroller) {
      window.scrollBy({ top: Math.max(400, window.innerHeight * 0.8), behavior: "smooth" });
      await delay(120);
      return { before, after: scrollerReceipt(scroller), method: "window-scroll" };
    }
    if (platform === "xiaohongshu") scroller.scrollTo?.({ top: scroller.scrollHeight, behavior: "smooth" });
    else {
      const lastComment = platform === "douyin" ? douyinCommentItems().at(-1) : null;
      if (lastComment?.scrollIntoView) lastComment.scrollIntoView({ block: "end", inline: "nearest", behavior: "smooth" });
      const delta = Math.max(1000, Number(scroller.clientHeight || window.innerHeight) * 1.8);
      if (platform === "douyin" && typeof WheelEvent === "function") {
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, deltaMode: 0, bubbles: true, cancelable: true }));
      }
      if (typeof scroller.scrollBy === "function") scroller.scrollBy({ top: delta, behavior: "smooth" });
      else scroller.scrollTop = Math.min(scroller.scrollHeight, Number(scroller.scrollTop || 0) + delta);
      await delay(180);
      if (Number(scroller.scrollTop || 0) <= before.top + 1 && scroller !== document.scrollingElement) {
        const routeScroller = document.querySelector(".parent-route-container.route-scroll-container");
        if (routeScroller && routeScroller !== scroller) routeScroller.scrollBy?.({ top: Math.max(1000, routeScroller.clientHeight * 1.8), behavior: "smooth" });
        else window.scrollBy({ top: Math.max(1000, window.innerHeight * 1.8), behavior: "smooth" });
      }
    }
    await delay(120);
    return { before, after: scrollerReceipt(scroller), method: platform === "douyin" ? "wheel-and-scroll" : "smooth-scroll" };
  }

  function commentDomSignature() {
    if (platform !== "douyin") return "";
    return douyinCommentItems().filter((item) => typeof item.querySelector === "function").slice(0, 30).map((item) => extractDouyinText(item)).filter(Boolean).join("\u241e");
  }

  async function waitForCommentGrowth(previousCount, previousHeight, previousSignature, deadline) {
    for (let attempt = 0; attempt < 12 && Date.now() < deadline; attempt += 1) {
      const count = platform === "douyin" ? douyinCommentItems().length : (platform === "bilibili" ? collectBilibili().length : collectStandard().length);
      const height = Number(platformScroller()?.scrollHeight || 0);
      if (count > previousCount || height > previousHeight + 8 || (platform === "douyin" && commentDomSignature() !== previousSignature)) return;
      await delay(120);
    }
  }

  function atLoadedEnd() {
    const scroller = platformScroller();
    return !scroller || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 80;
  }

  function extractBilibili(renderer, id, replyTo) {
    const root = renderer?.shadowRoot;
    if (!root) return null;
    const richText = root.querySelector("bili-rich-text") || deepFind(root, "bili-rich-text")[0];
    const contents = richText?.shadowRoot?.querySelector("#contents, .contents") || richText;
    const text = cleanText(contents?.textContent);
    if (!text) return null;
    const actionsRenderer = root.querySelector("bili-comment-action-buttons-renderer") || deepFind(root, "bili-comment-action-buttons-renderer")[0];
    const actions = actionsRenderer?.shadowRoot;
    const timeText = actions?.querySelector("#pubdate")?.textContent || root.querySelector("#pubdate, .pubdate")?.textContent;
    return { id, text, likes: parseCount(actions?.querySelector("#count")?.textContent), timeLabel: cleanText(timeText).slice(0, 32) || undefined, replyTo, source: "extension" };
  }

  function findBilibiliComponent() {
    return document.querySelector("bili-comments, #commentapp bili-comments, #comment bili-comments");
  }

  function collectBilibiliLegacy() {
    const comments = [];
    const seen = new Set();
    const roots = [...document.querySelectorAll("#commentapp, .comment-container, .reply-list")];
    const selectors = [".root-reply-container .reply-content", ".sub-reply-item .reply-content", ".reply-item .reply-content"];
    roots.flatMap((root) => selectors.flatMap((selector) => [...root.querySelectorAll(selector)])).forEach((element, index) => {
      if (comments.length >= 200 || !visible(element)) return;
      const text = cleanText(element.textContent);
      if (!text || text.length < 2 || seen.has(text)) return;
      seen.add(text);
      comments.push({ id: `bilibili-legacy-${index + 1}`, text, source: "extension" });
    });
    return comments;
  }

  function collectBilibili() {
    const commentsRoot = findBilibiliComponent()?.shadowRoot;
    if (!commentsRoot) return collectBilibiliLegacy();
    const comments = [];
    const seen = new Set();
    deepFind(commentsRoot, "bili-comment-thread-renderer").forEach((thread, threadIndex) => {
      if (comments.length >= 200 || !thread.shadowRoot) return;
      const parentId = `bilibili-${threadIndex + 1}`;
      const parent = deepFind(thread.shadowRoot, "bili-comment-renderer")[0];
      const parentComment = parent ? extractBilibili(parent, parentId) : null;
      if (parentComment && !seen.has(parentComment.text)) { seen.add(parentComment.text); comments.push(parentComment); }
      deepFind(thread.shadowRoot, "bili-comment-reply-renderer").forEach((reply, replyIndex) => {
        if (comments.length >= 200) return;
        const comment = extractBilibili(reply, `${parentId}-reply-${replyIndex + 1}`, parentComment ? parentId : undefined);
        if (comment && !seen.has(comment.text)) { seen.add(comment.text); comments.push(comment); }
      });
    });
    if (comments.length < 200) {
      const directRenderers = [...deepFind(commentsRoot, "bili-comment-renderer"), ...deepFind(commentsRoot, "bili-comment-reply-renderer")];
      directRenderers.forEach((renderer, index) => {
        if (comments.length >= 200) return;
        const comment = extractBilibili(renderer, `bilibili-direct-${index + 1}`);
        if (comment && !seen.has(comment.text)) { seen.add(comment.text); comments.push(comment); }
      });
    }
    collectBilibiliLegacy().forEach((comment) => {
      if (comments.length < 200 && !seen.has(comment.text)) { seen.add(comment.text); comments.push(comment); }
    });
    return comments;
  }

  function expandVisibleReplies() {
    const patterns = /展开(?:更多|全部)?回复|查看更多回复|更多回复|展开\s*\d+\s*条回复/;
    let clicked = 0;
    for (const element of document.querySelectorAll("button, [role='button'], .view-more, .more-reply")) {
      if (clicked >= 10 || !visible(element)) continue;
      const text = cleanText(element.textContent).slice(0, 40);
      if (!patterns.test(text)) continue;
      try { element.click(); clicked += 1; } catch { /* page controls are best effort */ }
    }
    return clicked;
  }

  async function prepareBilibili(deadline, requestId) {
    const waitUntil = Math.min(deadline, Date.now() + 20000);
    let component = findBilibiliComponent();
    let scrolledToComments = false;
    while (Date.now() < waitUntil) {
      if (collectBilibili().length) return;
      component = component || findBilibiliComponent();
      if (component && !scrolledToComments) {
        component.scrollIntoView({ behavior: "smooth", block: "start" });
        scrolledToComments = true;
      } else if (!component && !scrolledToComments) {
        window.scrollBy({ top: Math.max(700, window.innerHeight * 1.5), behavior: "instant" });
        scrolledToComments = true;
      }
      chrome.runtime.sendMessage({ type: "shotprint:progress", stage: 2, detail: "waiting-bilibili-comments", requestId });
      await delay(500);
    }
  }

  async function prepareDouyin(deadline, requestId) {
    const waitUntil = Math.min(deadline, Date.now() + 15000);
    let clicked = false;
    while (Date.now() < waitUntil) {
      if (blockedReason() || douyinCommentItems().length) return;
      if (!clicked) {
        const button = findDouyinCommentControl();
        if (button) { try { button.click(); clicked = true; } catch { /* best effort */ } }
      }
      chrome.runtime.sendMessage({ type: "shotprint:progress", stage: 2, detail: clicked ? "opening-douyin-comments" : "waiting-douyin-comments", requestId });
      await delay(500);
    }
  }

  function pageEvidenceReady() {
    if (blockedReason()) return true;
    if (platform === "douyin") {
      return Boolean(douyinCommentItems().length || douyinCommentRoots().length || findDouyinCommentControl());
    }
    if (platform === "xiaohongshu") {
      return Boolean(document.querySelector("[data-testid='comment-item'], .comment-item, .note-scroller, video, meta[property='og:video']"));
    }
    return true;
  }

  async function waitForPageEvidence(deadline, requestId) {
    const waitUntil = Math.min(deadline, Date.now() + 15000);
    while (Date.now() < waitUntil && !pageEvidenceReady()) {
      chrome.runtime.sendMessage({ type: "shotprint:progress", stage: 2, detail: "waiting-video-route", requestId });
      await delay(500);
    }
  }

  async function collectPage(requestId, options = {}) {
    const deadline = Date.now() + 90000;
    const targetCount = options.targetCount === 200 ? 200 : 100;
    const startedAt = Date.now();
    const phaseStartScrolls = totalScrollActions;
    const initialBlock = blockedReason();
    if (initialBlock) return { url: location.href, platform, title: document.title.slice(0, 200), comments: [], totalVisible: 0, errorCode: initialBlock, collectedAt: new Date().toISOString(), warnings: [`${initialBlock}:已停止采集，不绕过平台风控。`] };
    await waitForPageEvidence(deadline, requestId);
    if (platform === "douyin") await prepareDouyin(deadline, requestId);
    if (platform === "bilibili") await prepareBilibili(deadline, requestId);
    const preparedBlock = blockedReason();
    if (preparedBlock) return { url: location.href, comments: [], errorCode: preparedBlock };
    const identityAtStart = workIdentity(location.href)?.key;
    if (!identityAtStart) return { url: location.href, comments: [], errorCode: "TARGET_VIDEO_NOT_RESOLVED" };
    const requestedIdentity = options.requestedUrl ? workIdentity(options.requestedUrl)?.key : null;
    if (requestedIdentity && requestedIdentity !== identityAtStart) return { url: location.href, comments: [], errorCode: "TARGET_VIDEO_CHANGED" };
    if (sessionIdentity !== identityAtStart) { sessionComments.clear(); totalScrollActions = 0; sessionIdentity = identityAtStart; }
    const byText = new Map(sessionComments);
    const scrollTrace = [];
    let noGrowthRounds = 0;
    let stopReason = "target_reached";
    for (let scroll = 0; scroll < 15 && Date.now() < deadline && byText.size < targetCount; scroll += 1) {
      if (workIdentity(location.href)?.key !== identityAtStart) { sessionComments.clear(); return { url: location.href, comments: [], errorCode: "TARGET_VIDEO_CHANGED" }; }
      const before = byText.size;
      const current = platform === "bilibili" ? collectBilibili() : collectStandard();
      current.forEach((comment) => { if (!byText.has(comment.text)) byText.set(comment.text, comment); });
      if (byText.size >= targetCount) break;
      expandVisibleReplies();
      const itemsBefore = platform === "douyin" ? douyinCommentItems().length : current.length;
      const heightBefore = Number(platformScroller()?.scrollHeight || 0);
      const signatureBefore = commentDomSignature();
      const movement = await advancePlatformPage();
      totalScrollActions += 1;
      chrome.runtime.sendMessage({ type: "shotprint:progress", stage: 2, detail: `adaptive-scroll-${scroll + 1}:${byText.size}/${targetCount}`, sampleCount: byText.size, targetCount, requestId });
      await waitForCommentGrowth(itemsBefore, heightBefore, signatureBefore, deadline);
      const afterScroll = platform === "bilibili" ? collectBilibili() : collectStandard();
      afterScroll.forEach((comment) => { if (!byText.has(comment.text)) byText.set(comment.text, comment); });
      scrollTrace.push({ round: scroll + 1, before: movement.before, after: movement.after, domBefore: itemsBefore, domAfter: platform === "douyin" ? douyinCommentItems().length : afterScroll.length, added: byText.size - before, method: movement.method });
      if (byText.size <= before) noGrowthRounds += 1; else noGrowthRounds = 0;
      if (noGrowthRounds >= 3 && scroll >= 5 && atLoadedEnd()) { stopReason = "no_growth"; break; }
      if (blockedReason()) { stopReason = "platform_blocked"; break; }
      if (scroll === 14) stopReason = "scroll_limit";
    }
    const finalPage = platform === "bilibili" ? collectBilibili() : collectStandard();
    if (workIdentity(location.href)?.key !== identityAtStart) { sessionComments.clear(); return { url: location.href, comments: [], errorCode: "TARGET_VIDEO_CHANGED" }; }
    finalPage.forEach((comment) => { if (!byText.has(comment.text)) byText.set(comment.text, comment); });
    sessionComments.clear();
    [...byText.entries()].slice(0, 200).forEach(([key, value]) => sessionComments.set(key, value));
    const comments = [...sessionComments.values()].slice(0, targetCount);
    const warnings = [];
    if (Date.now() >= deadline) { warnings.push("采集达到90秒上限，已停止。"); stopReason = "time_limit"; }
    const platformStopReason = blockedReason();
    const unresolvedDouyinTarget = platform === "douyin"
      && !comments.length
      && (/\/search(?:\/|$)/.test(location.pathname) || /抖音搜索/.test(String(document.title || "")))
      && !douyinCommentRoots().length;
    if (platformStopReason) warnings.push(`${platformStopReason}:已停止采集，不绕过平台风控。`);
    if (!comments.length) warnings.push(platform === "bilibili" ? "已识别B站视频，但评论组件没有加载出可读评论。" : "当前页面没有找到已加载的可见评论。");
    const identity = pageIdentity();
    return { url: identity.canonicalUrl, platform, ...identity, comments, engine: "extension-dom", strategyVersion: "extension-dom-v0.7.1", sampleCount: comments.length, targetCount, pageCount: 0, cursorCount: 0, totalVisible: comments.length, scrollActions: totalScrollActions - phaseStartScrolls, scrollTrace: scrollTrace.slice(-15), durationMs: Date.now() - startedAt, stopReason, continuationAvailable: comments.length >= 1 && comments.length < 200 && !platformStopReason, sortMode: "current-page-order", errorCode: platformStopReason || (unresolvedDouyinTarget ? "TARGET_VIDEO_NOT_RESOLVED" : !comments.length ? "PLATFORM_LAYOUT_CHANGED" : undefined), collectedAt: new Date().toISOString(), warnings };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "shotprint:source-ping") {
      sendResponse({ ok: true, version, platform, url: location.href });
      return;
    }
    if (message?.type !== "shotprint:collect-page") return;
    if (collecting) { sendResponse({ accepted: false, reason: "COLLECTION_IN_PROGRESS" }); return; }
    collecting = true;
    sendResponse({ accepted: true });
    chrome.runtime.sendMessage({ type: "shotprint:progress", stage: 2, requestId: message.requestId });
    void collectPage(message.requestId, { targetCount: message.targetCount, requestedUrl: message.requestedUrl }).then((payload) => {
      if (payload.errorCode === "PLATFORM_LAYOUT_CHANGED" && payload.identityKey) {
        chrome.runtime.sendMessage({ type: "shotprint:comments", requestId: message.requestId, payload: { ...payload, commentStatus: "unavailable", warnings: [...(payload.warnings || []), "评论读取失败，不能据此判断该视频没有评论；仍可继续视频分析。"] } });
        return;
      }
      if (payload.errorCode && payload.comments.length === 0) {
        const messages = { CAPTCHA_REQUIRED: "页面要求验证码，采集已停止。", HTTP_403: "原页面返回403，采集已停止。", HTTP_429: "原页面返回429，采集已停止。", LOGIN_WALL: "原页面要求登录后查看评论。", TARGET_VIDEO_NOT_RESOLVED: "抖音短链进入了搜索结果页，但没有打开目标视频详情。请换用地址栏中的完整视频链接。", PLATFORM_LAYOUT_CHANGED: "页面已打开，但没有找到可读评论容器。" };
        chrome.runtime.sendMessage({ type: "shotprint:error", requestId: message.requestId, code: payload.errorCode, step: "collect", recoverable: true, userMessage: payload.errorCode === "TARGET_VIDEO_CHANGED" ? "原页面已切换到另一个作品，请重新选择视频。" : messages[payload.errorCode] || "评论容器读取失败，请改用手动评论。" });
      } else {
        chrome.runtime.sendMessage({ type: "shotprint:comments", payload, requestId: message.requestId });
      }
    }).catch((error) => {
      console.warn("Shotprint collector runtime failure", String(error?.name || "Error").slice(0, 40));
      chrome.runtime.sendMessage({ type: "shotprint:error", requestId: message.requestId, code: "PLATFORM_LAYOUT_CHANGED", step: "collect", recoverable: true, userMessage: "评论读取失败，请刷新原页后重试。" });
    }).finally(() => { collecting = false; });
  });
})();
