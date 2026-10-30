import { hostMatches, type Settings } from "../settings";
import { hasSensitiveField } from "./fields";
import { matchNeverRun, type NeverRunCategory } from "@focal-ai/core/neverRun";

export type IneligibleReason =
  | { kind: "scheme" }
  | { kind: "never-run"; category: NeverRunCategory }
  | { kind: "skipped"; site: string }
  | { kind: "site-off"; site: string }
  | { kind: "incognito" }
  | { kind: "sensitive-field" };

export type Eligibility = { eligible: true } | { eligible: false; reason: IneligibleReason };

export interface EligibilityInput {
  url: string;
  settings: Settings;
  incognito: boolean;
  focalHosts?: string[];
  /** Omit for URL-only checks (e.g. the toolbar before the page loads). */
  document?: ParentNode;
}

/**
 * Guards run before any extraction; a blocked page sends nothing anywhere.
 *
 * This answers "may focal act on this page at all", not "has the user turned
 * it on here". Ranking is opt-in per site, and that choice is checked
 * separately (`isSiteEnabled`) so the toolbar can still offer a site that
 * passes policy but has not been enabled yet.
 */
export function checkEligibility(input: EligibilityInput): Eligibility {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return { eligible: false, reason: { kind: "scheme" } };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { eligible: false, reason: { kind: "scheme" } };
  }
  const category = matchNeverRun(url, input.focalHosts);
  if (category) return { eligible: false, reason: { kind: "never-run", category } };
  const skipped = input.settings.skipSites.find((s) => hostMatches(url.hostname, s));
  if (skipped) return { eligible: false, reason: { kind: "skipped", site: skipped } };
  const off = input.settings.siteOff.find((s) => hostMatches(url.hostname, s));
  if (off) return { eligible: false, reason: { kind: "site-off", site: off } };
  if (input.incognito && !input.settings.incognito) return { eligible: false, reason: { kind: "incognito" } };
  if (input.document && hasSensitiveField(input.document)) {
    return { eligible: false, reason: { kind: "sensitive-field" } };
  }
  return { eligible: true };
}
