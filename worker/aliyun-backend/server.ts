import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ShotprintEnv } from "../../lib/server";
import { OssStateStore } from "./oss-state";
import { GET as linkStatus, POST as linkAnalyze } from "../../app/api/link-analyze/route";
import { POST as linkResearch } from "../../app/api/link-research/route";
import { POST as analyze } from "../../app/api/analyze/route";
import { POST as createUploadSession, DELETE as deleteUploadSession } from "../../app/api/upload-session/route";
import { bufferResearchResponse } from "../../lib/research-transport";

const runtime = { ...process.env } as unknown as ShotprintEnv;
runtime.STATE_STORE = new OssStateStore(runtime);
(globalThis as typeof globalThis & { __SHOTPRINT_RUNTIME_ENV__?: ShotprintEnv }).__SHOTPRINT_RUNTIME_ENV__ = runtime;

const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || "https://shotprint.xyz,http://localhost:3000,http://127.0.0.1:3000").split(",").map((value) => value.trim()).filter(Boolean));
const maxBodyBytes = 32 * 1024 * 1024;
const researchJobTtlMs = 10 * 60 * 1000;
const analysisJobTtlMs = 30 * 60 * 1000;

type ResearchJob = {
  status: "pending" | "complete" | "failed";
  createdAt: string;
  expiresAt: string;
  result?: unknown;
  errorCode?: string;
  userMessage?: string;
};
type AnalysisJob = {
  status: "pending" | "complete" | "failed";
  createdAt: string;
  expiresAt: string;
  result?: unknown;
  diagnosticCode?: string;
  userMessage?: string;
};

function researchJobKey(id: string) { return `research-jobs/${id}.json`; }
function analysisJobKey(id: string) { return `analysis-jobs/${id}.json`; }
function requestedTaskId(request: Request) {
  const value = request.headers.get("x-shotprint-task-id") || "";
  return /^[0-9a-f-]{36}$/i.test(value) ? value.toLowerCase() : "";
}

async function startAnalysisJob(request: Request) {
  if (!runtime.STATE_STORE) return Response.json({ error: "ANALYSIS_JOB_STORE_UNAVAILABLE" }, { status: 503 });
  const id = requestedTaskId(request) || crypto.randomUUID();
  const existing = await runtime.STATE_STORE.getJson<AnalysisJob>(analysisJobKey(id));
  if (existing && Date.parse(existing.expiresAt) > Date.now()) {
    return Response.json({ status: "accepted", analysisJobId: id, pollAfterMs: 1000 }, { status: 202, headers: { "cache-control": "no-store" } });
  }
  const now = Date.now();
  const base: AnalysisJob = { status: "pending", createdAt: new Date(now).toISOString(), expiresAt: new Date(now + analysisJobTtlMs).toISOString() };
  await runtime.STATE_STORE.putJson(analysisJobKey(id), base);
  void (async () => {
    try {
      const response = await analyze(request);
      const payload = await response.json().catch(() => ({ error: "分析服务返回了无效结果。" }));
      const status = response.ok && payload && typeof payload === "object" && "result" in payload ? "complete" : "failed";
      const userMessage = status === "failed" && payload && typeof payload === "object" ? String((payload as { error?: string }).error || "视频分析未完成，请重新上传后重试。") : undefined;
      const diagnosticCode = status === "failed" && payload && typeof payload === "object"
        ? String((payload as { diagnosticCode?: string }).diagnosticCode || "analysis_failed").replace(/[^a-z0-9_.:,\-+]/gi, "_").slice(0, 240)
        : undefined;
      await runtime.STATE_STORE!.putJson(analysisJobKey(id), { ...base, status, ...(status === "complete" ? { result: payload } : {}), ...(userMessage ? { userMessage } : {}), ...(diagnosticCode ? { diagnosticCode } : {}) } satisfies AnalysisJob);
    } catch {
      await runtime.STATE_STORE!.putJson(analysisJobKey(id), { ...base, status: "failed", userMessage: "视频分析意外中断，请重新上传后重试。" } satisfies AnalysisJob).catch(() => undefined);
    }
  })();
  return Response.json({ status: "accepted", analysisJobId: id, pollAfterMs: 2000 }, { status: 202, headers: { "cache-control": "no-store" } });
}

