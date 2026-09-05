// Runs in the isolated world of the resolved video tab. No cookies or media URLs
// leave this script; the site receives bounded chunks of a verified public file.
(() => {
  if (globalThis.__SHOTPRINT_MEDIA_V071__) return;
  globalThis.__SHOTPRINT_MEDIA_V071__ = true;
  const MAX = 300 * 1024 * 1024;
  const CHUNK = 256 * 1024;
  let active = null;
  const identity = () => globalThis.__shotprintWorkIdentity?.()?.key;
  const release = () => {
    if (active) { active.controller.abort(); clearTimeout(active.timer); active.blob = null; }
    active = null;
  };
  const fail = (code) => { throw new Error(code); };
  const allowedMedia = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password &&
        ["douyinvod.com", "douyin.com", "iesdouyin.com", "bytecdn.cn", "bilivideo.com", "bilivideo.cn", "xhscdn.com", "xiaohongshu.com"].some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    } catch { return false; }
  };
  async function acquire(task) {
    try {
      const videos = [...document.querySelectorAll("video")].filter((video) => {
        const rect = video.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && Number.isFinite(video.duration) && video.duration > 0;
      });
      if (videos.length !== 1) fail("VIDEO_PLAYER_AMBIGUOUS");
      const video = videos[0];
      if (video.duration > 300) fail("VIDEO_DURATION_LIMIT");
      if (!allowedMedia(video.currentSrc)) fail("VIDEO_RECORDING_REQUIRED");
      const response = await fetch(video.currentSrc, { credentials: "omit", redirect: "error", signal: task.controller.signal });
      if (!response.ok || !response.body) fail("VIDEO_DOWNLOAD_FAILED");
      if (Number(response.headers.get("content-length")) > MAX) fail("VIDEO_SIZE_LIMIT");
      if (!/video\/mp4|application\/octet-stream/i.test(response.headers.get("content-type") || "")) fail("VIDEO_RECORDING_REQUIRED");
      const reader = response.body.getReader();
      const chunks = [];
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (identity() !== task.identityKey || active !== task) fail("TARGET_VIDEO_CHANGED");
          if (done) break;
          task.bytes += value.length;
          if (task.bytes > MAX) fail("VIDEO_SIZE_LIMIT");
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (!task.bytes) fail("VIDEO_DOWNLOAD_EMPTY");
      task.blob = new Blob(chunks, { type: "video/mp4" });
      task.durationMs = Math.round(video.duration * 1000);
      task.status = "ready";
    } catch (error) {
      task.blob = null;
      task.status = "failed";
      task.code = /^VIDEO_|^TARGET_/.test(error.message) ? error.message : "VIDEO_RECORDING_REQUIRED";
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== "shotprint:media-read") return;
    if (message.action === "release") {
      if (active?.token === message.token) release();
      respond({ ok: true }); return;
    }
    if (!message.identityKey || identity() !== message.identityKey) {
      release(); respond({ ok: false, code: "TARGET_VIDEO_CHANGED" }); return;
    }
    if (message.action === "begin") {
      if (active?.token !== message.token) {
        release();
        active = { token: message.token, identityKey: message.identityKey, status: "pending", bytes: 0, controller: new AbortController(), blob: null };
        const task = active;
        task.timer = setTimeout(() => { if (active === task) release(); }, 180000);
        void acquire(task);
      }
    }
    const task = active;
    if (!task || task.token !== message.token) { respond({ ok: false, code: "VIDEO_SESSION_EXPIRED" }); return; }
    if (message.action === "chunk" && task.status === "ready") {
      const offset = message.offset;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= task.bytes || offset % CHUNK !== 0) { respond({ ok: false, code: "VIDEO_CHUNK_INVALID" }); return; }
      task.blob.slice(offset, offset + CHUNK).arrayBuffer().then((buffer) => {
        if (active !== task || identity() !== task.identityKey) { respond({ ok: false, code: "TARGET_VIDEO_CHANGED" }); return; }
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        respond({ ok: true, offset, data: btoa(binary) });
      }).catch(() => respond({ ok: false, code: "VIDEO_READ_FAILED" }));
      return true;
    }
    respond({ ok: task.status !== "failed", status: task.status, bytes: task.bytes, durationMs: task.durationMs, code: task.code });
  });
  window.addEventListener("pagehide", release);
})();
