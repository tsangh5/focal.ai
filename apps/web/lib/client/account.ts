import type { ActivityEvent, ProfileEntry, Strength } from "@focal-ai/core";

export interface ActivityItem extends ActivityEvent {
  undoneBy: string | null;
}

export interface SiteLists {
  /** Hosts focal is enabled on. Ranking is opt-in, so this is the allowlist. */
  siteOn: string[];
  skipSites: string[];
  siteOff: string[];
}

export class AccountApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new AccountApiError(res.status, body?.error?.message ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const getProfile = () => call<{ entries: ProfileEntry[] }>("/api/profile");
export const setStrength = (id: string, strength: Strength) =>
  call(`/api/profile/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ strength }) });
export const approveRule = (id: string) =>
  call(`/api/profile/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ approve: true }) });
export const removeEntry = (id: string) => call(`/api/profile/${encodeURIComponent(id)}`, { method: "DELETE" });

export const getActivity = () => call<{ events: ActivityItem[] }>("/api/activity");
export const undoActivity = (id: string) => call(`/api/activity/${encodeURIComponent(id)}/undo`, { method: "POST" });

export const getSites = () => call<SiteLists>("/api/settings");
export const saveSites = (next: Partial<SiteLists>) => call<SiteLists>("/api/settings", { method: "PUT", body: JSON.stringify(next) });

export const deleteAccount = () => call<void>("/api/account", { method: "DELETE" });
