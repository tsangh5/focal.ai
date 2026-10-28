import { defineConfig } from "@playwright/test";
import { DATABASE_URL, servers, WEB_PORT } from "./servers";

/**
 * Local-dev mode with a database: mock Qloo and Jev, dev sessions (any
 * non-fx token is the dev@localhost account), sign-in not configured.
 */
export default defineConfig({
  testDir: "./tests/dev",
  globalSetup: "./global-setup.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: "chromium",
    launchOptions: { args: ["--no-proxy-server"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  ...servers("dev", { DATABASE_URL, FOCAL_DEV_SESSION: "1" }),
});
