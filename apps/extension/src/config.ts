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
