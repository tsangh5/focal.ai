import type { PageOutcome } from "../api";
import type { IneligibleReason } from "../guards/eligibility";

/**
 * What the popup says when focal was allowed to run and still changed
 * nothing. Without these the popup is silent on an enabled site, which reads
 * as a broken extension rather than a considered decision.
 */
export const OUTCOME_TEXT: Record<PageOutcome, string> = {
  lifted: "",
  "nothing-to-lift": "Nothing here stood out enough to move, so the page is as the site ordered it.",
  "no-list": "No list of things found on this page.",
  "not-a-list": "This list isn't things focal can rank — it looks like text, results or interface.",
  "no-signals": "Your taste has nothing that applies to this kind of thing yet. Add a few in the chat.",
  error: "focal couldn't reach the server for this page. It will try again.",
  "signed-out": "Sign in to focal so it has a taste profile to rank with.",
};

/** The popup's status line for each reason focal isn't running; every reason needs one. */
export const REASON_TEXT: Record<IneligibleReason["kind"], string> = {
  scheme: "focal doesn't run on this page.",
  "never-run": "focal never runs on this kind of site.",
  skipped: "You skip this site in settings.",
  "site-off": "You declined focal here. Turn it on above.",
  incognito: "focal is off in incognito.",
  "sensitive-field": "focal pauses on pages with a password or payment field.",
};
