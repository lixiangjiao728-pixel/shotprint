(() => {
  if (globalThis.__SHOTPRINT_SITE_BRIDGE_V071__) return;
  globalThis.__SHOTPRINT_SITE_BRIDGE_V071__ = true;
  const initialRuntime = globalThis.chrome?.runtime;
  if (!initialRuntime) return;
  const manifest = initialRuntime.getManifest();
  const version = manifest.version_name || manifest.version;
  let backgroundPort = null;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let invalidationReported = false;

  const announce = () => window.postMessage({ type: "shotprint:bridge-ready", version }, "*");
  const forward = (message) => window.postMessage({ ...message, version }, "*");
  const runtime = () => globalThis.chrome?.runtime;
  const reportInvalidation = (requestId) => {
    if (invalidationReported) return;
    invalidationReported = true;
    backgroundPort = null;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    heartbeatTimer = null; reconnectTimer = null;
    forward({ type: "shotprint:error", requestId, code: "EXTENSION_CONTEXT_INVALIDATED", step: "bridge", recoverable: true, userMessage: "扩展刚刚被重新加载，当前镜谱网页仍连接着已失效的旧脚本。请只刷新镜谱网页一次，无需刷新原视频页。" });
  };
  const sendRuntime = (message, callback) => {
    const activeRuntime = runtime();
    if (!activeRuntime?.sendMessage) { reportInvalidation(message?.requestId); return false; }
    try {
      activeRuntime.sendMessage(message, (response) => {
        if (activeRuntime.lastError) reportInvalidation(message?.requestId);
        else callback?.(response);
      });
      return true;
    } catch { reportInvalidation(message?.requestId); return false; }
  };

  const connectBackground = () => {
    if (backgroundPort) return;
    const activeRuntime = runtime();
    if (!activeRuntime?.connect) { reportInvalidation(); return; }
    try {
      const port = activeRuntime.connect({ name: "shotprint:site-bridge" });
      backgroundPort = port;
      port.onMessage.addListener((message) => forward(message));
      port.onDisconnect.addListener(() => {
        if (backgroundPort !== port) return;
        backgroundPort = null;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectBackground, 500);
      });
      port.postMessage({ type: "shotprint:site-ready", version });
      heartbeatTimer = setInterval(() => {
        try { port.postMessage({ type: "shotprint:heartbeat", at: Date.now() }); } catch { /* reconnect is handled by onDisconnect */ }
      }, 15000);
    } catch {
      backgroundPort = null;
      reconnectTimer = setTimeout(connectBackground, 500);
    }
  };

  announce();
  connectBackground();
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === "shotprint:ping") { if (runtime()?.sendMessage) announce(); else reportInvalidation(); return; }
    if (event.data.type === "shotprint:receipt-ack") {
      try { backgroundPort?.postMessage({ type: "shotprint:receipt-ack", requestId: event.data.requestId }); } catch { connectBackground(); }
      return;
    }
    if (event.data.type === "shotprint:diagnose") {
      sendRuntime({ type: "shotprint:diagnose" }, (response) => forward({ type: "shotprint:diagnostics", diagnostics: response }));
      return;
    }
    if (event.data.type === "shotprint:retry-collection") {
      const previousRequestId = event.data.previousRequestId;
      sendRuntime({ type: "shotprint:cancel-collection", requestId: previousRequestId }, () => {
        sendRuntime({ type: "shotprint:open", url: event.data.url, requestId: event.data.requestId, targetCount: 100 }, (response) => {
          if (response?.accepted === false && response.error) forward({ ...response.error, type: "shotprint:error", requestId: event.data.requestId });
        });
      });
      return;
    }
    if (["shotprint:media-read", "shotprint:companion-health", "shotprint:pair", "shotprint:playback-prepare", "shotprint:cancel", "shotprint:cancel-collection"].includes(event.data.type)) {
      sendRuntime({ ...event.data }, (response) => forward({ type: "shotprint:companion-response", requestId: event.data.requestId, action: event.data.type, response }));
      return;
    }
    if (!["shotprint:collect", "shotprint:continue"].includes(event.data.type)) return;
    const runtimeMessage = event.data.type === "shotprint:continue"
      ? { type: "shotprint:continue", collectionId: event.data.collectionId, requestId: event.data.requestId }
      : { type: "shotprint:open", url: event.data.url, requestId: event.data.requestId, targetCount: 100 };
    sendRuntime(runtimeMessage, (response) => { if (response?.accepted === false && response.error) forward({ ...response.error, type: "shotprint:error", requestId: event.data.requestId }); });
  });

  initialRuntime.onMessage.addListener((message) => {
    if (!message?.type?.startsWith("shotprint:")) return;
    forward(message);
  });
})();
