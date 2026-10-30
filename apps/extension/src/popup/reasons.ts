import type { IneligibleReason } from "../guards/eligibility";

/** The popup's status line for each reason focal isn't running; every reason needs one. */
export const REASON_TEXT: Record<IneligibleReason["kind"], string> = {
  scheme: "focal doesn't run on this page.",
  "never-run": "focal never runs on this kind of site.",
  skipped: "You skip this site in settings.",
  "site-off": "You declined focal here. Turn it on above.",
  incognito: "focal is off in incognito.",
  "sensitive-field": "focal pauses on pages with a password or payment field.",
};