async function readAnalysisJob(id: string) {
  if (!runtime.STATE_STORE || !/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "ANALYSIS_JOB_NOT_FOUND" }, { status: 404 });
  const job = await runtime.STATE_STORE.getJson<AnalysisJob>(analysisJobKey(id));
  if (!job || Date.parse(job.expiresAt) <= Date.now()) {
    if (job) await runtime.STATE_STORE.delete(analysisJobKey(id)).catch(() => undefined);
    return Response.json({ error: "ANALYSIS_JOB_EXPIRED" }, { status: 404 });
  }
  if (job.status === "complete") return Response.json(job.result, { headers: { "cache-control": "no-store" } });
  if (job.status === "failed") return Response.json({ error: job.userMessage || "视频分析未完成，请重新上传后重试。", diagnosticCode: job.diagnosticCode || "analysis_failed" }, { status: 502, headers: { "cache-control": "no-store" } });
  return Response.json({ status: "pending" }, { status: 202, headers: { "cache-control": "no-store" } });
}

async function startResearchJob(request: Request) {
  if (!runtime.STATE_STORE) return Response.json({ error: "RESEARCH_JOB_STORE_UNAVAILABLE" }, { status: 503 });
  const id = requestedTaskId(request) || crypto.randomUUID();
  const existing = await runtime.STATE_STORE.getJson<ResearchJob>(researchJobKey(id));
  if (existing && Date.parse(existing.expiresAt) > Date.now()) {
    return Response.json({ status: "accepted", researchJobId: id, pollAfterMs: 1000 }, { status: 202, headers: { "cache-control": "no-store" } });
  }
  const now = Date.now();
  const base: ResearchJob = { status: "pending", createdAt: new Date(now).toISOString(), expiresAt: new Date(now + researchJobTtlMs).toISOString() };
  await runtime.STATE_STORE.putJson(researchJobKey(id), base);
  void (async () => {
    try {
      const response = await bufferResearchResponse(await linkResearch(request));
      const result = await response.json().catch(() => ({ status: "failed", errorCode: "RESEARCH_RESPONSE_INVALID" }));
      const status = response.ok && result && typeof result === "object" && (result as { status?: string }).status === "complete" ? "complete" : "failed";
      const errorCode = status === "failed" && result && typeof result === "object" ? String((result as { errorCode?: string; error?: string }).errorCode || (result as { error?: string }).error || "RESEARCH_FAILED") : undefined;
      const userMessage = status === "failed" && result && typeof result === "object" ? String((result as { userMessage?: string }).userMessage || "深度研究未完成，请稍后直接重试。") : undefined;
      await runtime.STATE_STORE!.putJson(researchJobKey(id), { ...base, status, result, ...(errorCode ? { errorCode } : {}), ...(userMessage ? { userMessage } : {}) } satisfies ResearchJob);
    } catch (error) {
      const errorCode = error instanceof Error ? error.message.replace(/[^A-Z0-9_]/g, "_").slice(0, 80) : "RESEARCH_JOB_FAILED";
      await runtime.STATE_STORE!.putJson(researchJobKey(id), { ...base, status: "failed", errorCode } satisfies ResearchJob).catch(() => undefined);
    }
  })();
  return Response.json({ status: "accepted", researchJobId: id, pollAfterMs: 2000 }, { status: 202, headers: { "cache-control": "no-store" } });
}

