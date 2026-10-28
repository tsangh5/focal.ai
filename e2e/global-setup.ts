import { execFileSync } from "node:child_process";
import { DATABASE_URL, REPO_ROOT, WEB_PORT } from "./servers";

/** Builds the extension against the test server and brings the database schema up to date. */
export default function globalSetup(): void {
  const run = (args: string[], env: Record<string, string> = {}) =>
    execFileSync("pnpm", args, { cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env, ...env } });
  run(["--filter", "@focal-ai/extension", "build"], { FOCAL_ORIGIN: `http://localhost:${WEB_PORT}` });
  run(["--filter", "@focal-ai/db", "migrate"], { DATABASE_URL, DATABASE_URL_UNPOOLED: DATABASE_URL });
}
