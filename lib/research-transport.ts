export type ResearchStreamProgress = Record<string, unknown>;

export type ResearchStreamTerminal =
  | { status: "complete"; progress: ResearchStreamProgress[]; [key: string]: unknown }
  | { status: "failed"; progress: ResearchStreamProgress[]; errorCode: string; userMessage: string; [key: string]: unknown };

function parseData(lines: string[]) {
  const payload = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!payload) return null;
  try {
    const value = JSON.parse(payload);
    return value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function parseResearchEventStream(text: string): ResearchStreamTerminal {
  const progress: ResearchStreamProgress[] = [];
  let terminal: ResearchStreamTerminal | null = null;
  for (const block of text.replace(/\r\n/g, "\n").split("\n\n")) {
    const lines = block.split("\n");
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = parseData(lines);
    if (!event || !data) continue;
    if (event === "progress") progress.push(data);
    if (event === "complete") terminal = { ...data, status: "complete", progress };
    if (event === "failed") terminal = {
      ...data,
      status: "failed",
      progress,
      errorCode: String(data.errorCode || "SEARCH_PROVIDER_ERROR"),
      userMessage: String(data.userMessage || "深度联网研究未完成。"),
    };
  }
  if (!terminal) throw new Error("RESEARCH_STREAM_INCOMPLETE");
  return terminal;
}

export async function bufferResearchResponse(response: Response) {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return response;
  const terminal = parseResearchEventStream(await response.text());
  return Response.json(terminal, {
    status: terminal.status === "complete" ? 200 : 502,
    headers: { "cache-control": "no-store" },
  });
}