async function readResearchJob(id: string) {
  if (!runtime.STATE_STORE || !/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "RESEARCH_JOB_NOT_FOUND" }, { status: 404 });
  const job = await runtime.STATE_STORE.getJson<ResearchJob>(researchJobKey(id));
  if (!job || Date.parse(job.expiresAt) <= Date.now()) {
    if (job) await runtime.STATE_STORE.delete(researchJobKey(id)).catch(() => undefined);
    return Response.json({ error: "RESEARCH_JOB_EXPIRED" }, { status: 404 });
  }
  if (job.status === "complete") return Response.json(job.result, { headers: { "cache-control": "no-store" } });
  if (job.status === "failed") return Response.json({ status: "failed", errorCode: job.errorCode || "RESEARCH_FAILED", userMessage: job.userMessage || "深度研究未完成，请稍后直接重试。" }, { status: 502, headers: { "cache-control": "no-store" } });
  return Response.json({ status: "pending" }, { status: 202, headers: { "cache-control": "no-store" } });
}

function cors(origin: string | undefined) {
  return origin && allowedOrigins.has(origin) ? {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-shotprint-contract,x-shotprint-task-id",
    "access-control-max-age": "600",
    vary: "Origin",
  } : {};
}

async function bodyBuffer(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBodyBytes) throw new Error("BODY_TOO_LARGE");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function toWebRequest(request: IncomingMessage) {
  const protocol = request.headers["x-forwarded-proto"] === "http" ? "http" : "https";
  const host = request.headers.host || "shotprint-backend.local";
  const method = request.method || "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await bodyBuffer(request);
  return new Request(`${protocol}://${host}${request.url || "/"}`, { method, headers: request.headers as HeadersInit, ...(body ? { body } : {}) });
}

async function route(request: Request) {
  const path = new URL(request.url).pathname;
  if (path === "/health" && request.method === "GET") return Response.json({ status: "ok", service: "shotprint-backend", region: "cn-beijing", state: "oss" }, { headers: { "cache-control": "no-store" } });
  if (path === "/api/link-analyze" && request.method === "GET") return linkStatus();
  if (path === "/api/link-analyze" && request.method === "POST") return linkAnalyze(request);
  if (path === "/api/link-research" && request.method === "POST") return startResearchJob(request);
  const researchJobMatch = path.match(/^\/api\/link-research\/jobs\/([0-9a-f-]{36})$/i);
  if (researchJobMatch && request.method === "GET") return readResearchJob(researchJobMatch[1]);
  if (path === "/api/upload-session" && request.method === "POST") return createUploadSession(request);
  if (path === "/api/upload-session" && request.method === "DELETE") return deleteUploadSession(request);
  if (path === "/api/analyze" && request.method === "POST") return startAnalysisJob(request);
  const analysisJobMatch = path.match(/^\/api\/analyze\/jobs\/([0-9a-f-]{36})$/i);
  if (analysisJobMatch && request.method === "GET") return readAnalysisJob(analysisJobMatch[1]);
  return Response.json({ error: "NOT_FOUND" }, { status: 404 });
}

async function send(response: ServerResponse, webResponse: Response, origin?: string) {
  response.statusCode = webResponse.status;
  for (const [name, value] of webResponse.headers) if (!name.toLowerCase().startsWith("access-control-")) response.setHeader(name, value);
  for (const [name, value] of Object.entries(cors(origin))) response.setHeader(name, value);
  if (!webResponse.body) return response.end();
  Readable.fromWeb(webResponse.body as import("node:stream/web").ReadableStream).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
  if (request.method === "OPTIONS") {
    if (!origin || !allowedOrigins.has(origin)) return send(response, Response.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403 }), origin);
    response.writeHead(204, cors(origin)); return response.end();
  }
  if (origin && !allowedOrigins.has(origin)) return send(response, Response.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403 }), origin);
  try { await send(response, await route(await toWebRequest(request)), origin); }
  catch (error) {
    const code = error instanceof Error ? error.message : "BACKEND_ERROR";
    const status = code === "BODY_TOO_LARGE" ? 413 : 500;
    await send(response, Response.json({ error: code.replace(/[^A-Z0-9_]/g, "_").slice(0, 80) || "BACKEND_ERROR" }, { status }), origin);
  }
});

server.listen(Number(process.env.PORT || 9000), "0.0.0.0");
