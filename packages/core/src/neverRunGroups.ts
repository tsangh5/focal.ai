/**
 * Display rows for the settings page, derived from the same data the guard
 * uses so the list a user reads is the list that actually runs.
 *
 * Kept out of `neverRun.ts` on purpose: that module is bundled into the
 * content script, and this table's top-level construction cannot be
 * tree-shaken away.
 */
import { SITES_BY_CATEGORY, type NeverRunCategory } from "./neverRun";
/** One row per category for the settings page. Derived from the same data the
 *  guard uses, so the list a user reads is the list that actually runs. */
export interface NeverRunGroup {
  category: NeverRunCategory;
  label: string;
  description: string;
  /** Empty for the categories matched only by pattern. */
  sites: string[];
  /** True when the category also matches hosts by pattern, beyond `sites`. */
  pattern: boolean;
}

const GROUP_COPY: Record<NeverRunCategory, { label: string; description: string; pattern?: boolean }> = {
  banking: { label: "Banking and payments", description: "Banks, brokerages, wallets and checkout flows.", pattern: true },
  health: { label: "Health", description: "Patient portals, pharmacies and health records.", pattern: true },
  government: { label: "Government", description: "Any .gov, .mil or national equivalent.", pattern: true },
  email: { label: "Email", description: "Webmail of any kind." },
  messaging: { label: "Messaging", description: "Chat and conferencing apps." },
  documents: { label: "Documents and storage", description: "Docs, drives and note apps." },
  passwords: { label: "Password managers", description: "Vaults and password managers." },
  "sign-in": { label: "Sign-in and checkout", description: "Login, registration, payment and account pages.", pattern: true },
  assistant: { label: "AI assistants", description: "Chat transcripts are as private as email.", pattern: false },
  developer: { label: "Developer tools", description: "Repos, cloud consoles, dashboards, and local or LAN addresses.", pattern: true },
  "search-engine": { label: "Search engines", description: "Re-ordering their results would fight the page's purpose. Includes all Google domains.", pattern: true },
  focal: { label: "focal itself", description: "focal never ranks its own website.", pattern: true },
};

export const NEVER_RUN_GROUPS: NeverRunGroup[] = (Object.keys(GROUP_COPY) as NeverRunCategory[]).map((category) => ({
  category,
  label: GROUP_COPY[category].label,
  description: GROUP_COPY[category].description,
  sites: category === "focal" ? [] : [...(SITES_BY_CATEGORY[category as Exclude<NeverRunCategory, "focal">] ?? [])].sort(),
  pattern: GROUP_COPY[category].pattern ?? false,
}));
