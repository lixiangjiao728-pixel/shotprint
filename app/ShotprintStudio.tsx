"use client";

import { ChangeEvent, DragEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalysisResult, analysisResultSchema, analysisToCsv, analysisToMarkdown, formatTime, sampleTimelineItems } from "../lib/analysis";
import { demoAnalysis } from "../lib/demo-data";
import LinkAnalysisDesk from "./LinkAnalysisDesk";
import { detectPlatform, mergeLocalAudienceEvidence, type LinkAnalysis, type SupportedPlatform } from "../lib/link-analysis";
import { demoLinkAnalysis } from "../lib/link-demo-data";
import { buildResearchRequest, readSafeApiError, readSafeApiJson } from "../lib/comment-evidence";
import { compareExtensionVersions, extensionCompatibility } from "../lib/extension-version";
import { shareLinks } from "../lib/share-link";
import { mp4Tracks } from "../lib/mp4-tracks";

type Phase = "idle" | "reading" | "detecting" | "uploading" | "analyzing" | "ready" | "error";
type Tab = "shots" | "narrative" | "production" | "template";
type InputMode = "link" | "video";
type LinkPhase = "idle" | "collecting" | "comments-ready" | "continuing" | "researching" | "cross-checking" | "analyzing" | "awaiting-video" | "recording" | "ready" | "error";
type BridgeStatus = "checking" | "ready" | "missing" | "old";
type SearchStatus = "checking" | "configured" | "disabled";
type BackendStatus = "checking" | "aliyun" | "fallback" | "unavailable";
type BridgeDiagnostics = { version?: string; bridge?: string; permissions?: Record<string, boolean>; activeJobs?: number; platform?: string; stage?: string; errorCode?: string; requestId?: string; companion?: { ok?: boolean; version?: string; browserAct?: string; chromeDirect?: boolean; paired?: boolean; code?: string; platformStatus?: Partial<Record<SupportedPlatform, string>> } };
type LinkPayload = {
  commentStatus?: "unavailable" | "empty";
  url: string; platform?: SupportedPlatform; title?: string; author?: string; description?: string; videoId?: string; keywords?: string; publishedAt?: string; coverUrl?: string;
  comments: unknown[]; warnings?: string[]; collectedAt?: string; collectionId?: string; targetCount?: number;
  engine?: "extension-api" | "extension-dom" | "browser-act-network" | "browser-act-dom"; strategyVersion?: string; sampleCount?: number; pageCount?: number; cursorCount?: number;
  scrollActions?: number; durationMs?: number; stopReason?: string; continuationAvailable?: boolean; sortMode?: string;
};
type VideoPageEvidence = { title: string; durationMs: number; width: number; height: number; playerReady: boolean; muted: boolean; sharedAudioDetected: boolean | null; captions?: string };
type ResearchProgress = { category?: string; completedQueries: number; totalQueries: number; sourceCount: number; domainCount: number; costCny?: number; message?: string };
const EXTENSION_VERSION = "0.7.1";
const MAX_VIDEO_DURATION_SECONDS = 300;
const MAX_VIDEO_DURATION_MS = MAX_VIDEO_DURATION_SECONDS * 1000;
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
const COLLECTION_LOAD_WATCHDOG_MS = 55000;
const COLLECTION_STALL_WATCHDOG_MS = 18000;
const LINK_STAGES = ["读观众反应", "补齐评论", "查找背景", "核对判断", "拆开镜头", "整理方案"] as const;

function displayPalette(palette?: string[]) {
  if (!palette?.length) return ["#101218", "#A8C7C0"];
  return [palette[0], palette[1] ?? palette[0]];
}

function linkStageStatus(index: number, phase: LinkPhase, activeStage: number, recognized: boolean) {
  if (phase === "ready") return "done";
  if (phase === "idle") return recognized && index === 0 ? "done" : "pending";
  return index < activeStage ? "done" : index === activeStage ? "active" : "pending";
}

function moveTabFocus<T extends string>(event: KeyboardEvent<HTMLButtonElement>, tabs: readonly T[], active: T, update: (tab: T) => void) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const activeIndex = tabs.indexOf(active);
  const nextIndex = event.key === "Home" ? 0
    : event.key === "End" ? tabs.length - 1
      : (activeIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  const next = tabs[nextIndex];
  const tablist = event.currentTarget.parentElement;
  update(next);
  window.requestAnimationFrame(() => {
    tablist?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
  });
}

