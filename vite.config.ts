import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";
const cloudflareDatabaseName =
  process.env.CLOUDFLARE_D1_DATABASE_NAME || "site-creator-d1";
const cloudflareDatabaseId =
  process.env.CLOUDFLARE_D1_DATABASE_ID || SITE_CREATOR_PLACEHOLDER_DATABASE_ID;
const cloudflareCustomDomain = process.env.CLOUDFLARE_CUSTOM_DOMAIN;
const shotprintApiBase = process.env.SHOTPRINT_API_BASE;
const cloudflareVars: Record<string, string> = shotprintApiBase
  ? { SHOTPRINT_API_BASE: shotprintApiBase }
  : {};

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  vars: cloudflareVars,
  routes: cloudflareCustomDomain
    ? [{ pattern: cloudflareCustomDomain, custom_domain: true }]
    : [],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: cloudflareDatabaseName,
          database_id: cloudflareDatabaseId,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
