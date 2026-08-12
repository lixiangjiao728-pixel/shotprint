import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const ignored = new Set(["node_modules", ".git", "dist", ".next", ".wrangler", ".env.local"]);
const patterns = [
  /AIza[0-9A-Za-z_-]{30,}/,
  /GEMINI_API_KEY[ \t]*=[ \t]*[^\s#][^\r\n]+/,
  /DASHSCOPE_API_KEY[ \t]*=[ \t]*[^\s#][^\r\n]+/,
  /OSS_ACCESS_KEY_SECRET[ \t]*=[ \t]*[^\s#][^\r\n]+/,
];
let scanned = 0;

async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(item.name)) continue;
    const full = path.join(directory, item.name);
    if (item.isDirectory()) await walk(full);
    else if (/\.(?:ts|tsx|js|mjs|json|md|env|example)$/.test(item.name) || item.name.startsWith(".env")) {
      const content = await readFile(full, "utf8").catch(() => "");
      scanned += 1;
      for (const pattern of patterns) {
        if (pattern.test(content)) throw new Error(`potential secret in ${full}; matched content was redacted`);
      }
    }
  }
}

await walk(fileURLToPath(root));
console.log(`secret scan: ${scanned} source files checked, 0 credentials found`);
