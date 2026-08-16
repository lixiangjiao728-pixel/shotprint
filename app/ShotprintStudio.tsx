"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalysisResult, analysisResultSchema, analysisToCsv, analysisToMarkdown, formatTime, sampleTimelineItems } from "../lib/analysis";
import { demoAnalysis } from "../lib/demo-data";
import LinkAnalysisDesk from "./LinkAnalysisDesk";
import { detectPlatform, mergeLocalAudienceEvidence, type LinkAnalysis, type SupportedPlatform } from "../lib/link-analysis";
import { demoLinkAnalysis } from "../lib/link-demo-data";
import { buildResearchRequest, readSafeApiError, readSafeApiJson } from "../lib/comment-evidence";
import { compareExtensionVersions, extensionCompatibility } from "../lib/extension-version";

type Phase = "idle" | "reading" | "detecting" | "uploading" | "analyzing" | "ready" | "error";
type Tab = "shots" | "narrative" | "production" | "template";
type InputMode = "link" | "video";
type LinkPhase = "idle" | "collecting" | "comments-ready" | "continuing" | "researching" | "cross-checking" | "analyzing" | "awaiting-video" | "recording" | "ready" | "error";
type BridgeStatus = "checking" | "ready" | "missing" | "old";
type SearchStatus = "checking" | "configured" | "disabled";
type BackendStatus = "checking" | "aliyun" | "fallback";
type BridgeDiagnostics = { version?: string; bridge?: string; permissions?: Record<string, boolean>; activeJobs?: number; platform?: string; stage?: string; errorCode?: string; requestId?: string; companion?: { ok?: boolean; version?: string; browserAct?: string; chromeDirect?: boolean; paired?: boolean; code?: string; platformStatus?: Partial<Record<SupportedPlatform, string>> } };
type LinkPayload = {
  url: string; platform?: SupportedPlatform; title?: string; author?: string; description?: string; videoId?: string; keywords?: string; publishedAt?: string; coverUrl?: string;
  comments: unknown[]; warnings?: string[]; collectedAt?: string; collectionId?: string; targetCount?: number;
  engine?: "extension-api" | "extension-dom" | "browser-act-network" | "browser-act-dom"; strategyVersion?: string; sampleCount?: number; pageCount?: number; cursorCount?: number;
  scrollActions?: number; durationMs?: number; stopReason?: string; continuationAvailable?: boolean; sortMode?: string;
};
type VideoPageEvidence = { title: string; durationMs: number; width: number; height: number; playerReady: boolean; muted: boolean; sharedAudioDetected: boolean | null; captions?: string };
type ResearchProgress = { category?: string; completedQueries: number; totalQueries: number; sourceCount: number; domainCount: number; costCny?: number; message?: string };
const EXTENSION_VERSION = "0.6.9";
const MAX_VIDEO_DURATION_SECONDS = 300;
const MAX_VIDEO_DURATION_MS = MAX_VIDEO_DURATION_SECONDS * 1000;
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
const COLLECTION_LOAD_WATCHDOG_MS = 55000;
const COLLECTION_STALL_WATCHDOG_MS = 18000;
const LINK_STAGES = ["评论采集", "评论续采", "深度检索", "交叉核验", "视听分析", "综合报告"] as const;

function displayPalette(palette?: string[]) {
  if (!palette?.length) return ["#101218", "#A8C7C0"];
  return [palette[0], palette[1] ?? palette[0]];
}

function linkStageStatus(index: number, phase: LinkPhase, activeStage: number, recognized: boolean) {
  if (phase === "ready") return "done";
  if (phase === "idle") return recognized && index === 0 ? "done" : "pending";
  return index < activeStage ? "done" : index === activeStage ? "active" : "pending";
}

const PHASE_COPY: Record<Phase, string> = {
  idle: "等待素材", reading: "读取视频信息", detecting: "在本机识别切点", uploading: "安全直传到私有 OSS",
  analyzing: "重建叙事与生产假设", ready: "分析完成", error: "分析中断",
};

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function joinApi(base: string, path: string) {
  return base ? `${base.replace(/\/+$/, "")}${path}` : path;
}

async function downloadExtensionPackage() {
  const response = await fetch("/shotprint-extension-0.6.9.zip.b64", { cache: "no-store" });
  if (!response.ok) throw new Error("扩展安装包下载失败");
  const binary = atob((await response.text()).trim());
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "shotprint-extension-0.6.9.zip"; anchor.click();
  URL.revokeObjectURL(url);
}

function createVideoMetadata(file: File): Promise<{ durationMs: number; width: number; height: number; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const metadataTimer = window.setTimeout(() => { URL.revokeObjectURL(url); reject(new Error("读取视频元数据超时；请换用可播放的 MP4/MOV/WebM。")); }, 10000);
    video.addEventListener("loadedmetadata", () => { window.clearTimeout(metadataTimer); if (!Number.isFinite(video.duration) || video.duration <= 0) { URL.revokeObjectURL(url); reject(new Error("视频时长为0或无法读取；请重新导出文件。")); } }, { once: true });
    video.addEventListener("error", () => window.clearTimeout(metadataTimer), { once: true });
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const measured = Math.round(video.duration * 1000);
      const durationMs = measured > MAX_VIDEO_DURATION_MS && measured <= MAX_VIDEO_DURATION_MS + 500 ? MAX_VIDEO_DURATION_MS : measured;
      resolve({ durationMs, width: video.videoWidth, height: video.videoHeight, url });
    };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error("无法读取视频。请换成 MP4、MOV 或 WebM。")); };
    video.src = url;
  });
}

function waitForSeek(video: HTMLVideoElement, time: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("读取画面超时")), 5000);
    video.onseeked = () => { window.clearTimeout(timer); resolve(); };
    video.currentTime = Math.min(time, Math.max(0, video.duration - 0.01));
  });
}

async function detectScenes(url: string, durationMs: number, onProgress: (value: number) => void, signal: AbortSignal) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    const decodeTimer = window.setTimeout(() => reject(new Error("视频解码超时；请压缩或转换文件后重试。")), 15000);
    video.addEventListener("loadeddata", () => window.clearTimeout(decodeTimer), { once: true });
    video.addEventListener("error", () => window.clearTimeout(decodeTimer), { once: true });
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("浏览器无法解码这个视频。"));
  });
  const canvas = document.createElement("canvas");
  canvas.width = 16; canvas.height = 9;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器无法创建画面分析器。");
  const intervalMs = Math.max(250, Math.ceil(durationMs / 300 / 250) * 250);
  const frames: Array<{ timeMs: number; luma: number[] }> = [];
  for (let timeMs = 0; timeMs < durationMs; timeMs += intervalMs) {
    if (signal.aborted) throw new DOMException("已取消", "AbortError");
    await waitForSeek(video, timeMs / 1000);
    context.drawImage(video, 0, 0, 16, 9);
    const pixels = context.getImageData(0, 0, 16, 9).data;
    const luma: number[] = [];
    for (let offset = 0; offset < pixels.length; offset += 4) luma.push(Math.round(.2126 * pixels[offset] + .7152 * pixels[offset + 1] + .0722 * pixels[offset + 2]));
    frames.push({ timeMs, luma });
    onProgress(Math.round((timeMs / durationMs) * 38));
  }
  return new Promise<number[]>((resolve, reject) => {
    const worker = new Worker("/scene-worker.js");
    const workerTimer = window.setTimeout(() => { worker.terminate(); reject(new Error("本地切点分析超时；可取消后直接重试。")); }, 30000);
    worker.addEventListener("message", () => window.clearTimeout(workerTimer), { once: true });
    worker.addEventListener("error", () => window.clearTimeout(workerTimer), { once: true });
    worker.onmessage = (event) => { worker.terminate(); resolve(event.data.cuts); };
    worker.onerror = () => { worker.terminate(); reject(new Error("本地切点分析器没有响应。")); };
    worker.postMessage({ frames, durationMs });
  });
}

