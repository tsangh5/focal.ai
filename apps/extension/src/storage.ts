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

export async function getSession(): Promise<Session | null> {
  const { session } = await chrome.storage.local.get("session");
  return session && typeof (session as Session).token === "string" ? (session as Session) : null;
}

export async function setSession(session: Session | null): Promise<void> {
  if (session) await chrome.storage.local.set({ session });
  else await chrome.storage.local.remove("session");
}

export interface TabResult {
  pageResultId: string;
  lifted: number;
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