const PHASE_COPY: Record<Phase, string> = {
  idle: "等待选择视频", reading: "读取视频", detecting: "查找转场", uploading: "上传视频",
  analyzing: "拆解镜头和节奏", ready: "分析完成", error: "分析失败",
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
  const response = await fetch("/shotprint-extension-0.7.1.zip.b64", { cache: "no-store" });
  if (!response.ok) throw new Error("扩展安装包下载失败");
  const binary = atob((await response.text()).trim());
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "shotprint-extension-0.7.1.zip"; anchor.click();
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
  const [backendRetry, setBackendRetry] = useState(0);
  const [mediaStatus, setMediaStatus] = useState<"idle" | "fetching" | "ready" | "manual">("idle");
  const [mediaNotice, setMediaNotice] = useState("");
  const chainRef = useRef("");
  const mediaChainRef = useRef("");
  const researchChainRef = useRef("");
  const mediaTokenRef = useRef("");
  const researchBusyRef = useRef(false);
  const researchControllerRef = useRef<AbortController | null>(null);
  const researchJobRef = useRef<{ key: string; taskId?: string; jobId?: string; result?: { researchSessionId?: string; receipt?: ResearchProgress } }>({ key: "" });
  const analysisReceiptRef = useRef<{ file: File | null; taskId?: string; jobId?: string; result?: AnalysisResult }>({ file: null });
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
  const apiUrl = useCallback((path: string) => {
    if (backendStatus === "checking" || backendStatus === "unavailable") throw new Error("分析服务暂时无法连接。评论和视频会保留，请恢复连接后继续。");
    return joinApi(apiBase, path);
  }, [apiBase, backendStatus]);
  const linkBusy = ["collecting", "continuing", "researching", "cross-checking", "recording"].includes(linkPhase);
  const extensionActionNeeded = bridgeStatus === "missing" || bridgeStatus === "old";

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
      if (!Array.isArray(payload.comments) || (payload.comments.length === 0 && !payload.commentStatus)) {
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
      if (!response.ok) throw new Error("BACKEND_CONFIGURATION_UNAVAILABLE");
      const payload = await response.json() as { search?: { status?: string }; backend?: { apiBase?: string } };
      const external = payload.backend?.apiBase?.trim() || "";
      setApiBase(external);
      if (!external) {
        setBackendStatus("fallback");
        setSearchStatus(payload.search?.status === "configured" ? "configured" : "disabled");
        return;
      }
      const health = await fetch(joinApi(external, "/health"), { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!health.ok) throw new Error("ALIYUN_BACKEND_UNAVAILABLE");
      const externalStatus = await fetch(joinApi(external, "/api/link-analyze"), { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!externalStatus.ok) throw new Error("ALIYUN_BACKEND_UNAVAILABLE");
      const externalPayload = await externalStatus.json() as { search?: { status?: string } };
      setApiBase(external); setBackendStatus("aliyun");
      setSearchStatus(externalPayload.search?.status === "configured" ? "configured" : "disabled");
    }).catch(() => { setBackendStatus("unavailable"); setSearchStatus("disabled"); });
  }, [backendRetry]);

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
    chainRef.current = ""; mediaChainRef.current = ""; researchChainRef.current = ""; mediaTokenRef.current = "";
    researchControllerRef.current?.abort();
    setMediaStatus("idle"); setMediaNotice("");
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

  const handleLinkChange = (value: string) => {
    if (linkBusy || mediaStatus === "fetching" || analysisRunRef.current) return;
    const candidates = shareLinks(value);
    const selected = candidates.length === 1 ? candidates[0] : value;
    setLink(selected); setLinkPlatform(candidates.length === 1 ? detectPlatform(selected) : "unknown");
    chainRef.current = ""; mediaChainRef.current = ""; researchChainRef.current = ""; linkRequestRef.current = "";
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(null); setVideoUrl(""); setAnalysis(null); setPhase("idle");
    setPendingLinkPayload(null); setResearchSessionId(""); setLinkAnalysis(null); setMediaStatus("idle"); setMediaNotice("");
    setLinkError(candidates.length > 1 ? "找到了多个视频链接，请选择一条。" : ""); setLinkPhase("idle");
  };

  const requestCompanion = useCallback((type: "shotprint:media-read" | "shotprint:companion-health" | "shotprint:pair" | "shotprint:playback-prepare", payload: Record<string, unknown> = {}, timeoutMs = 15000) => new Promise<Record<string, unknown>>((resolve) => {
    const requestId = crypto.randomUUID();
    const timer = window.setTimeout(() => { companionWaitersRef.current.delete(requestId); resolve({ ok: false, code: type === "shotprint:media-read" ? "VIDEO_BRIDGE_TIMEOUT" : "COMPANION_NOT_RUNNING" }); }, timeoutMs);
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
    if (!consent) { setLinkError("请先确认可以分析此视频。"); return; }
    if (!link.trim()) { setLinkPhase("error"); setLinkError("先粘贴一个抖音、B站或小红书链接。"); return; }
    if (linkPlatform === "unknown") { setLinkPhase("error"); setLinkError("暂不识别这个平台，请粘贴完整的原视频链接。"); return; }
    if (bridgeStatus === "old") { setLinkPhase("error"); setLinkError(`检测到旧版扩展，请在扩展管理页重新加载 ${EXTENSION_VERSION}，然后刷新本网页。`); return; }
    if (bridgeStatus !== "ready") { setLinkPhase("error"); setLinkError(`没有检测到浏览器扩展。请在扩展管理页重新加载 ${EXTENSION_VERSION}，然后刷新本页。`); return; }
    chainRef.current = ""; mediaChainRef.current = ""; researchChainRef.current = "";
    setFile(null); setVideoUrl(""); setAnalysis(null); setPhase("idle"); setResearchSessionId(""); setMediaStatus("idle"); setMediaNotice("");
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

  const runDeepResearch = useCallback(async () => {
    const payload = pendingLinkPayload;
    if (!payload) { setLinkPhase("error"); setLinkError("还没有识别视频，请先粘贴链接。"); return; }
    if (researchBusyRef.current) return;
    researchBusyRef.current = true;
    const controller = new AbortController(); researchControllerRef.current = controller;
    const key = payload.collectionId || payload.url;
    if (researchJobRef.current.key !== key) researchJobRef.current = { key, taskId: crypto.randomUUID() };
    const receiptCache = researchJobRef.current;
    receiptCache.taskId ||= crypto.randomUUID();
    setLinkPhase("researching"); setLinkStage(2); setLinkError(""); setLinkAnalysis(null);
    setResearchProgress({ completedQueries: 0, totalQueries: 8, sourceCount: 0, domainCount: 0 });
    try {
      const { evidence, digest, body } = buildResearchRequest(payload);
      let response = receiptCache.result ? Response.json(receiptCache.result) : receiptCache.jobId
        ? await fetch(apiUrl(`/api/link-research/jobs/${encodeURIComponent(receiptCache.jobId)}`), { signal: controller.signal, cache: "no-store" })
        : await fetch(apiUrl("/api/link-research"), { method: "POST", signal: controller.signal, headers: { "content-type": "application/json; charset=utf-8", "x-shotprint-contract": digest.contract, "x-shotprint-task-id": receiptCache.taskId }, body: JSON.stringify(body) });
      if (response.status === 202 && response.headers.get("content-type")?.includes("application/json")) {
        const accepted = receiptCache.jobId ? { researchJobId: receiptCache.jobId, pollAfterMs: 2000 } : await response.json() as { researchJobId?: string; pollAfterMs?: number };
        if (!accepted.researchJobId) throw new Error("公开资料查询没有正常开始，请重试。");
        receiptCache.jobId = accepted.researchJobId;
        const deadline = Date.now() + 8 * 60 * 1000;
        let pollDelay = Math.max(1000, Math.min(5000, Number(accepted.pollAfterMs) || 2000));
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, pollDelay));
          response = await fetch(apiUrl(`/api/link-research/jobs/${encodeURIComponent(accepted.researchJobId)}`), { signal: controller.signal, headers: { "x-shotprint-contract": digest.contract } });
          if (response.status !== 202) break;
          setResearchProgress((current) => ({ ...current, stage: "deep-search" }));
          pollDelay = Math.min(5000, Math.round(pollDelay * 1.15));
        }
        if (response.status === 202) throw new Error("查找公开资料超过 8 分钟仍未完成。请直接重试，不用重新读取评论。");
      }
      const contentType = response.headers.get("content-type") || "";
      let finalResult: { researchSessionId?: string; receipt?: ResearchProgress } | null = null;
      if (contentType.includes("application/json")) {
        const data = await response.json() as { status?: string; researchSessionId?: string; receipt?: ResearchProgress; errorCode?: string; userMessage?: string };
        if (!response.ok || data.status === "failed") {
          if (data.status === "failed") receiptCache.jobId = undefined;
          throw new Error(`${data.errorCode || "SEARCH_PROVIDER_ERROR"}：${data.userMessage || "公开资料查询失败"}`);
        }
        finalResult = data;
        setLinkPhase("cross-checking"); setLinkStage(3);
      } else {
        if (!response.ok || !response.body) throw new Error(await readSafeApiError(response, "公开资料查询没有开始"));
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
          if (event === "failed") throw new Error(`${String(data.errorCode || "SEARCH_PROVIDER_ERROR")}：${String(data.userMessage || "公开资料查询失败")}`);
          if (event === "complete") finalResult = data as { researchSessionId?: string; receipt?: ResearchProgress };
        }
          if (done) break;
        }
      }
      if (!finalResult?.researchSessionId) throw new Error("公开资料查询没有返回结果，请重试。");
      controller.signal.throwIfAborted();
      receiptCache.result = finalResult;
      setResearchSessionId(finalResult.researchSessionId); if (finalResult.receipt) setResearchProgress((current) => ({ ...current, ...finalResult!.receipt }));
      const collectionDetails = { engine: payload.engine, strategyVersion: payload.strategyVersion, sampleCount: evidence.receipt.originalSampleCount, evidenceSampleCount: evidence.receipt.evidenceSampleCount, targetCount: payload.targetCount, pageCount: payload.pageCount, cursorCount: payload.cursorCount, scrollActions: payload.scrollActions, durationMs: payload.durationMs, stopReason: payload.stopReason, continuationAvailable: payload.continuationAvailable, sortMode: payload.sortMode };
      const linkResponse = await fetch(apiUrl("/api/link-analyze"), { method: "POST", headers: { "content-type": "application/json", "x-shotprint-contract": digest.contract }, body: JSON.stringify({ url: payload.url, platform: payload.platform, title: payload.title, author: payload.author, description: payload.description, videoId: payload.videoId, publishedAt: payload.publishedAt, coverUrl: payload.coverUrl, method: payload.collectionId ? "extension" : "manual", researchSessionId: finalResult.researchSessionId, collectionDetails }) });
      if (!linkResponse.ok) throw new Error(await readSafeApiError(linkResponse, "评论和公开资料没有合并成功"));
      const linkData = await linkResponse.json() as { result?: LinkAnalysis; error?: string };
      controller.signal.throwIfAborted();
      if (!linkData.result) throw new Error(linkData.error || "评论和公开资料没有合并成功。");
      setLinkAnalysis(mergeLocalAudienceEvidence(linkData.result, evidence.comments, payload.collectionId ? "extension" : "manual", collectionDetails)); setLinkFixture(false); setLinkPhase("awaiting-video"); setLinkStage(4);
      window.setTimeout(() => document.getElementById("link-result")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (caught) { if (!controller.signal.aborted) { setLinkPhase("error"); setLinkError(caught instanceof Error ? caught.message : "公开资料查询中断了，请重试。"); } }
    finally { researchBusyRef.current = false; }
  }, [pendingLinkPayload, apiUrl]);

  const acquireLinkVideo = useCallback(async (payload: LinkPayload) => {
    const token = crypto.randomUUID(); mediaTokenRef.current = token;
    const identityRequest = linkRequestRef.current;
    const ask = (action: string, offset?: number) => requestCompanion("shotprint:media-read", { action, offset, token, collectionId: payload.collectionId });
    setMediaStatus("fetching"); setMediaNotice("正在读取原视频…");
    try {
      let state = await ask("begin");
      const deadline = Date.now() + 120000;
      while (state.ok && state.status === "pending" && Date.now() < deadline) {
        if (mediaTokenRef.current !== token || identityRequest !== linkRequestRef.current) throw new Error("VIDEO_CANCELLED");
        setMediaNotice(`正在读取原视频 · ${(Number(state.bytes || 0) / 1024 / 1024).toFixed(1)} MB`);
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        state = await ask("status");
      }
      if (!state.ok || state.status !== "ready") throw new Error(String(state.code || "VIDEO_DOWNLOAD_TIMEOUT"));
      const size = Number(state.bytes);
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_VIDEO_BYTES) throw new Error("VIDEO_SIZE_LIMIT");
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      for (let offset = 0; offset < size; offset += 256 * 1024) {
        if (mediaTokenRef.current !== token || identityRequest !== linkRequestRef.current) throw new Error("VIDEO_CANCELLED");
        const chunk = await ask("chunk", offset);
        if (!chunk.ok || chunk.offset !== offset || typeof chunk.data !== "string" || chunk.data.length > 350000) throw new Error(String(chunk.code || "VIDEO_CHUNK_INVALID"));
        const bytes = Uint8Array.from(atob(chunk.data), (c) => c.charCodeAt(0));
        if (bytes.length !== Math.min(256 * 1024, size - offset)) throw new Error("VIDEO_CHUNK_INVALID");
        chunks.push(bytes);
      }
      const downloaded = new File(chunks, "source-video.mp4", { type: "video/mp4" });
      const tracks = mp4Tracks(await downloaded.arrayBuffer());
      if (!tracks.video || !tracks.audio) throw new Error("VIDEO_COMPLETE_AUDIO_REQUIRED");
      const metadata = await createVideoMetadata(downloaded);
      URL.revokeObjectURL(metadata.url);
      if (!metadata.width || !metadata.height || metadata.durationMs > MAX_VIDEO_DURATION_MS || Math.abs(metadata.durationMs - Number(state.durationMs)) > 1500) throw new Error("VIDEO_DURATION_MISMATCH");
      if (mediaTokenRef.current !== token || identityRequest !== linkRequestRef.current) throw new Error("VIDEO_CANCELLED");
      setFile(downloaded); setVideoUrl(URL.createObjectURL(downloaded)); setFileAcquisition("download_upload"); setFileAudioPresent(true);
      setMediaStatus("ready"); setMediaNotice("视频已取得，画面和音轨完整。");
    } catch (caught) {
      if (mediaTokenRef.current !== token || identityRequest !== linkRequestRef.current) return;
      setMediaStatus("manual");
      setMediaNotice(`${caught instanceof Error ? caught.message : "VIDEO_DOWNLOAD_FAILED"}：无法直接取得完整视频。可录制原视频标签页，或上传视频文件；已有评论会保留。`);
    } finally { await ask("release"); }
  }, [requestCompanion]);

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
      setCaptureWarning(consent ? "文件检查完成，正在开始分析。" : "文件可以使用。勾选授权后会自动开始。" );
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
    if (!pendingLinkPayload || !researchSessionId) { setLinkError("请先读完评论并查找公开资料，再录制视频标签页。"); return; }
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

  const runAnalysis = useCallback(async (targetFile = file, targetVideoUrl = videoUrl, targetAcquisition = fileAcquisition, targetAudioPresent = fileAudioPresent, targetConsent = consent) => {
    if (!targetFile || !targetVideoUrl || !targetConsent || analysisRunRef.current) return;
    const runId = crypto.randomUUID();
    analysisRunRef.current = runId;
    autoAnalyzeRef.current = false;
    const controller = new AbortController(); abortRef.current = controller;
    let activeUpload: { objectKey: string; uploadToken: string } | null = null;
    try {
      const metadata = await createVideoMetadata(targetFile);
      URL.revokeObjectURL(metadata.url);
      controller.signal.throwIfAborted();
      if (analysisReceiptRef.current.file !== targetFile) analysisReceiptRef.current = { file: targetFile, taskId: crypto.randomUUID() };
      const receipt = analysisReceiptRef.current;
      receipt.taskId ||= crypto.randomUUID();
      let response: Response;
      if (receipt.result) response = Response.json({ result: receipt.result });
      else if (receipt.jobId) response = await fetch(apiUrl(`/api/analyze/jobs/${encodeURIComponent(receipt.jobId)}`), { signal: controller.signal, cache: "no-store" });
      else {
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
      response = await fetch(apiUrl("/api/analyze"), {
        method: "POST", headers: { "content-type": "application/json", "x-shotprint-task-id": receipt.taskId }, signal: controller.signal,
        body: JSON.stringify({ objectKey: session.objectKey, uploadToken: session.uploadToken, mimeType: targetFile.type, durationMs: metadata.durationMs, localCuts }),
      });
      }
      if (response.status === 202) {
        const accepted = receipt.jobId ? { analysisJobId: receipt.jobId, pollAfterMs: 2000 } : await readSafeApiJson<{ analysisJobId?: string; pollAfterMs?: number }>(response, "分析任务没有正常开始");
        if (!accepted.analysisJobId) throw new Error("分析任务没有返回查询凭证，请重新上传。");
        receipt.jobId = accepted.analysisJobId;
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
      const payload = await readSafeApiJson<{ result?: unknown; error?: string; diagnosticCode?: string }>(response, "分析服务没有返回完整结果");
      activeUpload = null;
      if (!response.ok || !payload.result) {
        const diagnostic = payload.diagnosticCode ? `（诊断码：${payload.diagnosticCode}）` : "";
        throw new Error(`${payload.error || "模型没有返回可用结果。"}${diagnostic}`);
      }
      const parsed = analysisResultSchema.parse(payload.result);
      receipt.result = parsed;
      controller.signal.throwIfAborted();
      if (analysisRunRef.current !== runId) return;
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
      if (analysisRunRef.current !== runId) return;
      if (caught instanceof DOMException && caught.name === "AbortError") { setPhase("idle"); setProgress(0); setMediaStatus("manual"); setMediaNotice("已停止等待分析结果；后台已接收的任务仍负责结算和清理。"); return; }
      setError(caught instanceof Error ? caught.message : "分析意外中断，请重试。"); setPhase("error");
    } finally {
      if (analysisRunRef.current === runId) analysisRunRef.current = null;
    }
  }, [file, videoUrl, fileAcquisition, fileAudioPresent, consent, apiUrl, pendingLinkPayload, researchSessionId, videoPageEvidence]);

  useEffect(() => {
    if (linkPhase !== "comments-ready" || !pendingLinkPayload || !consent) return;
    const request = linkRequestRef.current || pendingLinkPayload.url;
    chainRef.current = request;
    void (async () => {
      if (pendingLinkPayload.collectionId && mediaChainRef.current !== request) {
        mediaChainRef.current = request;
        await acquireLinkVideo(pendingLinkPayload);
      }
      if (chainRef.current !== request) return;
      if (backendStatus === "checking" || backendStatus === "unavailable" || researchChainRef.current === request) return;
      researchChainRef.current = request;
      await runDeepResearch();
    })();
  }, [linkPhase, pendingLinkPayload, consent, backendStatus, acquireLinkVideo, runDeepResearch]);

  useEffect(() => {
    if (linkPhase === "awaiting-video" && mediaStatus === "ready" && file && videoUrl && consent && phase === "idle") void runAnalysis();
  }, [linkPhase, mediaStatus, file, videoUrl, consent, phase, runAnalysis]);

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
    { id: "shots", label: "镜头列表", count: analysis?.shots.length }, { id: "narrative", label: "故事节奏" },
    { id: "production", label: "拍摄参考" }, { id: "template", label: "创作清单" },
  ];

  const demoFrame = useMemo(() => {
    const palettes = displayPalette(currentShot?.palette);
    return { background: `radial-gradient(circle at ${32 + activeShot * 5}% ${28 + activeShot * 3}%, ${palettes[1]} 0, transparent 22%), linear-gradient(${110 + activeShot * 7}deg, ${palettes[0]}, #11131a 68%)` };
  }, [activeShot, currentShot]);

  return (
    <main id="main-content">
      <a className="skip-link" href="#workspace">跳到视频拆解</a>
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="镜谱首页"><span className="mark">镜</span><span>镜谱 <i>SHOTPRINT</i></span></a>
        <nav aria-label="页面导航"><a href="#how">为什么值得拆</a><a href="#link-result">完整分析</a><a href="#result">镜头拆解</a><span className="status-dot">视频不长期保存</span><a className="topbar-cta" href="#workspace">拆一条视频</a></nav>
      </header>

      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title">别抄爆款。<br /><span>拆懂它。</span></h1>
          <p className="lede">看看观众为什么愿意看下去，找出真正起作用的镜头和节奏，再把这些方法用进你的下一条视频。</p>
          <div className="evidence-reel cinematic-reel" aria-hidden="true">
            <i className="reel-playhead" />
            <span><small>00:00</small><b>开头</b></span>
            <span><small>00:03.8</small><b>转场</b></span>
            <span><small>00:11.2</small><b>转折</b></span>
            <span><small>00:20.8</small><b>结尾</b></span>
          </div>
          <div className="hero-notes"><span>观众在意什么</span><span>哪些镜头有效</span><span>换成你的题材怎么拍</span></div>
        </div>

        <div className="ingest-card" id="workspace" aria-busy={linkBusy || !["idle", "ready", "error"].includes(phase)}>
          <div className="card-head"><div><i /><span>拿一条视频来拆</span></div></div>
          <div className="ingest-mode" role="tablist" aria-label="分析输入方式"><button id="input-link-tab" data-tab="link" type="button" className={inputMode === "link" ? "active" : ""} onClick={() => setInputMode("link")} onKeyDown={(event) => moveTabFocus(event, ["link", "video"] as const, inputMode, setInputMode)} role="tab" aria-selected={inputMode === "link"} aria-controls="link-input-panel" tabIndex={inputMode === "link" ? 0 : -1}>公开视频</button><button id="input-video-tab" data-tab="video" type="button" className={inputMode === "video" ? "active" : ""} onClick={() => setInputMode("video")} onKeyDown={(event) => moveTabFocus(event, ["link", "video"] as const, inputMode, setInputMode)} role="tab" aria-selected={inputMode === "video"} aria-controls="video-input-panel" tabIndex={inputMode === "video" ? 0 : -1}>本地视频</button></div>
          <div className="sr-only"><input ref={fileInput} type="file" accept="video/mp4,video/quicktime,video/webm" aria-label="选择视频文件" onChange={handleInput} /><input ref={downloadedFileInput} type="file" accept="video/mp4,video/quicktime" aria-label="选择下载的视频文件" onChange={handleDownloadedInput} /><span>我拥有该素材的分析权利</span><span>开始逐镜拆解（选择文件后自动运行）</span><span>打开 20.8 秒合成样片</span></div>
          {inputMode === "link" ? <div className="link-ingest" id="link-input-panel" role="tabpanel" aria-labelledby="input-link-tab">
            <label htmlFor="source-link">粘贴一条你想研究的视频</label>
            {shareLinks(link).length > 1 && <div role="group" aria-label="选择视频链接">{shareLinks(link).map((candidate) => <button className="secondary" key={candidate} onClick={() => handleLinkChange(candidate)}>{candidate}</button>)}</div>}
            {backendStatus === "unavailable" && <div className="link-error" role="alert"><b>分析服务暂时无法连接</b><span>可以先读取评论和视频；恢复连接后会继续分析，已有结果会保留。</span><button onClick={() => { setBackendStatus("checking"); setBackendRetry((value) => value + 1); }}>重试连接</button></div>}
            <label className="consent"><input type="checkbox" checked={consent} disabled={linkBusy || mediaStatus === "fetching"} onChange={(event) => setConsent(event.target.checked)} /><span>我有权分析此视频，同意临时上传并按实际用量计费。</span></label>
            {mediaNotice && <div role="status" className="capture-warning">{mediaNotice}</div>}
            {mediaStatus === "fetching" && <button className="secondary" onClick={() => { mediaTokenRef.current = ""; chainRef.current = ""; setMediaStatus("manual"); setMediaNotice("已取消视频读取，评论已保留。"); }}>取消视频读取</button>}
            <div className={`link-input-shell ${link ? "has-value" : ""}`}><span aria-hidden="true">URL</span><input ref={linkInputRef} id="source-link" name="source-link" type="text" readOnly={linkBusy || mediaStatus === "fetching" || phase !== "idle"} autoComplete="off" spellCheck={false} value={link} onChange={(event) => handleLinkChange(event.target.value)} placeholder="粘贴抖音、B站或小红书原链接…" inputMode="url" />{link && <button type="button" className="input-clear" aria-label="清除原视频链接" onClick={() => { handleLinkChange(""); linkInputRef.current?.focus(); }}>清除</button>}</div>
            <div className="link-detect" role="status" aria-live="polite"><span className={`platform-mini ${linkPlatform}`}>{linkPlatform === "douyin" ? "抖音" : linkPlatform === "bilibili" ? "B站" : linkPlatform === "xiaohongshu" ? "小红书" : "未粘贴"}</span><span>{linkPhase === "collecting" ? "正在打开视频页面并读取评论…" : linkPhase === "analyzing" ? "评论已读完，正在生成结果…" : bridgeStatus === "ready" ? (linkPlatform === "unknown" ? "浏览器扩展已连接" : "链接已识别，可以开始") : bridgeStatus === "old" ? `浏览器扩展需要更新到 ${EXTENSION_VERSION}` : bridgeStatus === "checking" ? "正在检查浏览器扩展…" : "需要先安装浏览器扩展"}</span></div>
            <details className="system-check">
              <summary><span>连接状态</span><b className={bridgeStatus === "ready" && backendStatus !== "checking" ? "ready" : "waiting"}>{bridgeStatus === "ready" ? "扩展已连接" : "查看详情"}</b></summary>
              <div className="link-self-check" role="status"><span>浏览器扩展：{bridgeDiagnostics?.version || (bridgeStatus === "old" ? "需要更新" : "检查中")}</span><span>{bridgeStatus === "ready" ? "可以读取评论" : bridgeStatus === "old" ? "版本过旧" : bridgeStatus === "missing" ? "尚未连接" : "正在检查"}</span><span>{bridgeDiagnostics?.companion?.ok ? `本地辅助工具：${bridgeDiagnostics.companion.version || "已运行"}` : "本地辅助工具：未启动，不影响基本功能"}</span>{bridgeDiagnostics?.companion?.ok && <><span>{bridgeDiagnostics.companion.browserAct === "installed" ? "BrowserAct：已安装" : "BrowserAct：未安装"}</span><span>{bridgeDiagnostics.companion.chromeDirect ? "Chrome：可以直连" : "Chrome：未设置直连"}</span><span>{linkPlatform === "unknown" ? "平台登录：粘贴链接后检查" : bridgeDiagnostics.companion.platformStatus?.[linkPlatform] === "ready" ? `${linkPlatform}：页面可读` : bridgeDiagnostics.companion.platformStatus?.[linkPlatform] === "login_required" ? `${linkPlatform}：请先登录` : `${linkPlatform}：登录状态未知`}</span><span>{pairingStatus === "paired" || bridgeDiagnostics.companion.paired ? "本地辅助工具：已配对" : "本地辅助工具：未配对"}</span></>}<span>{backendStatus === "aliyun" ? "视频分析：可用" : backendStatus === "fallback" ? "视频分析：站内服务" : backendStatus === "unavailable" ? "视频分析：无法连接" : "视频分析：检查中"}</span><span>{searchStatus === "configured" ? "公开资料搜索：可用" : searchStatus === "disabled" ? "公开资料搜索：不可用" : "公开资料搜索：检查中"}</span><button className="diagnostic-copy" type="button" onClick={() => void downloadExtensionPackage()}>下载扩展 {EXTENSION_VERSION}</button><button className="diagnostic-copy" type="button" onClick={() => void copyDiagnostics()}>{diagnosticCopied ? "诊断信息已复制" : "复制诊断信息"}</button></div>
            </details>
            {bridgeDiagnostics?.companion?.ok && !(pairingStatus === "paired" || bridgeDiagnostics.companion.paired) && <div className="companion-pair"><label htmlFor="companion-code">本地伴侣配对码</label><input id="companion-code" inputMode="numeric" maxLength={6} value={pairingCode} onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6位配对码" /><button className="secondary" disabled={pairingStatus === "pairing"} onClick={() => void pairCompanion()}>{pairingStatus === "pairing" ? "配对中…" : "配对本地伴侣"}</button></div>}
            <div className="link-stages" aria-label="链接分析六阶段">{LINK_STAGES.map((stage, index) => { const status = linkStageStatus(index, linkPhase, linkStage, linkPlatform !== "unknown"); return <div className={status} key={stage}><span>0{index + 1}</span><b>{stage}</b><small>{status === "done" ? "已完成" : status === "active" ? "进行中" : "等待"}</small></div>; })}</div>
            <button className={`primary link-primary ${extensionActionNeeded ? "setup-action" : ""}`} type="button" disabled={bridgeStatus === "checking" || linkBusy || mediaStatus === "fetching" || (!extensionActionNeeded && (!link || !consent))} onClick={extensionActionNeeded ? () => void downloadExtensionPackage() : runLinkCollection}>{linkPhase === "collecting" ? "正在拆解这条视频…" : bridgeStatus === "checking" ? "正在检查浏览器扩展…" : bridgeStatus === "old" ? `更新浏览器扩展 →` : bridgeStatus === "missing" ? `安装浏览器扩展 →` : !link ? "先粘贴一条视频链接" : "拆解这条视频 →"}</button>
            {extensionActionNeeded && <div className="setup-route" role="note"><b>{bridgeStatus === "old" ? "更新后刷新本页" : "首次使用需要安装"}</b><ol><li>下载并解压</li><li>在扩展管理页加载文件夹</li><li>刷新本页</li></ol></div>}
            {pendingLinkPayload && ["comments-ready", "error"].includes(linkPhase) && <div className="collection-checkpoint" role="status">
              <b>已取得 {pendingLinkPayload.comments.length} / {pendingLinkPayload.targetCount || (pendingLinkPayload.collectionId ? 100 : pendingLinkPayload.comments.length)} 条匿名评论</b>
              <span>{pendingLinkPayload.engine === "browser-act-network" ? "BrowserAct网络响应" : pendingLinkPayload.engine === "browser-act-dom" ? "BrowserAct DOM兜底" : pendingLinkPayload.engine === "extension-api" ? "页面接口" : "扩展DOM"} · {pendingLinkPayload.pageCount || pendingLinkPayload.cursorCount || 0} 页/游标 · 滚动 {pendingLinkPayload.scrollActions || 0} 次 · {Math.round((pendingLinkPayload.durationMs || 0) / 1000)} 秒 · {pendingLinkPayload.stopReason || "手动导入"} · 当前排序 {pendingLinkPayload.sortMode || "unknown"}</span>
              {pendingLinkPayload.comments.length < 100 && <small>评论较少，结果可能受页面排序影响。</small>}
              <div><button className="secondary" disabled={!pendingLinkPayload.continuationAvailable || linkPhase === "continuing"} onClick={continueLinkCollection}>{linkPhase === "continuing" ? "继续读取中…" : "再读取一些评论"}</button><button className="primary" disabled={mediaStatus === "fetching" || !consent || backendStatus === "unavailable"} onClick={() => void runDeepResearch()}>继续查找公开资料</button></div>
            </div>}
            {["researching", "cross-checking"].includes(linkPhase) && <div className="research-live" role="status"><b>{linkPhase === "cross-checking" ? "正在核对信息" : "正在查找公开资料"}</b><span>已完成 {researchProgress.completedQueries} / {researchProgress.totalQueries} 项 · 找到 {researchProgress.sourceCount} 个来源</span><i><em style={{ width: `${Math.min(100, (researchProgress.completedQueries / Math.max(1, researchProgress.totalQueries)) * 100)}%` }} /></i></div>}
            {linkAnalysis && linkPhase === "awaiting-video" && <div className="video-evidence-gate" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const selected = event.dataTransfer.files?.[0]; if (selected) void chooseFile(selected, "download_upload"); }}>
              <b>评论和公开资料已保留，请补充完整视频</b>
              <span>选择原视频标签页并共享音频，或上传你已有的视频文件。</span>
              <label className="consent"><input type="checkbox" checked={consent} onChange={(event) => handleConsentChange(event.target.checked)} /><span>我有权使用这段视频，并同意为完成分析临时上传。视频不会长期保存。</span></label>
              <div className="video-evidence-options">
                <div><small>电脑里已有视频</small><b>直接上传</b><span>选择 MP4 或 MOV，之后会自动开始分析。</span><button className="secondary" type="button" onClick={() => fileInput.current?.click()}>选择视频</button></div>
                <div><small>无法下载</small><b>录制当前标签页</b><span>录制时请选择原视频标签页并共享音频，最长 300 秒。</span><button className="secondary" type="button" onClick={() => void startTabCapture()}>开始录制</button></div>
              </div>
              <div className="download-drop">把视频文件拖到这里</div>
              {file && <small>{file.name} · {(file.size / 1024 / 1024).toFixed(1)}MB · {phase === "idle" ? consent ? "即将自动分析" : "等待勾选授权" : PHASE_COPY[phase]}</small>}
              {captureWarning && <small>{captureWarning}</small>}
            </div>}
            {linkPhase === "recording" && <div className="recording-live" role="status"><b>● {recordingPaused ? "录制已暂停" : "正在录制标签页"}</b><span>{recordingSeconds}s / 300s · {(recordingBytes / 1024 / 1024).toFixed(1)}MB / 300MB</span>{captureWarning && <small>{captureWarning}</small>}<div><button className="secondary" onClick={toggleTabCapturePause}>{recordingPaused ? "继续录制" : "暂停"}</button><button className="secondary" onClick={stopTabCapture}>停止并使用这段录制</button></div></div>}
            {linkError && <div className="link-error"><b>采集没有继续</b><span>{linkError}</span><button onClick={() => setLinkError("")}>知道了</button></div>}
            <details className="manual-import"><summary>评论读取失败？可以手动粘贴</summary><p>每行一条评论。不要粘贴用户名、头像或用户 ID。</p><textarea value={manualComments} onChange={(event) => setManualComments(event.target.value)} placeholder="例如：第一秒就被吸引了\n这个转场很顺\n想看下一集" rows={4} /><button className="secondary" disabled={!manualComments.trim() || linkPhase === "analyzing"} onClick={runManualLinkAnalysis}>分析这些评论</button></details>
            <p className="link-risk">镜谱不会接收你的 Cookie、用户名、头像或用户 ID。遇到验证码或平台限制时会停止读取。</p>
            <button className="fixture-link" onClick={loadLinkDemo}>先看一份完整结果</button>
          </div> : <div className={`dropzone ${file ? "has-file" : ""}`} id="video-input-panel" role="tabpanel" aria-labelledby="input-video-tab" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
            <button className="drop-button" onClick={() => fileInput.current?.click()} aria-label="选择视频文件">
              <span className="film-hole">＋</span>
              {file ? <><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(1)} MB · {phase === "idle" ? consent ? "即将开始" : "请勾选使用授权" : PHASE_COPY[phase]}</small></> : <><strong>选择视频，或拖到这里</strong><small>MP4 / MOV / WebM · 最长 300 秒 · 最大 300 MB</small></>}
            </button>
            <div className="drop-rule" />
            {captureWarning && <p className="capture-warning">{captureWarning}</p>}
            <label className="consent"><input type="checkbox" checked={consent} onChange={(event) => handleConsentChange(event.target.checked)} /><span>我有权使用这段视频，并同意为完成分析临时上传。视频不会长期保存。</span></label>
            {phase === "error" && <button className="primary" disabled={!file || !consent} onClick={() => void runAnalysis()}>重新分析 →</button>}
          </div>}

          {phase !== "idle" && phase !== "ready" && <div className="progress-wrap" role="status" aria-live="polite"><div><span>{PHASE_COPY[phase]}</span><b>{progress}%</b></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div>{!["error"].includes(phase) && <button onClick={() => abortRef.current?.abort()}>取消</button>}</div>}
          {error && <div className="error-box"><b>没有继续分析</b><span>{error}</span><button onClick={reset}>重新开始</button></div>}
          <div className="demo-line"><span>还没想好拆哪条？</span><button onClick={inputMode === "link" ? loadLinkDemo : loadDemo}>先看一份完整结果</button></div>
        </div>
      </section>

      <section className="proof-strip" id="how">
        <div><b>不只说“节奏好”</b><span>具体看到每个镜头</span></div><div><b>不靠感觉猜</b><span>判断可以回看依据</span></div><div><b>不照搬原片</b><span>只带走结构和方法</span></div><div><b>不止看完就算</b><span>整理成能修改的方案</span></div>
      </section>

      {linkAnalysis && <LinkAnalysisDesk report={linkAnalysis} fixture={linkFixture} />}

      {analysis ? <section className="studio" id="result">
        <div className="studio-head">
          <div><h2>{analysis.metadata.title}</h2><p>{analysis.narrative.logline}</p></div>
          <div className="actions"><button onClick={() => setEditing((value) => !value)}>{editing ? "保存修改" : "修改创作清单"}</button><button onClick={() => exportResult("json")}>导出 JSON</button><button onClick={() => exportResult("md")}>导出文档</button><button onClick={() => exportResult("csv")}>导出表格</button></div>
        </div>

        <div className="viewer-grid">
          <div className="viewer">
            {videoUrl && !isDemo ? <video ref={videoRef} src={videoUrl} controls onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime * 1000)} /> : <button className="demo-video" style={demoFrame} onClick={() => setPlaying((value) => !value)} aria-label={playing ? "暂停演示样片" : "播放演示样片"}><span className="scene-index">SCENE {String(activeShot + 1).padStart(2, "0")}</span><span className="demo-figure" /><b>{currentShot?.transcript || currentShot?.action}</b><i>{playing ? "Ⅱ" : "▶"}</i></button>}
            <div className="timecode"><span>{formatTime(playhead)}</span><span>{formatTime(duration)}</span></div>
          </div>
          <aside className="shot-inspector"><span className="mono">当前镜头</span><b>{String(activeShot + 1).padStart(2, "0")}</b><h3>{currentShot?.narrativeFunction}</h3><p>{currentShot?.action}</p><dl><div><dt>景别</dt><dd>{currentShot?.shotSize}</dd></div><div><dt>运动</dt><dd>{currentShot?.motion}</dd></div><div><dt>把握</dt><dd>{Math.round((currentShot?.confidence || 0) * 100)}%</dd></div></dl><span className={`boundary ${currentShot?.localBoundary ? "matched" : ""}`}>{currentShot?.localBoundary ? "● 转场已确认" : "○ AI 判断，请复核"}</span></aside>
        </div>

        <div className="timeline" aria-label="镜头时间轴">{analysis.shots.map((shot, index) => <button key={shot.id} className={index === activeShot ? "active" : ""} style={{ flexGrow: shot.endMs - shot.startMs }} onClick={() => seek(index)}><span>{String(index + 1).padStart(2, "0")}</span><i style={{ background: `linear-gradient(135deg, ${displayPalette(shot.palette).join(",")})` }} /></button>)}</div>

        <div className="tabs" role="tablist" aria-label="分析结果视图">{tabs.map((item) => <button id={`result-${item.id}-tab`} data-tab={item.id} key={item.id} type="button" role="tab" aria-selected={tab === item.id} aria-controls={`result-${item.id}-panel`} tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)} onKeyDown={(event) => moveTabFocus(event, tabs.map((entry) => entry.id), tab, setTab)}>{item.label}{item.count ? <sup>{item.count}</sup> : null}</button>)}</div>

        <div className="tab-panel" id={`result-${tab}-panel`} role="tabpanel" aria-labelledby={`result-${tab}-tab`}>
          {tab === "shots" && <div className="shot-list">{analysis.shots.map((shot, index) => <button key={shot.id} onClick={() => seek(index)} className={index === activeShot ? "active" : ""}><span className="shot-no">{String(index + 1).padStart(2, "0")}</span><span className="shot-thumb" style={{ background: `linear-gradient(135deg, ${displayPalette(shot.palette).join(",")})` }} /><span className="shot-copy"><b>{shot.narrativeFunction}</b><small>{shot.action}</small></span><span className="shot-tech"><b>{formatTime(shot.startMs)} → {formatTime(shot.endMs)}</b><small>{shot.shotSize} · {shot.camera} · {shot.motion}</small></span><span className="confidence">{Math.round(shot.confidence * 100)}%</span></button>)}</div>}
          {tab === "narrative" && <NarrativePanel analysis={analysis} />}
          {tab === "production" && <ProductionPanel analysis={analysis} />}
          {tab === "template" && <TemplatePanel analysis={analysis} editing={editing} update={updateTemplate} />}
        </div>

        <div className="warning-band"><span>需要留意</span><p>{analysis.warnings.join(" · ")}</p><b>{analysis.provenance.model}</b></div>
      </section> : !linkAnalysis && <section className="empty-blueprint"><div><h2>这条视频，到底好在哪？</h2><p>哪里抓人，哪里拖沓，换成你的题材怎么拍。</p></div><ol><li>大家为什么愿意看下去</li><li>哪些镜头真正起作用</li><li>拍摄和剪辑怎么落地</li><li>怎样借方法而不照搬</li></ol></section>}

      <footer><div className="wordmark"><span className="mark">镜</span><span>镜谱 <i>SHOTPRINT</i></span></div><p>学它的方法，拍你的内容。</p><button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>拆解一条视频 ↑</button></footer>
    </main>
  );
}

