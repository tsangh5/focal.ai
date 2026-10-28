declare const __FOCAL_ORIGIN__: string | undefined;

/** focal website / API origin, injected at build time (FOCAL_ORIGIN). */
export const FOCAL_ORIGIN: string =
  typeof __FOCAL_ORIGIN__ === "string" && __FOCAL_ORIGIN__ ? __FOCAL_ORIGIN__ : "http://localhost:3000";

/**
 * Hosts focal must never rank: its own website.
 *
 * The build-time origin alone is not enough — a local build bakes in
 * `localhost`, so the deployed site would be ranked like any other page.
 * The known production hosts are listed explicitly; `neverRun` additionally
 * matches this project's Vercel preview URLs by pattern.
 */
export const FOCAL_HOSTS: string[] = [
  new URL(FOCAL_ORIGIN).hostname,
  "focal.ai",
  "focal-ai.vercel.app",
];

/**
 * Origins allowed to hand the extension a session on /connect. Must stay in
 * step with `externally_connectable` in build.mjs — the manifest decides which
 * pages may send at all, and this is the per-message check behind it.
 *
 * The build origin alone is not enough: a local build trusts only localhost,
 * so the deployed site could never connect.
 */
export const TRUSTED_ORIGINS: string[] = [
  FOCAL_ORIGIN,
  "https://focal-ai.vercel.app",
  "https://focal.ai",
];

export function isTrustedOrigin(origin: string | undefined): boolean {
  return origin !== undefined && TRUSTED_ORIGINS.includes(origin);
}
