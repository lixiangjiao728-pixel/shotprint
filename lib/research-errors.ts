const TIMEOUT_NAMES = new Set(["AbortError", "TimeoutError"]);

export function researchErrorCode(error: unknown, fallback = "SEARCH_PROVIDER_ERROR") {
  if (!(error instanceof Error)) return fallback;
  if (TIMEOUT_NAMES.has(error.name) || /aborted due to timeout|timed?\s*out/i.test(error.message)) return "RESEARCH_TIMEOUT";
  return error.message || fallback;
}

export function researchFailureMessage(errorCode: string) {
  if (errorCode === "RESEARCH_TIMEOUT" || errorCode === "RESEARCH_SYNTHESIS_TIMEOUT") {
    return "深度研究等待模型返回超时，本次未生成不完整结论。请直接重试深度研究，无需重新采集评论。";
  }
  if (errorCode === "SEARCH_SOURCE_INSUFFICIENT") return "公开网页证据不足，暂时无法生成可靠的深度研究结论。";
  if (errorCode === "SEARCH_RATE_LIMITED") return "研究服务当前请求较多，请稍后直接重试深度研究。";
  return "深度联网研究未完成；不会使用固定模板冒充联网结论。";
}
