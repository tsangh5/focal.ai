import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { checkEligibility } from "../src/guards/eligibility";
import { REASON_TEXT } from "../src/popup/reasons";
import { DEFAULT_SETTINGS, parseSettings } from "../src/settings";

describe("popup status line", () => {
  it("explains a page focal pauses on for a password or payment field", () => {
    expect(REASON_TEXT["sensitive-field"]).toBe("focal pauses on pages with a password or payment field.");
  });

  it("has a line for every reason the guards give", () => {
    const base = { settings: DEFAULT_SETTINGS, incognito: false, url: "https://www.yelp.com/search" };
    const password = new JSDOM('<body><input type="password"></body>').window.document;
    const kinds = [
      checkEligibility({ ...base, url: "chrome://extensions" }),
      checkEligibility({ ...base, url: "https://mail.google.com/" }),
      checkEligibility({ ...base, settings: parseSettings({ skipSites: ["yelp.com"] }) }),
      checkEligibility({ ...base, settings: parseSettings({ siteOff: ["yelp.com"] }) }),
      checkEligibility({ ...base, incognito: true }),
      checkEligibility({ ...base, document: password }),
    ].map((check) => (check.eligible ? "eligible" : check.reason.kind));
    expect(kinds).toEqual(["scheme", "never-run", "skipped", "site-off", "incognito", "sensitive-field"]);
    for (const kind of kinds) expect(REASON_TEXT[kind as keyof typeof REASON_TEXT], kind).toMatch(/\w/);
  });
});
