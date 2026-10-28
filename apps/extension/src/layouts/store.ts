import type { LearnedLayout } from "../api";

interface StoredLayout extends LearnedLayout {
  savedAt: string;
}

/** Sites get redesigned, and a stale layout would quietly misname cards. */
export const LAYOUT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_LAYOUTS = 200;

/** One layout per site, path pattern and list structure. */
export function layoutKey(host: string, pathPattern: string, signature: string): string {
  return `${host}|${pathPattern}|${signature}`;
}

function usable(layout: StoredLayout | undefined, now: number): layout is StoredLayout {
  return typeof layout?.namePosition?.snippetIndex === "number" && now - Date.parse(layout.savedAt) < LAYOUT_TTL_MS;
}

async function getAll(): Promise<Record<string, StoredLayout>> {
  const { layouts } = await chrome.storage.local.get("layouts");
  return (layouts as Record<string, StoredLayout> | undefined) ?? {};
}

export async function getLayout(key: string): Promise<LearnedLayout | null> {
  const layout = (await getAll())[key];
  return usable(layout, Date.now()) ? layout : null;
}

/** Saving also drops expired layouts and keeps at most the newest 200. */
export async function saveLayout(key: string, layout: LearnedLayout): Promise<void> {
  const now = Date.now();
  const all = { ...(await getAll()), [key]: { ...layout, savedAt: new Date(now).toISOString() } };
  const kept = Object.entries(all)
    .filter(([, l]) => usable(l, now))
    .sort(([, a], [, b]) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
    .slice(0, MAX_LAYOUTS);
  await chrome.storage.local.set({ layouts: Object.fromEntries(kept) });
}

export async function deleteLayout(key: string): Promise<void> {
  const all = await getAll();
  if (!(key in all)) return;
  delete all[key];
  await chrome.storage.local.set({ layouts: all });
}
