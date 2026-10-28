import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlaywrightTestConfig } from "@playwright/test";

export const E2E_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(E2E_DIR, "..");
export const WEB_PORT = 3000;
export const SITES_PORT = Number(process.env.SITES_PORT ?? 4567);
export const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://focal:focal@localhost:5432/focal";
export const EXT_DIR = join(REPO_ROOT, "apps/extension/dist");

/** Chrome derives an unpacked extension's id from its absolute path. */
export const EXTENSION_ID = [...createHash("sha256").update(EXT_DIR).digest("hex").slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join("");

/** Empty values switch features off even when the shell (or CI) sets them. */
const OFF = {
  QLOO_API_KEY: "",
  TYPESAFE_API_KEY: "",
  GROQ_API_KEY: "",
  CEREBRAS_API_KEY: "",
  OPENROUTER_API_KEY: "",
  WORKOS_CLIENT_ID: "",
  WORKOS_API_KEY: "",
  WORKOS_COOKIE_PASSWORD: "",
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: "",
  WORKOS_AUTHKIT_DOMAIN: "",
  FOCAL_DEV_SESSION: "",
};

/**
 * Next dev on :3000 (the origin the test build of the extension talks to) plus
 * the fixture "real sites". The dev server log is kept so tests can count the
 * requests the extension made.
 */
export function servers(name: string, env: Record<string, string>): Pick<PlaywrightTestConfig, "webServer"> {
  const log = join(E2E_DIR, ".logs", `web-${name}.log`);
  mkdirSync(dirname(log), { recursive: true });
  process.env.WEB_LOG = log;
  return {
    webServer: [
      {
        command: `node ${join(E2E_DIR, "sites/server.mjs")}`,
        port: SITES_PORT,
        reuseExistingServer: false,
      },
      {
        // A stale Turbopack dev cache can keep "restarting" the client entry, which reloads open pages mid-test.
        command: `rm -rf apps/web/.next/dev && pnpm --filter @focal-ai/web exec next dev -p ${WEB_PORT} 2>&1 | tee ${log}`,
        cwd: REPO_ROOT,
        url: `http://localhost:${WEB_PORT}/api/health`,
        timeout: 180_000,
        reuseExistingServer: false,
        env: { ...OFF, QLOO_MOCK: "1", NEXT_PUBLIC_FOCAL_EXTENSION_ID: EXTENSION_ID, ...env },
      },
    ],
  };
}
