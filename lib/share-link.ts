export type VideoPlatform = "douyin" | "bilibili" | "xiaohongshu" | "unknown";

export function platformForUrl(value: string): VideoPlatform {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "unknown";
    const host = url.hostname.toLowerCase();
    const inDomain = (domain: string) => host === domain || host.endsWith(`.${domain}`);
    if (inDomain("douyin.com") || inDomain("iesdouyin.com")) return "douyin";
    if (inDomain("bilibili.com") || host === "b23.tv") return "bilibili";
    if (inDomain("xiaohongshu.com") || host === "xhslink.com" || host === "www.xhslink.com") return "xiaohongshu";
  } catch { /* Invalid or pasted prose. */ }
  return "unknown";
}

export function shareLinks(text: string): string[] {
  const candidates = text.match(/https:\/\/[^\s<>"“”‘’]+/gi) || [];
  return [...new Set(candidates.map((candidate) => candidate.replace(/[，。；！、）)\]】》！!?,;]+$/u, ""))
    .filter((candidate) => platformForUrl(candidate) !== "unknown")
    .map((candidate) => new URL(candidate).toString()))];
}