function NarrativePanel({ analysis }: { analysis: AnalysisResult }) {
  const items = [["钩子", analysis.narrative.hook], ["冲突", analysis.narrative.conflict], ["升级", analysis.narrative.escalation], ["反转", analysis.narrative.reversal], ["高潮", analysis.narrative.climax], ["收束", analysis.narrative.resolution]];
  return <div className="narrative-grid"><div className="curve-card"><div className="curve-head"><span>节奏变化</span><b>平均每镜 {analysis.narrative.stats.averageShotSeconds} 秒</b></div><div className="curve" aria-label="故事节奏曲线">{analysis.narrative.pace.map((point, index) => <div key={point.label} style={{ height: `${point.intensity}%` }}><i /><span>{point.label}</span><small>{Math.round(point.timeMs / 1000)}s</small>{index < analysis.narrative.pace.length - 1 && <em />}</div>)}</div></div><div className="beat-list">{items.map(([label, value], index) => <div key={label}><span>{String(index + 1).padStart(2, "0")}</span><p><b>{label}</b>{value}</p></div>)}</div></div>;
}

function ProductionPanel({ analysis }: { analysis: AnalysisResult }) {
  return <div className="hypothesis-grid">{analysis.productionHypotheses.map((item, index) => <article key={item.category}><div><span>参考 {String(index + 1).padStart(2, "0")}</span><b>{Math.round(item.confidence * 100)}%</b></div><h3>{item.category}</h3><p>{item.estimate}</p><small><b>判断依据</b>{item.evidence}</small><i style={{ width: `${item.confidence * 100}%` }} /></article>)}</div>;
}

