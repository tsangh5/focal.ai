import type { SiteMode } from "@focal-ai/db";
import { getDb } from "../db";

/**
 * Per-user site lists the extension enforces. Ranking is opt-in, so `siteOn`
 * is the allowlist that actually lets focal act; `skipSites` suppresses the
 * offer entirely and `siteOff` records a declined offer.
 */
export interface SiteLists {
  siteOn: string[];
  skipSites: string[];
  siteOff: string[];
}

export const MAX_SITES = 200;

/** Same normalization as the extension: bare lowercase hostname without www. or port. */
export function normalizeHost(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.replace(/:\d+$/, "").replace(/\.$/, "");
  return s.replace(/^www\./, "");
}

export function isHost(host: string): boolean {
  return host.length > 0 && host.length <= 253 && /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host);
}

export function cleanHosts(raw: unknown[]): string[] {
  const hosts = raw.filter((v): v is string => typeof v === "string").map(normalizeHost).filter(isHost);
  return [...new Set(hosts)].slice(0, MAX_SITES).sort();
}

const memory = ((globalThis as { __focalSites?: Map<string, SiteLists> }).__focalSites ??= new Map());

const LIST_MODE: Record<keyof SiteLists, SiteMode> = { siteOn: "on", skipSites: "skip", siteOff: "off" };

export async function loadSites(userId: string, persisted: boolean): Promise<SiteLists> {
  const db = getDb();
  if (!persisted || !db) return memory.get(userId) ?? { siteOn: [], skipSites: [], siteOff: [] };
  const rows = await db.sites.list(userId);
  return {
    siteOn: rows.filter((r) => r.mode === "on").map((r) => r.hostname),
    skipSites: rows.filter((r) => r.mode === "skip").map((r) => r.hostname),
    siteOff: rows.filter((r) => r.mode === "off").map((r) => r.hostname),
  };
}

/** Replaces the lists that are given; lists left out are kept. */
export async function saveSites(userId: string, persisted: boolean, next: Partial<SiteLists>): Promise<SiteLists> {
  const db = getDb();
  const current = await loadSites(userId, persisted);
  const merged: SiteLists = {
    siteOn: next.siteOn ? cleanHosts(next.siteOn) : current.siteOn,
    skipSites: next.skipSites ? cleanHosts(next.skipSites) : current.skipSites,
    siteOff: next.siteOff ? cleanHosts(next.siteOff) : current.siteOff,
  };
  if (!persisted || !db) {
    memory.set(userId, merged);
    return merged;
  }
  // One row per host, so the write order decides which list wins a host that
  // appears on more than one: enabled first, then declined, then skipped.
  for (const list of ["siteOn", "siteOff", "skipSites"] as const) {
    if (!next[list]) continue;
    const mode = LIST_MODE[list];
    const keep = new Set(merged[list]);
    for (const host of current[list]) if (!keep.has(host)) await db.sites.remove(userId, host);
    for (const host of merged[list]) await db.sites.set(userId, host, mode);
  }
  return loadSites(userId, persisted);
}

export function clearMemorySites(userId: string): void {
  memory.delete(userId);
}
