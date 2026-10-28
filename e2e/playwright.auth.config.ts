import { defineConfig } from "@playwright/test";
import { DATABASE_URL, servers, WEB_PORT } from "./servers";

/**
 * Sign-in configured with placeholder WorkOS credentials: checks redirects and
 * signed-out refusals without reaching WorkOS.
 */
export default defineConfig({
  testDir: "./tests/auth",
  globalSetup: "./global-setup.ts",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: "chromium",
    launchOptions: { args: ["--no-proxy-server"] },
  },
  ...servers("auth", {
    DATABASE_URL,
    WORKOS_CLIENT_ID: "client_e2e_test",
    WORKOS_API_KEY: "sk_test_e2e_placeholder",
    WORKOS_COOKIE_PASSWORD: "e2e-cookie-password-at-least-32-characters-long",
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: `http://localhost:${WEB_PORT}/auth/callback`,
    WORKOS_AUTHKIT_DOMAIN: "example-e2e.authkit.app",
  }),
});
