import type { PageOutcome } from "./api";
import { DEFAULT_SETTINGS, parseSettings, type Settings } from "./settings";
import { NEVER_RUN_VERSION } from "@focal-ai/core/neverRun";

export interface Session {
  token: string;
  email?: string;
  savedAt: string;
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get("settings");
  return settings ? parseSettings(settings) : DEFAULT_SETTINGS;
}

export async function setSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings, neverRunVersion: NEVER_RUN_VERSION });
}

/**
 * Site decisions made in this browser that the account hasn't stored yet
 * (signed out, offline, or a push still in flight), by host. A settings pull
 * replays them over the account's lists so it never undoes them.
 */
export type PendingSites = Record<string, boolean>;

export async function getPendingSites(): Promise<PendingSites> {
  const { pendingSites } = await chrome.storage.local.get("pendingSites");
  return pendingSites && typeof pendingSites === "object" ? (pendingSites as PendingSites) : {};
}

export async function setPendingSites(pending: PendingSites): Promise<void> {
  if (Object.keys(pending).length > 0) await chrome.storage.local.set({ pendingSites: pending });
  else await chrome.storage.local.remove("pendingSites");
}

export async function getSession(): Promise<Session | null> {
  const { session } = await chrome.storage.local.get("session");
  return session && typeof (session as Session).token === "string" ? (session as Session) : null;
}

export async function setSession(session: Session | null): Promise<void> {
  if (session) await chrome.storage.local.set({ session });
  else await chrome.storage.local.remove("session");
}

export interface TabResult {
  pageResultId: string | null;
  lifted: number;
  /** Why the page ended up as it did; drives the popup's explanation. */
  outcome?: PageOutcome;
}

export async function getTabResult(tabId: number): Promise<TabResult | null> {
  const key = `result:${tabId}`;
  const got = await chrome.storage.session.get(key);
  return (got[key] as TabResult | undefined) ?? null;
}

/** A null id clears the tab's result, so "Why this order?" never opens an old page's ranking. */
export async function setTabResult(tabId: number, result: { pageResultId: string | null; lifted: number }): Promise<void> {
  const key = `result:${tabId}`;
  if (result.pageResultId === null) await chrome.storage.session.remove(key);
  else await chrome.storage.session.set({ [key]: result });
}

/**
 * Records why a page ended as it did, keeping any ranking already stored for
 * the tab so "Why this order?" keeps working alongside the explanation.
 */
export async function setTabOutcome(tabId: number, outcome: PageOutcome): Promise<void> {
  const key = `result:${tabId}`;
  const current = await getTabResult(tabId);
  await chrome.storage.session.set({
    [key]: { pageResultId: current?.pageResultId ?? null, lifted: current?.lifted ?? 0, outcome },
  });
}
