/** Settings cached in chrome.storage so eligibility never needs the network. */
export interface Settings {
  /**
   * Hosts focal is enabled on. Ranking is opt-in per site: nothing is read or
   * sent on a host that is not in here, so an empty list means focal is
   * inert everywhere until the user says otherwise.
   */
  siteOn: string[];
  /** Hosts the user skips (onboarding / settings page). */
  skipSites: string[];
  /** Hosts where the offer was declined, so it is not shown again. */
  siteOff: string[];
  /** Run in incognito windows. Off by default (§5.1). */
  incognito: boolean;
}

export const DEFAULT_SETTINGS: Settings = { siteOn: [], skipSites: [], siteOff: [], incognito: false };

/** True when the user has turned focal on for this host (or a parent of it). */
export function isSiteEnabled(settings: Settings, host: string): boolean {
  return settings.siteOn.some((s) => hostMatches(host, s));
}

/** Enabling clears a previous decline; declining clears a previous enable. */
export function enableSite(settings: Settings, host: string, on: boolean): Settings {
  const h = normalizeHost(host);
  const siteOn = settings.siteOn.filter((s) => s !== h);
  const siteOff = settings.siteOff.filter((s) => s !== h);
  return on ? { ...settings, siteOn: [...siteOn, h], siteOff } : { ...settings, siteOn, siteOff: [...siteOff, h] };
}

/** Lower-cases a host or URL-ish string and drops `www.`, port and path. */
export function normalizeHost(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.replace(/:\d+$/, "").replace(/\.$/, "");
  return s.replace(/^www\./, "");
}

/** True when `host` equals `site` or is a subdomain of it. */
export function hostMatches(host: string, site: string): boolean {
  const h = normalizeHost(host);
  const s = normalizeHost(site);
  if (!s) return false;
  return h === s || h.endsWith(`.${s}`);
}

export function parseSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const hosts = (v: unknown) =>
    Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === "string").map(normalizeHost).filter(Boolean))]
      : [];
  return {
    siteOn: hosts(r.siteOn),
    skipSites: hosts(r.skipSites),
    siteOff: hosts(r.siteOff),
    incognito: r.incognito === true,
  };
}

/** Toolbar toggle. Under opt-in this is the same decision as the on-page offer. */
export function toggleSite(settings: Settings, host: string, on: boolean): Settings {
  return enableSite(settings, host, on);
}