export default function ShotprintStudio() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [tab, setTab] = useState<Tab>("shots");
  const [activeShot, setActiveShot] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [consent, setConsent] = useState(false);
  const [editing, setEditing] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>("link");
  const [link, setLink] = useState("");
  const [linkPlatform, setLinkPlatform] = useState<SupportedPlatform>("unknown");
  const [linkPhase, setLinkPhase] = useState<LinkPhase>("idle");
  const [linkError, setLinkError] = useState("");
  const [manualComments, setManualComments] = useState("");
  const [linkAnalysis, setLinkAnalysis] = useState<LinkAnalysis | null>(null);
  const [pendingLinkPayload, setPendingLinkPayload] = useState<LinkPayload | null>(null);
  const [linkFixture, setLinkFixture] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>("checking");
  const [bridgeDiagnostics, setBridgeDiagnostics] = useState<BridgeDiagnostics | null>(null);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("checking");
  const [apiBase, setApiBase] = useState("");
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);
  const [linkStage, setLinkStage] = useState(0);
  const [researchSessionId, setResearchSessionId] = useState("");
  const [researchProgress, setResearchProgress] = useState<ResearchProgress>({ completedQueries: 0, totalQueries: 8, sourceCount: 0, domainCount: 0 });
  const [fileAcquisition, setFileAcquisition] = useState<"download_upload" | "manual_upload" | "tab_capture">("manual_upload");
  const [fileAudioPresent, setFileAudioPresent] = useState<boolean | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingBytes, setRecordingBytes] = useState(0);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [captureWarning, setCaptureWarning] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [pairingStatus, setPairingStatus] = useState<"idle" | "pairing" | "paired" | "error">("idle");
  const [videoPageEvidence, setVideoPageEvidence] = useState<VideoPageEvidence | null>(null);
  const linkRequestRef = useRef("");
  const linkCollectionModeRef = useRef<"initial" | "continue">("initial");
  const linkTimerRef = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const downloadedFileInput = useRef<HTMLInputElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const companionWaitersRef = useRef(new Map<string, (response: Record<string, unknown>) => void>());
  const collectionRetryRef = useRef(0);
  const terminalReceiptsRef = useRef(new Set<string>());
  const autoAnalyzeRef = useRef(false);
  const analysisRunRef = useRef<string | null>(null);

  const duration = analysis?.metadata.durationMs ?? 20800;
  const currentShot = analysis?.shots[activeShot];
  const apiUrl = useCallback((path: string) => joinApi(apiBase, path), [apiBase]);

  const armCollectionWatchdog = useCallback((requestId: string, timeoutMs: number) => {
    const schedule = (activeRequestId: string, delayMs: number) => {
      if (linkTimerRef.current) window.clearTimeout(linkTimerRef.current);
      linkTimerRef.current = window.setTimeout(() => {
        if (linkRequestRef.current !== activeRequestId) return;
        if (collectionRetryRef.current === 0 && link.trim() && linkPlatform !== "unknown") {
          collectionRetryRef.current = 1;
          const retryRequestId = crypto.randomUUID();
          linkRequestRef.current = retryRequestId;
          setLinkPhase("collecting"); setLinkStage(0);
          setLinkError("首次采集通道中断，镜谱正在自动重连一次；无需刷新网页或重复点击。");
          setBridgeDiagnostics((current) => ({ ...(current || {}), platform: linkPlatform, stage: "automatic-retry", errorCode: "COLLECTION_CHANNEL_RETRY", requestId: retryRequestId }));
          window.postMessage({ type: "shotprint:retry-collection", previousRequestId: activeRequestId, requestId: retryRequestId, url: link.trim() }, "*");
          schedule(retryRequestId, COLLECTION_LOAD_WATCHDOG_MS);
          return;
        }
        linkTimerRef.current = null;
        setLinkPhase("error");
        setBridgeDiagnostics((current) => ({ ...(current || {}), platform: linkPlatform, stage: "channel-stalled", errorCode: "COLLECTION_CHANNEL_STALLED", requestId: activeRequestId }));
        setLinkError("采集通道在自动重连后仍没有进度回执。你可以直接使用手动评论导入继续完成报告；安全诊断已标记为 COLLECTION_CHANNEL_STALLED。");
      }, delayMs);
    };
    schedule(requestId, timeoutMs);
  }, [link, linkPlatform]);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  useEffect(() => {
    const receiveLinkAnalysis = (event: MessageEvent) => {
      if (event.source !== window || !event.data) return;
      if (event.data.type === "shotprint:bridge-ready") {
        const compatible = extensionCompatibility(event.data.version, EXTENSION_VERSION) === "compatible";
        setBridgeStatus((current) => compatible ? "ready" : current === "ready" ? current : "old");
        window.postMessage({ type: "shotprint:diagnose" }, "*");
        return;
      }
      if (event.data.type === "shotprint:diagnostics") {
        const incoming = event.data.diagnostics as BridgeDiagnostics | undefined;
        if (!incoming) return;
        if (extensionCompatibility(incoming.version, EXTENSION_VERSION) === "compatible") setBridgeStatus("ready");
        setBridgeDiagnostics((current) => {
          const comparison = compareExtensionVersions(incoming.version, current?.version);
          return !current || comparison === null || comparison >= 0 ? incoming : current;
        });
        return;
      }
      if (event.data.type === "shotprint:companion-response") { const waiter = companionWaitersRef.current.get(String(event.data.requestId || "")); if (waiter) { companionWaitersRef.current.delete(String(event.data.requestId)); waiter(event.data.response || {}); } return; }
      if (event.data.requestId && event.data.requestId !== linkRequestRef.current) return;
      if (event.data.type === "shotprint:progress") {
        setLinkStage(linkCollectionModeRef.current === "continue" ? 1 : 0);
        setBridgeDiagnostics((current) => ({ ...(current || {}), stage: String(event.data.detail || `stage-${event.data.stage}`), requestId: String(event.data.requestId || linkRequestRef.current) }));
        armCollectionWatchdog(linkRequestRef.current, Number(event.data.stage) <= 1 ? COLLECTION_LOAD_WATCHDOG_MS : COLLECTION_STALL_WATCHDOG_MS);
        return;
      }
      if (!["shotprint:comments", "shotprint:error"].includes(event.data.type)) return;
      const terminalRequestId = String(event.data.requestId || linkRequestRef.current);
      window.postMessage({ type: "shotprint:receipt-ack", requestId: terminalRequestId }, "*");
      if (terminalReceiptsRef.current.has(terminalRequestId)) return;
      terminalReceiptsRef.current.add(terminalRequestId);
    if (linkTimerRef.current) { window.clearTimeout(linkTimerRef.current); linkTimerRef.current = null; }
    if (event.data.type === "shotprint:error") { setBridgeDiagnostics((current) => ({ ...(current || {}), platform: String(event.data.platform || "unknown"), stage: String(event.data.step || "unknown"), errorCode: String(event.data.code || "EXTENSION_ERROR"), requestId: String(event.data.requestId || linkRequestRef.current) })); setLinkPhase("error"); setLinkError(String(event.data.userMessage || event.data.error || `${event.data.code || "EXTENSION_ERROR"}：扩展没有返回采集结果。`)); return; }
      const payload = event.data.payload as LinkPayload;
      if (!payload?.url) return;
      if (!Array.isArray(payload.comments) || payload.comments.length === 0) {
        setLinkAnalysis(null); setLinkPhase("error"); setLinkError(payload.warnings?.[0] || "视频已识别，但评论区尚未加载出可分析评论。请在原页确认评论可见后重试，或改用手动评论。"); return;
      }
      setPendingLinkPayload(payload); setResearchSessionId(""); setLinkAnalysis(null); setLinkStage(1); setLinkPhase("comments-ready"); setLinkError("");
    };
    window.addEventListener("message", receiveLinkAnalysis);
    window.postMessage({ type: "shotprint:ping" }, "*");
    const bridgeTimer = window.setTimeout(() => setBridgeStatus((current) => current === "ready" || current === "old" ? current : "missing"), 1500);
    return () => { window.clearTimeout(bridgeTimer); window.removeEventListener("message", receiveLinkAnalysis); if (linkTimerRef.current) window.clearTimeout(linkTimerRef.current); };
  }, [armCollectionWatchdog]);

  useEffect(() => {
    void fetch("/api/link-analyze", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as { search?: { status?: string }; backend?: { apiBase?: string } };
      const external = payload.backend?.apiBase?.trim() || "";
      if (!external) {
        setBackendStatus("fallback");
        setSearchStatus(payload.search?.status === "configured" ? "configured" : "disabled");
        return;
      }
      const health = await fetch(joinApi(external, "/health"), { cache: "no-store" });
      if (!health.ok) throw new Error("ALIYUN_BACKEND_UNAVAILABLE");
      const externalStatus = await fetch(joinApi(external, "/api/link-analyze"), { cache: "no-store" });
      const externalPayload = await externalStatus.json() as { search?: { status?: string } };
      setApiBase(external); setBackendStatus("aliyun");
      setSearchStatus(externalPayload.search?.status === "configured" ? "configured" : "disabled");
    }).catch(() => { setBackendStatus("fallback"); setSearchStatus("disabled"); });
  }, []);

  useEffect(() => {
    if (!isDemo || !playing || !analysis) return;
    let previous = performance.now();
    const tick = (now: number) => {
      const elapsed = now - previous; previous = now;
      setPlayhead((value) => value + elapsed >= duration ? 0 : value + elapsed);
      timerRef.current = requestAnimationFrame(tick);
    };
    timerRef.current = requestAnimationFrame(tick);
    return () => { if (timerRef.current) cancelAnimationFrame(timerRef.current); };
  }, [analysis, duration, isDemo, playing]);

  useEffect(() => {
    if (!analysis) return;
    const found = analysis.shots.findIndex((shot) => playhead >= shot.startMs && playhead < shot.endMs);
    if (found < 0 || found === activeShot) return;
    const frame = window.requestAnimationFrame(() => setActiveShot(found));
    return () => window.cancelAnimationFrame(frame);
  }, [activeShot, analysis, playhead]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    if (linkTimerRef.current) window.clearTimeout(linkTimerRef.current);
    collectionRetryRef.current = 0; terminalReceiptsRef.current.clear();
    recorderRef.current?.stop(); captureStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    autoAnalyzeRef.current = false;
    analysisRunRef.current = null;
    setPhase("idle"); setProgress(0); setError(""); setFile(null); setVideoUrl(""); setAnalysis(null); setPlayhead(0); setPlaying(false); setIsDemo(false); setLink(""); setLinkPlatform("unknown"); setLinkPhase("idle"); setLinkStage(0); setLinkError(""); setManualComments(""); setLinkAnalysis(null); setPendingLinkPayload(null); setLinkFixture(false); setBridgeDiagnostics(null); setDiagnosticCopied(false); setResearchSessionId(""); setResearchProgress({ completedQueries: 0, totalQueries: 8, sourceCount: 0, domainCount: 0 }); setFileAcquisition("manual_upload"); setFileAudioPresent(null); setRecordingSeconds(0); setRecordingBytes(0); setRecordingPaused(false); setCaptureWarning(""); setPairingCode(""); setPairingStatus("idle"); setVideoPageEvidence(null);
  }, [videoUrl]);

  const copyDiagnostics = useCallback(async () => {
    const safe = {
      version: bridgeDiagnostics?.version || "unknown",
      platform: bridgeDiagnostics?.platform || linkPlatform,
      stage: bridgeDiagnostics?.stage || (linkPhase === "idle" ? "idle" : linkPhase),
      errorCode: bridgeDiagnostics?.errorCode || "none",
      requestId: bridgeDiagnostics?.requestId || linkRequestRef.current || "none",
      time: new Date().toISOString(),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(safe));
      setDiagnosticCopied(true);
      window.setTimeout(() => setDiagnosticCopied(false), 1800);
    } catch {
      setLinkError("剪贴板不可用；请手动记录扩展版本、平台、阶段和错误码。");
    }
  }, [bridgeDiagnostics, linkPhase, linkPlatform]);

  const handleLinkChange = (value: string) => { setLink(value); setLinkPlatform(value.trim() ? detectPlatform(value.trim()) : "unknown"); setLinkError(""); if (linkPhase === "error") setLinkPhase("idle"); };

  const requestCompanion = useCallback((type: "shotprint:companion-health" | "shotprint:pair" | "shotprint:playback-prepare", payload: Record<string, unknown> = {}, timeoutMs = 15000) => new Promise<Record<string, unknown>>((resolve) => {
    const requestId = crypto.randomUUID();
    const timer = window.setTimeout(() => { companionWaitersRef.current.delete(requestId); resolve({ ok: false, code: "COMPANION_NOT_RUNNING" }); }, timeoutMs);
    companionWaitersRef.current.set(requestId, (response) => { window.clearTimeout(timer); resolve(response); });
    window.postMessage({ type, requestId, ...payload }, "*");
  }), []);

  const pairCompanion = useCallback(async () => {
    if (!/^\d{6}$/.test(pairingCode)) { setPairingStatus("error"); setLinkError("请输入伴侣启动窗口显示的6位配对码。"); return; }
    setPairingStatus("pairing");
    const response = await requestCompanion("shotprint:pair", { code: pairingCode }, 7000);
    if (response.ok === true) { setPairingStatus("paired"); setPairingCode(""); setLinkError(""); window.postMessage({ type: "shotprint:diagnose" }, "*"); }
    else { setPairingStatus("error"); setLinkError(response.code === "COMPANION_NOT_RUNNING" ? "本地伴侣没有运行。请先启动伴侣，再输入配对码。" : "配对码错误或已失效，请使用当前启动窗口的新配对码。"); }
  }, [pairingCode, requestCompanion]);

  const runLinkCollection = () => {
    if (!link.trim()) { setLinkPhase("error"); setLinkError("先粘贴一个抖音、B站或小红书链接。"); return; }
    if (linkPlatform === "unknown") { setLinkPhase("error"); setLinkError("暂不识别这个平台，请粘贴完整的原视频链接。"); return; }
    if (bridgeStatus === "old") { setLinkPhase("error"); setLinkError(`检测到旧版扩展，请在扩展管理页重新加载 ${EXTENSION_VERSION}，然后刷新本网页。`); return; }
    if (bridgeStatus !== "ready") { setLinkPhase("error"); setLinkError(`网页没有检测到取证桥。请在扩展管理页重新加载 ${EXTENSION_VERSION}，然后刷新本网页。`); return; }
    if (linkTimerRef.current) window.clearTimeout(linkTimerRef.current);
    collectionRetryRef.current = 0;
    const requestId = crypto.randomUUID(); linkRequestRef.current = requestId; linkCollectionModeRef.current = "initial";
    setLinkAnalysis(null); setLinkStage(0); setLinkPhase("collecting"); setLinkError("");
    window.postMessage({ type: "shotprint:collect", url: link.trim(), requestId }, "*");
    armCollectionWatchdog(requestId, COLLECTION_LOAD_WATCHDOG_MS);
  };

  const continueLinkCollection = () => {
    if (!pendingLinkPayload?.collectionId || !pendingLinkPayload.continuationAvailable) {
      setLinkPhase("error"); setLinkError("本次采集会话已失效，请重新开始采集。"); return;
    }
    if (linkTimerRef.current) window.clearTimeout(linkTimerRef.current);
    collectionRetryRef.current = 1;
    const requestId = crypto.randomUUID(); linkRequestRef.current = requestId; linkCollectionModeRef.current = "continue";
    setLinkPhase("continuing"); setLinkStage(1); setLinkError("");
    window.postMessage({ type: "shotprint:continue", collectionId: pendingLinkPayload.collectionId, requestId }, "*");
    armCollectionWatchdog(requestId, COLLECTION_STALL_WATCHDOG_MS);
  };

  const runDeepResearch = async () => {
    const payload = pendingLinkPayload;
    if (!payload?.comments.length) { setLinkPhase("error"); setLinkError("请先取得评论样本，再开始深度研究。"); return; }
    setLinkPhase("researching"); setLinkStage(2); setLinkError(""); setLinkAnalysis(null);
    setResearchProgress({ completedQueries: 0, totalQueries: 8, sourceCount: 0, domainCount: 0 });
    try {
      const { evidence, digest, body } = buildResearchRequest(payload);
      let response = await fetch(apiUrl("/api/link-research"), { method: "POST", headers: { "content-type": "application/json; charset=utf-8", "x-shotprint-contract": digest.contract }, body: JSON.stringify(body) });
      if (response.status === 202 && response.headers.get("content-type")?.includes("application/json")) {
        const accepted = await response.json() as { researchJobId?: string; pollAfterMs?: number };
        if (!accepted.researchJobId) throw new Error("深度研究任务没有返回可查询编号。");
        const deadline = Date.now() + 8 * 60 * 1000;
        let pollDelay = Math.max(1000, Math.min(5000, Number(accepted.pollAfterMs) || 2000));
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, pollDelay));
          response = await fetch(apiUrl(`/api/link-research/jobs/${encodeURIComponent(accepted.researchJobId)}`), { headers: { "x-shotprint-contract": digest.contract } });
          if (response.status !== 202) break;
          setResearchProgress((current) => ({ ...current, stage: "deep-search" }));
          pollDelay = Math.min(5000, Math.round(pollDelay * 1.15));
        }
        if (response.status === 202) throw new Error("深度研究超过8分钟仍未完成；请直接重试深度研究，无需重新采集评论。");
      }
      const contentType = response.headers.get("content-type") || "";
      let finalResult: { researchSessionId?: string; receipt?: ResearchProgress } | null = null;
      if (contentType.includes("application/json")) {
        const data = await response.json() as { status?: string; researchSessionId?: string; receipt?: ResearchProgress; errorCode?: string; userMessage?: string };
        if (!response.ok || data.status === "failed") throw new Error(`${data.errorCode || "SEARCH_PROVIDER_ERROR"}：${data.userMessage || "深度研究失败"}`);
        finalResult = data;
        setLinkPhase("cross-checking"); setLinkStage(3);
      } else {
        if (!response.ok || !response.body) throw new Error(await readSafeApiError(response, "深度研究服务没有开始"));
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
        while (true) {
        const { done, value } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = buffer.split("\n\n"); buffer = done ? "" : blocks.pop() || "";
        for (const block of blocks) {
          const event = block.match(/^event:\s*(.+)$/m)?.[1]; const dataLine = block.match(/^data:\s*(.+)$/m)?.[1]; if (!event || !dataLine) continue;
          const data = JSON.parse(dataLine) as Record<string, unknown>;
          if (event === "progress") {
            const completed = Number(data.completed || 0); const sourceCount = Number(data.sourceCount || 0); const domainCount = Number(data.domainCount || 0);
            setLinkPhase(data.stage === "cross-check" ? "cross-checking" : "researching"); setLinkStage(data.stage === "cross-check" ? 3 : 2);
            setResearchProgress((current) => ({ ...current, category: String(data.category || current.category || ""), completedQueries: Math.max(current.completedQueries, completed), totalQueries: Number(data.total || current.totalQueries), sourceCount: Math.max(current.sourceCount, sourceCount), domainCount: Math.max(current.domainCount, domainCount) }));
          }
          if (event === "failed") throw new Error(`${String(data.errorCode || "SEARCH_PROVIDER_ERROR")}：${String(data.userMessage || "深度研究失败")}`);
          if (event === "complete") finalResult = data as { researchSessionId?: string; receipt?: ResearchProgress };
        }
          if (done) break;
        }
      }
      if (!finalResult?.researchSessionId) throw new Error("深度研究没有返回60分钟研究会话。");
      setResearchSessionId(finalResult.researchSessionId); if (finalResult.receipt) setResearchProgress((current) => ({ ...current, ...finalResult!.receipt }));
      const collectionDetails = { engine: payload.engine, strategyVersion: payload.strategyVersion, sampleCount: evidence.receipt.originalSampleCount, evidenceSampleCount: evidence.receipt.evidenceSampleCount, targetCount: payload.targetCount, pageCount: payload.pageCount, cursorCount: payload.cursorCount, scrollActions: payload.scrollActions, durationMs: payload.durationMs, stopReason: payload.stopReason, continuationAvailable: payload.continuationAvailable, sortMode: payload.sortMode };
      const linkResponse = await fetch(apiUrl("/api/link-analyze"), { method: "POST", headers: { "content-type": "application/json", "x-shotprint-contract": digest.contract }, body: JSON.stringify({ url: payload.url, platform: payload.platform, title: payload.title, author: payload.author, description: payload.description, videoId: payload.videoId, publishedAt: payload.publishedAt, coverUrl: payload.coverUrl, method: payload.collectionId ? "extension" : "manual", researchSessionId: finalResult.researchSessionId, collectionDetails }) });
      if (!linkResponse.ok) throw new Error(await readSafeApiError(linkResponse, "社会舆情报告合并失败"));
      const linkData = await linkResponse.json() as { result?: LinkAnalysis; error?: string };
      if (!linkData.result) throw new Error(linkData.error || "社会舆情报告合并失败。");
      setLinkAnalysis(mergeLocalAudienceEvidence(linkData.result, evidence.comments, payload.collectionId ? "extension" : "manual", collectionDetails)); setLinkFixture(false); setLinkPhase("awaiting-video"); setLinkStage(4);
      window.setTimeout(() => document.getElementById("link-result")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (caught) { setLinkPhase("error"); setLinkError(caught instanceof Error ? caught.message : "深度研究意外中断。"); }
  };

  const runManualLinkAnalysis = () => {
    if (!link.trim() || linkPlatform === "unknown") { setLinkPhase("error"); setLinkError("请先粘贴可识别的抖音、B站或小红书原链接。"); return; }
    const comments = manualComments.split(/\r?\n/).map((text, index) => ({ id: `manual-${index + 1}`, text: text.trim(), source: "manual" as const })).filter((comment) => comment.text);
    if (!comments.length) { setLinkPhase("error"); setLinkError("请至少粘贴一条评论，每行一条；评论只用于本次分析。"); return; }
    const payload: LinkPayload = { url: link.trim(), platform: linkPlatform, comments };
    setPendingLinkPayload(payload); setResearchSessionId(""); setLinkAnalysis(null); setLinkStage(1); setLinkPhase("comments-ready"); setLinkError("");
  };

  const loadLinkDemo = () => { setInputMode("link"); setLink("https://www.douyin.com/video/shotprint-demo-link"); setLinkPlatform("douyin"); setLinkAnalysis(demoLinkAnalysis); setLinkFixture(true); setLinkPhase("ready"); setLinkError(""); window.setTimeout(() => document.getElementById("link-result")?.scrollIntoView({ behavior: "smooth" }), 50); };

  const chooseFile = async (selected: File, acquisition: "download_upload" | "manual_upload" | "tab_capture" = "manual_upload", audioPresent: boolean | null = null) => {
    setError("");
    autoAnalyzeRef.current = true;
    const accepted = ["video/mp4", "video/quicktime", "video/webm"];
    if (!accepted.includes(selected.type)) { autoAnalyzeRef.current = false; setError("仅支持 MP4、MOV、WebM。请先转换格式再试。"); setPhase("error"); return; }
    if (selected.size > MAX_VIDEO_BYTES) { autoAnalyzeRef.current = false; setError("视频超过 300MB。请压缩文件，或截取 5 分钟内最想分析的段落。"); setPhase("error"); return; }
    setPhase("reading"); setProgress(4);
    try {
      const metadata = await createVideoMetadata(selected);
      if (metadata.durationMs > MAX_VIDEO_DURATION_MS) throw new Error("视频超过 300 秒。请截取最想分析的段落。");
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setFile(selected); setVideoUrl(metadata.url); setFileAcquisition(acquisition); setFileAudioPresent(audioPresent); setPhase("idle"); setProgress(0); setAnalysis(null); setIsDemo(false);
      setCaptureWarning(consent ? "文件校验完成，正在自动启动视听分析。" : "文件已校验。勾选素材授权后会自动开始，无需再次点击。" );
      if (consent) window.setTimeout(() => void runAnalysis(selected, metadata.url, acquisition, audioPresent), 0);
    } catch (caught) { autoAnalyzeRef.current = false; setError(caught instanceof Error ? caught.message : "视频读取失败"); setPhase("error"); }
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => { const selected = event.target.files?.[0]; if (selected) void chooseFile(selected, "manual_upload"); event.target.value = ""; };
  const handleDownloadedInput = (event: ChangeEvent<HTMLInputElement>) => { const selected = event.target.files?.[0]; if (selected) void chooseFile(selected, "download_upload"); event.target.value = ""; };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); const selected = event.dataTransfer.files?.[0]; if (selected) void chooseFile(selected); };
  const handleConsentChange = (checked: boolean) => {
    setConsent(checked);
    if (checked && autoAnalyzeRef.current && file && videoUrl && phase === "idle") window.setTimeout(() => void runAnalysis(file, videoUrl, fileAcquisition, fileAudioPresent, true), 0);
  };

  const openGreenVideo = async () => {
    const helperTab = window.open("https://greenvideo.cc/", "_blank", "noopener,noreferrer");
    let copied = false;
    try { await navigator.clipboard.writeText(link.trim()); copied = true; }
    catch { linkInputRef.current?.focus(); linkInputRef.current?.select(); }
    setCaptureWarning(copied ? "原链接已复制。下载MP4后回到本页选择文件，评论与研究结果会保留。" : helperTab ? "剪贴板被浏览器拒绝，原链接已选中；请返回本页手动复制后在GreenVideo粘贴。" : "浏览器阻止了新标签页且剪贴板不可用；原链接已选中，请手动复制并打开GreenVideo。" );
  };

  const stopTabCapture = () => {
    if (recordingTimerRef.current) { window.clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (recorderRef.current?.state === "recording" || recorderRef.current?.state === "paused") recorderRef.current.stop();
    captureStreamRef.current?.getTracks().forEach((track) => track.stop());
  };

  const toggleTabCapturePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") { recorder.pause(); setRecordingPaused(true); }
    else if (recorder.state === "paused") { recorder.resume(); setRecordingPaused(false); }
  };

  const startTabCapture = async () => {
    if (!pendingLinkPayload || !researchSessionId) { setLinkError("请先完成评论深度研究，再录制原视频标签页。"); return; }
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined") { setLinkError("当前浏览器不支持标签页录制，请改用上传本地视频。"); return; }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true, preferCurrentTab: false, selfBrowserSurface: "exclude", surfaceSwitching: "exclude" } as DisplayMediaStreamOptions);
      const audioPresent = stream.getAudioTracks().length > 0;
      const prepared = await requestCompanion("shotprint:playback-prepare", { url: pendingLinkPayload.url }, 15000);
      const page = prepared.ok === true && prepared.evidence && typeof prepared.evidence === "object" ? prepared.evidence as Record<string, unknown> : null;
      if (page?.type === "PLAYBACK_READY") setVideoPageEvidence({ title: String(page.title || "").slice(0, 200), durationMs: Math.max(0, Number(page.durationMs) || 0), width: Math.max(0, Number(page.width) || 0), height: Math.max(0, Number(page.height) || 0), playerReady: page.playerReady === true, muted: page.muted === true, sharedAudioDetected: audioPresent, captions: typeof page.captions === "string" ? page.captions.slice(0, 4000) : undefined });
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
      captureStreamRef.current = stream; recorderRef.current = recorder; recordingChunksRef.current = [];
      setRecordingSeconds(0); setRecordingBytes(0); setRecordingPaused(false); setLinkPhase("recording"); setLinkStage(4); setLinkError(""); setCaptureWarning(!audioPresent ? "VIDEO_AUDIO_MISSING：未捕获标签页音轨，可继续做纯画面分析，或停止后改用上传文件。" : page?.type !== "PLAYBACK_READY" ? "播放器自动校准失败：请在原视频标签页手动拖到0秒并开始播放；录制仍可继续。" : "");
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return; recordingChunksRef.current.push(event.data);
        const size = recordingChunksRef.current.reduce((total, chunk) => total + chunk.size, 0); setRecordingBytes(size);
        if (size >= MAX_VIDEO_BYTES) stopTabCapture();
      };
      recorder.onerror = () => { setLinkPhase("awaiting-video"); setLinkError("标签页录制损坏或被浏览器中断，请重试或上传本地视频。"); };
      recorder.onstop = () => {
        if (recordingTimerRef.current) { window.clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordingChunksRef.current, { type: "video/webm" });
        if (!blob.size) { setLinkPhase("awaiting-video"); setLinkError("没有取得录制内容；请重新选择原视频标签页并从头播放。"); return; }
        const recorded = new File([blob], `shotprint-tab-${Date.now()}.webm`, { type: "video/webm" });
        void chooseFile(recorded, "tab_capture", audioPresent).then(() => setLinkPhase("awaiting-video"));
      };
      recorder.start(1000);
      recordingTimerRef.current = window.setInterval(() => setRecordingSeconds((seconds) => { if (recorderRef.current?.state === "paused") return seconds; if (seconds >= MAX_VIDEO_DURATION_SECONDS - 1) { stopTabCapture(); return MAX_VIDEO_DURATION_SECONDS; } return seconds + 1; }), 1000);
    } catch (caught) {
      setLinkPhase("awaiting-video");
      setLinkError(caught instanceof DOMException && caught.name === "NotAllowedError" ? "你取消了共享选择；没有录制或上传任何内容。" : "无法开始标签页录制，请重试或上传本地视频。");
    }
  };

  const loadDemo = () => {
    setAnalysis(demoAnalysis); setPhase("ready"); setProgress(100); setIsDemo(true); setError(""); setTab("shots"); setActiveShot(0); setPlayhead(0);
    window.setTimeout(() => document.getElementById("result")?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  async function runAnalysis(targetFile = file, targetVideoUrl = videoUrl, targetAcquisition = fileAcquisition, targetAudioPresent = fileAudioPresent, targetConsent = consent) {
    if (!targetFile || !targetVideoUrl || !targetConsent || analysisRunRef.current) return;
    const runId = crypto.randomUUID();
    analysisRunRef.current = runId;
    autoAnalyzeRef.current = false;
    const controller = new AbortController(); abortRef.current = controller;
    let activeUpload: { objectKey: string; uploadToken: string } | null = null;
    try {
      const metadata = await createVideoMetadata(targetFile);
      setPhase("detecting"); setProgress(8);
      const localCuts = await detectScenes(targetVideoUrl, metadata.durationMs, setProgress, controller.signal);
      setPhase("uploading"); setProgress(43);
      const sessionResponse = await fetch(apiUrl("/api/upload-session"), {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ fileName: targetFile.name, mimeType: targetFile.type, size: targetFile.size, durationMs: metadata.durationMs, consent: true }),
      });
      const session = await readSafeApiJson<{ uploadUrl?: string; uploadToken?: string; objectKey?: string; uploadHeaders?: Record<string, string>; error?: string }>(sessionResponse, "无法创建安全上传会话");
      if (!sessionResponse.ok || !session.uploadUrl || !session.uploadToken || !session.objectKey) throw new Error(session.error || "无法创建安全上传会话。");
      activeUpload = { objectKey: session.objectKey, uploadToken: session.uploadToken };
      let uploadResponse: Response;
      try {
        uploadResponse = await fetch(session.uploadUrl, {
          method: "PUT", signal: controller.signal, body: targetFile,
          headers: session.uploadHeaders || { "Content-Type": targetFile.type },
        });
      } catch (uploadError) {
        if (uploadError instanceof DOMException && uploadError.name === "AbortError") throw uploadError;
        throw new Error("浏览器无法连接 OSS 上传视频，请刷新页面后重试；若仍失败，请检查 OSS 是否允许 shotprint.xyz 跨域 PUT。");
      }
      if (!uploadResponse.ok) throw new Error("视频直传 OSS 失败。请检查存储桶 CORS 后重试。");
      setPhase("analyzing"); setProgress(68);
      let response = await fetch(apiUrl("/api/analyze"), {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ objectKey: session.objectKey, uploadToken: session.uploadToken, mimeType: targetFile.type, durationMs: metadata.durationMs, localCuts }),
      });
      if (response.status === 202) {
        const accepted = await readSafeApiJson<{ analysisJobId?: string; pollAfterMs?: number }>(response, "分析任务没有正常开始");
        if (!accepted.analysisJobId) throw new Error("分析任务没有返回查询凭证，请重新上传。");
        activeUpload = null;
        const deadline = Date.now() + 15 * 60 * 1000;
        let pollDelay = Math.max(1000, Math.min(5000, Number(accepted.pollAfterMs) || 2000));
        while (Date.now() < deadline) {
          await new Promise((resolve) => window.setTimeout(resolve, pollDelay));
          if (controller.signal.aborted) throw new DOMException("已取消", "AbortError");
          response = await fetch(apiUrl(`/api/analyze/jobs/${encodeURIComponent(accepted.analysisJobId)}`), { signal: controller.signal, cache: "no-store" });
          if (response.status !== 202) break;
          setProgress((current) => Math.min(94, current + 1));
          pollDelay = Math.min(5000, Math.round(pollDelay * 1.15));
        }
        if (response.status === 202) throw new Error("300秒视频分析超过15分钟仍未完成；后台会继续清理临时文件，请稍后重试。");
      }
      const payload = await readSafeApiJson<{ result?: unknown; error?: string }>(response, "分析服务没有返回完整结果");
      activeUpload = null;
      if (!response.ok || !payload.result) throw new Error(payload.error || "模型没有返回可用结果。");
      const parsed = analysisResultSchema.parse(payload.result);
      setAnalysis(parsed); setPhase("ready"); setProgress(100); setIsDemo(false); setTab("shots");
      if (pendingLinkPayload) {
        setLinkStage(5); setLinkPhase("analyzing");
        try {
          const { evidence, digest } = buildResearchRequest(pendingLinkPayload);
          const clip = (value: string, length = 180) => value.slice(0, length);
          const compactShots = sampleTimelineItems(parsed.shots, 72);
          const compactVideoAnalysis = {
            metadata: { title: clip(parsed.metadata.title, 120), durationMs: parsed.metadata.durationMs, aspectRatio: clip(parsed.metadata.aspectRatio, 32) },
            shots: compactShots.map((shot) => ({ startMs: shot.startMs, endMs: shot.endMs, narrativeFunction: clip(shot.narrativeFunction), action: clip(shot.action), shotSize: clip(shot.shotSize), camera: clip(shot.camera), motion: clip(shot.motion), lighting: clip(shot.lighting), transcript: clip(shot.transcript), audio: clip(shot.audio), evidence: clip(shot.evidence), confidence: shot.confidence })),
            narrative: Object.fromEntries(Object.entries(parsed.narrative).filter(([key]) => !["pace", "stats"].includes(key)).map(([key, value]) => [key, typeof value === "string" ? clip(value, 300) : value])),
            productionHypotheses: parsed.productionHypotheses.slice(0, 12).map((item) => ({ category: clip(item.category, 80), estimate: clip(item.estimate, 240), evidence: clip(item.evidence, 240), confidence: item.confidence })),
            reusableTemplate: Object.fromEntries(Object.entries(parsed.reusableTemplate).map(([key, values]) => [key, values.slice(0, 12).map((value) => clip(value, 300))])),
          };
          const hasAudibleEvidence = parsed.shots.some((shot) => [shot.transcript, shot.audio].some((value) => value.trim() && value.trim().toLowerCase() !== "unknown"));
          const audioStatus = targetAudioPresent === false ? "missing" : targetAudioPresent === true || hasAudibleEvidence ? "detected" : "unknown";
          const aspectRatio = parsed.metadata.aspectRatio || (metadata.width && metadata.height ? `${metadata.width}:${metadata.height}` : "unknown");
          const collectionDetails = { engine: pendingLinkPayload.engine, strategyVersion: pendingLinkPayload.strategyVersion, sampleCount: evidence.receipt.originalSampleCount, evidenceSampleCount: evidence.receipt.evidenceSampleCount, targetCount: pendingLinkPayload.targetCount, pageCount: pendingLinkPayload.pageCount, cursorCount: pendingLinkPayload.cursorCount, scrollActions: pendingLinkPayload.scrollActions, durationMs: pendingLinkPayload.durationMs, stopReason: pendingLinkPayload.stopReason, continuationAvailable: pendingLinkPayload.continuationAvailable, sortMode: pendingLinkPayload.sortMode };
          const linkResponse = await fetch(apiUrl("/api/link-analyze"), { method: "POST", headers: { "content-type": "application/json", "x-shotprint-contract": digest.contract }, signal: controller.signal, body: JSON.stringify({ url: pendingLinkPayload.url, platform: pendingLinkPayload.platform, title: pendingLinkPayload.title, author: pendingLinkPayload.author, description: pendingLinkPayload.description, videoId: pendingLinkPayload.videoId, publishedAt: pendingLinkPayload.publishedAt, coverUrl: pendingLinkPayload.coverUrl, method: pendingLinkPayload.collectionId ? "extension" : "manual", researchSessionId, videoAnalysis: compactVideoAnalysis, videoEvidence: { acquisition: targetAcquisition, audioStatus, visualStatus: "complete", durationMs: parsed.metadata.durationMs, aspectRatio, shotCount: parsed.shots.length, analyzedAt: parsed.metadata.analyzedAt, warnings: audioStatus === "missing" ? ["VIDEO_AUDIO_MISSING：仅完成纯画面分析，声音字段为unknown。"] : audioStatus === "unknown" ? ["视频音轨状态无法确认；未将未检测到写成没有。"] : [] }, videoPageEvidence, collectionDetails }) });
          if (!linkResponse.ok) throw new Error(await readSafeApiError(linkResponse, "视频报告合并失败"));
          const linkData = await linkResponse.json() as { result?: LinkAnalysis; error?: string };
          if (!linkResponse.ok || !linkData.result) throw new Error(linkData.error || "视频已完成，但链接报告未能合并。可直接重试链接分析。");
          setLinkAnalysis(mergeLocalAudienceEvidence(linkData.result, evidence.comments, pendingLinkPayload.collectionId ? "extension" : "manual", collectionDetails)); setLinkPhase("ready"); setLinkStage(5); setLinkError("");
        } catch (linkCaught) {
          if (linkCaught instanceof DOMException && linkCaught.name === "AbortError") throw linkCaught;
          setLinkPhase("error"); setLinkError(linkCaught instanceof Error ? linkCaught.message : "视频已完成，但链接报告合并失败。");
        }
      }
      window.setTimeout(() => document.getElementById("result")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (caught) {
      if (activeUpload) void fetch(apiUrl("/api/upload-session"), { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(activeUpload), keepalive: true });
      if (caught instanceof DOMException && caught.name === "AbortError") { setPhase("idle"); setProgress(0); return; }
      setError(caught instanceof Error ? caught.message : "分析意外中断，请重试。"); setPhase("error");
    } finally {
      if (analysisRunRef.current === runId) analysisRunRef.current = null;
    }
  }

  const seek = (index: number) => {
    if (!analysis) return;
    const time = analysis.shots[index].startMs; setActiveShot(index); setPlayhead(time);
    if (videoRef.current) videoRef.current.currentTime = time / 1000;
  };

  const updateTemplate = (key: keyof AnalysisResult["reusableTemplate"], value: string) => {
    if (!analysis) return;
    setAnalysis({ ...analysis, reusableTemplate: { ...analysis.reusableTemplate, [key]: value.split("\n").filter(Boolean) } });
  };

  const exportResult = (kind: "json" | "md" | "csv") => {
    if (!analysis) return;
    if (kind === "json") download("shotprint-analysis.json", JSON.stringify(analysis, null, 2), "application/json");
    if (kind === "md") download("shotprint-blueprint.md", analysisToMarkdown(analysis), "text/markdown");
    if (kind === "csv") download("shotprint-shots.csv", analysisToCsv(analysis), "text/csv");
  };

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "shots", label: "逐镜拆解", count: analysis?.shots.length }, { id: "narrative", label: "叙事曲线" },
    { id: "production", label: "参数推测" }, { id: "template", label: "复用模板" },
  ];

  const demoFrame = useMemo(() => {
    const palettes = displayPalette(currentShot?.palette);
    return { background: `radial-gradient(circle at ${32 + activeShot * 5}% ${28 + activeShot * 3}%, ${palettes[1]} 0, transparent 22%), linear-gradient(${110 + activeShot * 7}deg, ${palettes[0]}, #11131a 68%)` };
  }, [activeShot, currentShot]);

  return (
    <main id="main-content">
      <a className="skip-link" href="#workspace">跳到分析工作台</a>
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="镜谱首页"><span className="mark">镜</span><span>镜谱 <i>SHOTPRINT</i></span></a>
        <nav aria-label="页面导航"><a href="#how">拆解逻辑</a><a href="#link-result">链接分析台</a><a href="#result">分析台</a><span className="status-dot">本地优先</span></nav>
      </header>

      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div className="hero-kicker"><span>SHOTPRINT / 镜谱</span><i>AI FILM FORENSICS</i></div>
          <h1 id="hero-title">从热议到镜头，<br /><span>逐帧有据。</span></h1>
          <p className="lede">识别一条短片为什么被看见、被共鸣、被争议，再把传播证据与真实时间码合成一份可编辑的创作蓝图。</p>
          <div className="evidence-reel" aria-hidden="true">
            <i className="reel-playhead" />
            <span><small>00:00</small><b>钩子</b></span>
            <span><small>00:03.8</small><b>切点</b></span>
            <span><small>00:11.2</small><b>共鸣</b></span>
            <span><small>00:20.8</small><b>蓝图</b></span>
          </div>
          <div className="hero-notes"><span>01 本机找切点</span><span>02 百炼读视听</span><span>03 证据化推测</span></div>
        </div>

        <div className="ingest-card" id="workspace">
          <div className="card-head"><div><i /><span>新建分析</span></div><span className="mono">WORKSPACE / 001</span></div>
          <div className="ingest-mode" role="tablist" aria-label="分析输入方式"><button className={inputMode === "link" ? "active" : ""} onClick={() => setInputMode("link")} role="tab" aria-selected={inputMode === "link"}>分析公开视频</button><button className={inputMode === "video" ? "active" : ""} onClick={() => setInputMode("video")} role="tab" aria-selected={inputMode === "video"}>拆解本地视频</button></div>
          <div className="sr-only"><input ref={fileInput} type="file" accept="video/mp4,video/quicktime,video/webm" aria-label="选择视频文件" onChange={handleInput} /><input ref={downloadedFileInput} type="file" accept="video/mp4,video/quicktime" aria-label="选择从GreenVideo下载的视频文件" onChange={handleDownloadedInput} /><span>我拥有该素材的分析权利</span><span>开始逐镜拆解（选择文件后自动运行）</span><span>打开 20.8 秒合成样片</span></div>
          {inputMode === "link" ? <div className="link-ingest">
            <label htmlFor="source-link">原视频链接</label>
            <div className="link-input-shell"><span aria-hidden="true">URL</span><input ref={linkInputRef} id="source-link" name="source-link" type="url" autoComplete="off" spellCheck={false} value={link} onChange={(event) => handleLinkChange(event.target.value)} placeholder="粘贴抖音、B站或小红书原链接…" inputMode="url" /></div>
            <div className="link-detect" role="status" aria-live="polite"><span className={`platform-mini ${linkPlatform}`}>{linkPlatform === "douyin" ? "抖音" : linkPlatform === "bilibili" ? "B站" : linkPlatform === "xiaohongshu" ? "小红书" : "等待链接"}</span><span>{linkPhase === "collecting" ? "正在打开原页面并读取已加载评论…" : linkPhase === "analyzing" ? "评论已到达，正在组织证据…" : bridgeStatus === "ready" ? (linkPlatform === "unknown" ? "扩展已连接；粘贴链接后点击开始" : "链接已识别；点击下方按钮后自动注入取证脚本") : bridgeStatus === "old" ? `检测到旧版扩展；请重新加载 ${EXTENSION_VERSION}` : bridgeStatus === "checking" ? "正在检查取证桥…" : "未检测到取证桥；重新加载扩展后刷新网页"}</span></div>
            <details className="system-check">
              <summary><span>系统就绪度</span><b className={bridgeStatus === "ready" && backendStatus !== "checking" ? "ready" : "waiting"}>{bridgeStatus === "ready" ? "取证桥已连接" : "需要检查"}</b></summary>
              <div className="link-self-check" role="status"><span>扩展 {bridgeDiagnostics?.version || (bridgeStatus === "old" ? "旧版" : "待检查")}</span><span>{bridgeStatus === "ready" ? "主采集通道可用" : bridgeStatus === "old" ? "版本过旧" : bridgeStatus === "missing" ? "桥接未连接" : "桥接检查中"}</span><span>{bridgeDiagnostics?.companion?.ok ? `高级兜底 ${bridgeDiagnostics.companion.version || "已运行"}` : "高级兜底未启动（不影响主采集）"}</span>{bridgeDiagnostics?.companion?.ok && <><span>{bridgeDiagnostics.companion.browserAct === "installed" ? "BrowserAct已安装" : "BrowserAct待检查"}</span><span>{bridgeDiagnostics.companion.chromeDirect ? "Chrome直连已配置" : "Chrome直连未配置"}</span><span>{linkPlatform === "unknown" ? "平台登录待检测" : bridgeDiagnostics.companion.platformStatus?.[linkPlatform] === "ready" ? `${linkPlatform}页面可读` : bridgeDiagnostics.companion.platformStatus?.[linkPlatform] === "login_required" ? `${linkPlatform}需要登录` : `${linkPlatform}登录状态未知`}</span><span>{pairingStatus === "paired" || bridgeDiagnostics.companion.paired ? "伴侣已配对" : "伴侣待配对"}</span></>}<span>{backendStatus === "aliyun" ? "阿里云分析后端正常" : backendStatus === "fallback" ? "分析后端回退到Sites" : "分析后端检查中"}</span><span>{searchStatus === "configured" ? "百炼联网已配置" : searchStatus === "disabled" ? "联网搜索不可用" : "联网搜索检查中"}</span><button className="diagnostic-copy" type="button" onClick={() => void downloadExtensionPackage()}>下载0.6.9扩展</button><button className="diagnostic-copy" type="button" onClick={() => void copyDiagnostics()}>{diagnosticCopied ? "已复制安全诊断" : "复制安全诊断信息"}</button></div>
            </details>
            {bridgeDiagnostics?.companion?.ok && !(pairingStatus === "paired" || bridgeDiagnostics.companion.paired) && <div className="companion-pair"><label htmlFor="companion-code">本地伴侣配对码</label><input id="companion-code" inputMode="numeric" maxLength={6} value={pairingCode} onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6位配对码" /><button className="secondary" disabled={pairingStatus === "pairing"} onClick={() => void pairCompanion()}>{pairingStatus === "pairing" ? "配对中…" : "配对本地伴侣"}</button></div>}
            <div className="link-stages" aria-label="链接分析六阶段">{LINK_STAGES.map((stage, index) => { const status = linkStageStatus(index, linkPhase, linkStage, linkPlatform !== "unknown"); return <div className={status} key={stage}><span>0{index + 1}</span><b>{stage}</b><small>{status === "done" ? "已完成" : status === "active" ? "进行中" : "等待"}</small></div>; })}</div>
            <button className="primary link-primary" disabled={!link || bridgeStatus !== "ready" || ["collecting", "continuing", "researching", "cross-checking", "recording"].includes(linkPhase)} onClick={runLinkCollection}>{linkPhase === "collecting" ? "采集首批100条评论…" : bridgeStatus === "old" ? "请先更新扩展" : bridgeStatus !== "ready" ? "请先重新加载扩展" : "开始采集100条评论 →"}</button>
            {pendingLinkPayload && ["comments-ready", "error"].includes(linkPhase) && <div className="collection-checkpoint" role="status">
              <b>已取得 {pendingLinkPayload.comments.length} / {pendingLinkPayload.targetCount || (pendingLinkPayload.collectionId ? 100 : pendingLinkPayload.comments.length)} 条匿名评论</b>
              <span>{pendingLinkPayload.engine === "browser-act-network" ? "BrowserAct网络响应" : pendingLinkPayload.engine === "browser-act-dom" ? "BrowserAct DOM兜底" : pendingLinkPayload.engine === "extension-api" ? "页面接口" : "扩展DOM"} · {pendingLinkPayload.pageCount || pendingLinkPayload.cursorCount || 0} 页/游标 · 滚动 {pendingLinkPayload.scrollActions || 0} 次 · {Math.round((pendingLinkPayload.durationMs || 0) / 1000)} 秒 · {pendingLinkPayload.stopReason || "手动导入"} · 当前排序 {pendingLinkPayload.sortMode || "unknown"}</span>
              {pendingLinkPayload.comments.length < 100 && <small>样本不足100条，结果可能偏向页面当前排序与先加载的评论。</small>}
              <div><button className="secondary" disabled={!pendingLinkPayload.continuationAvailable || linkPhase === "continuing"} onClick={continueLinkCollection}>{linkPhase === "continuing" ? "续采中…" : "继续采集至200条"}</button><button className="primary" onClick={() => void runDeepResearch()}>用现有样本开始深度研究</button></div>
            </div>}
            {["researching", "cross-checking"].includes(linkPhase) && <div className="research-live" role="status"><b>{linkPhase === "cross-checking" ? "正在交叉核验" : "正在执行8类深度检索"}</b><span>{researchProgress.completedQueries} / {researchProgress.totalQueries} 组查询 · {researchProgress.sourceCount} 个来源 · {researchProgress.domainCount} 个域名</span><i><em style={{ width: `${Math.min(100, (researchProgress.completedQueries / Math.max(1, researchProgress.totalQueries)) * 100)}%` }} /></i></div>}
            {linkAnalysis && linkPhase === "awaiting-video" && <div className="video-evidence-gate" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const selected = event.dataTransfer.files?.[0]; if (selected) void chooseFile(selected, "download_upload"); }}>
              <b>社会原因与观众反馈已完成 · 现在补充原片证据</b>
              <span>推荐下载公开原片后分析。返回本页选择文件即自动完成上传、视听取证和最终报告合并。</span>
              <label className="consent"><input type="checkbox" checked={consent} onChange={(event) => handleConsentChange(event.target.checked)} /><span>我拥有该素材的分析权利，并同意临时上传到私有 OSS 与阿里云百炼分析</span></label>
              <div className="video-evidence-options">
                <div className="recommended"><small>推荐</small><b>下载原片并分析</b><span>复制当前链接并打开GreenVideo；下载MP4后回到这里。</span><button className="primary" type="button" onClick={() => void openGreenVideo()}>复制链接并打开 GreenVideo ↗</button><button className="secondary" type="button" onClick={() => downloadedFileInput.current?.click()}>选择已下载的 MP4 / MOV</button></div>
                <div><small>已有文件</small><b>上传已有视频</b><span>直接选择你电脑中的MP4/MOV；选择后自动分析。</span><button className="secondary" type="button" onClick={() => fileInput.current?.click()}>选择本地视频</button></div>
                <div><small>无法下载时</small><b>录制原视频标签页</b><span>选择原视频标签页并勾选共享音频，最长300秒。</span><button className="secondary" type="button" onClick={() => void startTabCapture()}>开始标签页录制</button></div>
              </div>
              <div className="download-drop">把GreenVideo下载的 MP4 / MOV 拖到这里</div>
              {file && <small>{file.name} · {(file.size / 1024 / 1024).toFixed(1)}MB · {phase === "idle" ? consent ? "即将自动分析" : "等待勾选授权" : PHASE_COPY[phase]}</small>}
              {captureWarning && <small>{captureWarning}</small>}
            </div>}
            {linkPhase === "recording" && <div className="recording-live" role="status"><b>● {recordingPaused ? "录制已暂停" : "正在录制标签页"}</b><span>{recordingSeconds}s / 300s · {(recordingBytes / 1024 / 1024).toFixed(1)}MB / 300MB</span>{captureWarning && <small>{captureWarning}</small>}<div><button className="secondary" onClick={toggleTabCapturePause}>{recordingPaused ? "继续录制" : "暂停"}</button><button className="secondary" onClick={stopTabCapture}>停止并使用这段录制</button></div></div>}
            {linkError && <div className="link-error"><b>采集没有继续</b><span>{linkError}</span><button onClick={() => setLinkError("")}>知道了</button></div>}
            <details className="manual-import"><summary>遇到验证码 / 403 / 429？改用手动评论</summary><p>每行粘贴一条公开评论；不上传账号、头像或用户 ID。评论只用于本次报告，刷新后即清除。</p><textarea value={manualComments} onChange={(event) => setManualComments(event.target.value)} placeholder="例如：第一秒就被吸引了\n这个转场太丝滑\n想看同系列第二集" rows={4} /><button className="secondary" disabled={!manualComments.trim() || linkPhase === "analyzing"} onClick={runManualLinkAnalysis}>用手动评论生成报告</button></details>
            <p className="link-risk">登录态只在你的浏览器里使用；镜谱不接收 Cookie、用户名、头像或用户 ID。遇到验证码、403 或 429 会停止。</p>
            <button className="fixture-link" onClick={loadLinkDemo}>打开链接分析演示夹具（不代表实时采集）</button>
          </div> : <div className={`dropzone ${file ? "has-file" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
            <button className="drop-button" onClick={() => fileInput.current?.click()} aria-label="选择视频文件">
              <span className="film-hole">＋</span>
              {file ? <><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(1)} MB · {phase === "idle" ? consent ? "即将自动分析" : "等待授权" : PHASE_COPY[phase]}</small></> : <><strong>把成片放到这里</strong><small>MP4 / MOV 优先 · WebM仅录制兜底 · ≤ 300 秒 · ≤ 300MB</small></>}
            </button>
            <div className="drop-rule" />
            {captureWarning && <p className="capture-warning">{captureWarning}</p>}
            <label className="consent"><input type="checkbox" checked={consent} onChange={(event) => handleConsentChange(event.target.checked)} /><span>我拥有该素材的分析权利，并同意临时上传到私有 OSS 与阿里云百炼分析</span></label>
            {phase === "error" && <button className="primary" disabled={!file || !consent} onClick={() => void runAnalysis()}>重试自动分析 →</button>}
          </div>}

          {phase !== "idle" && phase !== "ready" && <div className="progress-wrap" role="status" aria-live="polite"><div><span>{PHASE_COPY[phase]}</span><b>{progress}%</b></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div>{!["error"].includes(phase) && <button onClick={() => abortRef.current?.abort()}>取消</button>}</div>}
          {error && <div className="error-box"><b>没有继续分析</b><span>{error}</span><button onClick={reset}>重新开始</button></div>}
          <div className="demo-line"><span>{inputMode === "link" ? "只想看完整分析台？" : "没有素材或 API 额度？"}</span><button onClick={inputMode === "link" ? loadLinkDemo : loadDemo}>{inputMode === "link" ? "打开链接分析演示" : "打开 20.8 秒合成样片"}</button></div>
        </div>
      </section>

      <section className="proof-strip" id="how">
        <div><b>4 FPS</b><span>本机画面采样</span></div><div><b>±0.5s</b><span>切点匹配容差</span></div><div><b>4 层</b><span>镜头 / 叙事 / 参数 / 模板</span></div><div><b>0</b><span>长期保存的视频</span></div>
      </section>

      {linkAnalysis && <LinkAnalysisDesk report={linkAnalysis} fixture={linkFixture} />}

      {analysis ? <section className="studio" id="result">
        <div className="studio-head">
          <div><p className="eyebrow">ANALYSIS DESK / 分析台</p><h2>{analysis.metadata.title}</h2><p>{analysis.narrative.logline}</p></div>
          <div className="actions"><button onClick={() => setEditing((value) => !value)}>{editing ? "完成编辑" : "编辑模板"}</button><button onClick={() => exportResult("json")}>JSON</button><button onClick={() => exportResult("md")}>Markdown</button><button onClick={() => exportResult("csv")}>CSV</button></div>
        </div>

        <div className="viewer-grid">
          <div className="viewer">
            {videoUrl && !isDemo ? <video ref={videoRef} src={videoUrl} controls onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime * 1000)} /> : <button className="demo-video" style={demoFrame} onClick={() => setPlaying((value) => !value)} aria-label={playing ? "暂停演示样片" : "播放演示样片"}><span className="scene-index">SCENE {String(activeShot + 1).padStart(2, "0")}</span><span className="demo-figure" /><b>{currentShot?.transcript || currentShot?.action}</b><i>{playing ? "Ⅱ" : "▶"}</i></button>}
            <div className="timecode"><span>{formatTime(playhead)}</span><span>{formatTime(duration)}</span></div>
          </div>
          <aside className="shot-inspector"><span className="mono">CURRENT SHOT</span><b>{String(activeShot + 1).padStart(2, "0")}</b><h3>{currentShot?.narrativeFunction}</h3><p>{currentShot?.action}</p><dl><div><dt>景别</dt><dd>{currentShot?.shotSize}</dd></div><div><dt>运动</dt><dd>{currentShot?.motion}</dd></div><div><dt>判断</dt><dd>{Math.round((currentShot?.confidence || 0) * 100)}%</dd></div></dl><span className={`boundary ${currentShot?.localBoundary ? "matched" : ""}`}>{currentShot?.localBoundary ? "● 本机切点吻合" : "○ 仅模型判断"}</span></aside>
        </div>

        <div className="timeline" aria-label="镜头时间轴">{analysis.shots.map((shot, index) => <button key={shot.id} className={index === activeShot ? "active" : ""} style={{ flexGrow: shot.endMs - shot.startMs }} onClick={() => seek(index)}><span>{String(index + 1).padStart(2, "0")}</span><i style={{ background: `linear-gradient(135deg, ${displayPalette(shot.palette).join(",")})` }} /></button>)}</div>

        <div className="tabs" role="tablist">{tabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}{item.count ? <sup>{item.count}</sup> : null}</button>)}</div>

        <div className="tab-panel">
          {tab === "shots" && <div className="shot-list">{analysis.shots.map((shot, index) => <button key={shot.id} onClick={() => seek(index)} className={index === activeShot ? "active" : ""}><span className="shot-no">{String(index + 1).padStart(2, "0")}</span><span className="shot-thumb" style={{ background: `linear-gradient(135deg, ${displayPalette(shot.palette).join(",")})` }} /><span className="shot-copy"><b>{shot.narrativeFunction}</b><small>{shot.action}</small></span><span className="shot-tech"><b>{formatTime(shot.startMs)} → {formatTime(shot.endMs)}</b><small>{shot.shotSize} · {shot.camera} · {shot.motion}</small></span><span className="confidence">{Math.round(shot.confidence * 100)}%</span></button>)}</div>}
          {tab === "narrative" && <NarrativePanel analysis={analysis} />}
          {tab === "production" && <ProductionPanel analysis={analysis} />}
          {tab === "template" && <TemplatePanel analysis={analysis} editing={editing} update={updateTemplate} />}
        </div>

        <div className="warning-band"><span>判断边界</span><p>{analysis.warnings.join(" · ")}</p><b>{analysis.provenance.model}</b></div>
      </section> : !linkAnalysis && <section className="empty-blueprint"><span className="big-number">04</span><div><p className="eyebrow">OUTPUT / 输出结构</p><h2>不是一份“看起来很懂”的总结。</h2><p>每个判断都回到时间码、画面证据和置信度。不能从成片恢复的参数，镜谱会直接说不知道。</p></div><ol><li>逐镜拆解</li><li>叙事曲线</li><li>生产假设</li><li>复用模板</li></ol></section>}

      <footer><div className="wordmark"><span className="mark">镜</span><span>镜谱 <i>SHOTPRINT</i></span></div><p>复刻结构，不复制身份。所有生产参数均为证据化推测。</p><button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>回到片头 ↑</button></footer>
    </main>
  );
}

function NarrativePanel({ analysis }: { analysis: AnalysisResult }) {
  const items = [["钩子", analysis.narrative.hook], ["冲突", analysis.narrative.conflict], ["升级", analysis.narrative.escalation], ["反转", analysis.narrative.reversal], ["高潮", analysis.narrative.climax], ["收束", analysis.narrative.resolution]];
  return <div className="narrative-grid"><div className="curve-card"><div className="curve-head"><span>情绪张力 / 0–100</span><b>平均镜长 {analysis.narrative.stats.averageShotSeconds}s</b></div><div className="curve" aria-label="叙事情绪曲线">{analysis.narrative.pace.map((point, index) => <div key={point.label} style={{ height: `${point.intensity}%` }}><i /><span>{point.label}</span><small>{Math.round(point.timeMs / 1000)}s</small>{index < analysis.narrative.pace.length - 1 && <em />}</div>)}</div></div><div className="beat-list">{items.map(([label, value], index) => <div key={label}><span>{String(index + 1).padStart(2, "0")}</span><p><b>{label}</b>{value}</p></div>)}</div></div>;
}

function ProductionPanel({ analysis }: { analysis: AnalysisResult }) {
  return <div className="hypothesis-grid">{analysis.productionHypotheses.map((item, index) => <article key={item.category}><div><span>HYPOTHESIS {String(index + 1).padStart(2, "0")}</span><b>{Math.round(item.confidence * 100)}%</b></div><h3>{item.category}</h3><p>{item.estimate}</p><small><b>画面证据</b>{item.evidence}</small><i style={{ width: `${item.confidence * 100}%` }} /></article>)}</div>;
}

function TemplatePanel({ analysis, editing, update }: { analysis: AnalysisResult; editing: boolean; update: (key: keyof AnalysisResult["reusableTemplate"], value: string) => void }) {
  const sections: Array<[keyof AnalysisResult["reusableTemplate"], string, string]> = [["storyVariables", "故事变量", "把原片身份换成你自己的世界"], ["beatSheet", "节拍表", "按占比复用，不照抄剧情"], ["globalVisualRules", "视觉圣经", "让跨镜头质感保持一致"], ["shotPrompts", "逐镜提示词骨架", "填空后交给视频模型"], ["negativeConstraints", "负面约束", "防止复刻越界和常见崩坏"], ["editAndSound", "剪辑与声音", "把节奏落到时间线上"]];
  return <div className="template-grid">{sections.map(([key, title, hint], index) => <article key={key}><span className="template-index">T{String(index + 1).padStart(2, "0")}</span><div><h3>{title}</h3><small>{hint}</small></div>{editing ? <textarea aria-label={`编辑${title}`} value={analysis.reusableTemplate[key].join("\n")} onChange={(event) => update(key, event.target.value)} /> : <ul>{analysis.reusableTemplate[key].map((item) => <li key={item}>{item}</li>)}</ul>}</article>)}</div>;
}
