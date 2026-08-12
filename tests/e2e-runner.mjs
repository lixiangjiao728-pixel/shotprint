import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = 43127;
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/vinext/dist/cli.js", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: new URL("../", import.meta.url),
  env: {
    ...process.env,
    DASHSCOPE_API_KEY: "",
    OSS_ACCESS_KEY_ID: "",
    OSS_ACCESS_KEY_SECRET: "",
    OSS_BUCKET: "",
    OSS_ENDPOINT: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`production server exited early\n${serverOutput}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) { ready = true; break; }
    } catch { /* server is still starting */ }
    await delay(250);
  }
  if (!ready) throw new Error(`production server did not become ready\n${serverOutput}`);

  const tests = spawn(process.execPath, ["--test", "tests/rendered-html.test.mjs"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, SHOTPRINT_TEST_URL: baseUrl },
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve) => tests.on("exit", resolve));
  if (exitCode !== 0) process.exitCode = Number(exitCode || 1);
} finally {
  server.kill();
}