function TemplatePanel({ analysis, editing, update }: { analysis: AnalysisResult; editing: boolean; update: (key: keyof AnalysisResult["reusableTemplate"], value: string) => void }) {
  const sections: Array<[keyof AnalysisResult["reusableTemplate"], string, string]> = [["storyVariables", "故事元素", "替换人物、冲突和场景"], ["beatSheet", "分段脚本", "按时间安排每一段做什么"], ["globalVisualRules", "画面统一规则", "让前后镜头看起来属于同一条视频"], ["shotPrompts", "镜头提示词", "每个镜头需要生成什么"], ["negativeConstraints", "不要照搬", "避开原片人物、台词和标识"], ["editAndSound", "剪辑与声音", "什么时候切镜头、进音乐和音效"]];
  return <div className="template-grid">{sections.map(([key, title, hint], index) => <article key={key}><span className="template-index">T{String(index + 1).padStart(2, "0")}</span><div><h3>{title}</h3><small>{hint}</small></div>{editing ? <textarea aria-label={`编辑${title}`} value={analysis.reusableTemplate[key].join("\n")} onChange={(event) => update(key, event.target.value)} /> : <ul>{analysis.reusableTemplate[key].map((item) => <li key={item}>{item}</li>)}</ul>}</article>)}</div>;
}
