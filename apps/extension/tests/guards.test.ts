import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { checkEligibility } from "../src/guards/eligibility";
import { hasSensitiveField } from "../src/guards/fields";
import { matchNeverRun } from "@focal-ai/core/neverRun";
import { isTrustedOrigin } from "../src/config";
import { DEFAULT_SETTINGS, hostMatches, normalizeHost, parseSettings, toggleSite } from "../src/settings";

const doc = (html: string) => new JSDOM(`<body>${html}</body>`).window.document;
const base = { settings: DEFAULT_SETTINGS, incognito: false };

describe("never-run list", () => {
  it.each([
    ["https://www.paypal.com/myaccount", "banking"],
    ["https://secure.chase.com/web/auth", "banking"],
    ["https://online.citizensbank.co.uk/", "banking"],
    ["https://mychart.example-health.org/", "health"],
    ["https://www.nhs.uk/conditions", "health"],
    ["https://www.usa.gov/", "government"],
    ["https://www.gov.uk/browse", "government"],
    ["https://service.gouv.fr/", "government"],
    ["https://mail.google.com/mail/u/0", "email"],
    ["https://web.whatsapp.com/", "messaging"],
    ["https://docs.google.com/document/d/x", "documents"],
    ["https://vault.bitwarden.com/", "passwords"],
    ["https://accounts.google.com/signin", "sign-in"],
    ["https://www.yelp.com/login", "sign-in"],
    ["https://shop.example.com/checkout/cart", "sign-in"],
  ])("%s → %s", (url, category) => {
    expect(matchNeverRun(new URL(url))).toBe(category);
  });

  it("blocks focal's own site", () => {
    expect(matchNeverRun(new URL("https://app.focal.ai/profile"), ["focal.ai"])).toBe("focal");
  });

  // A local build bakes in localhost, so the deployed site has to match on its
  // own, without being passed in as a focalHost.
  it.each([
    "https://focal-ai.vercel.app/profile",
    "https://focal-ai-git-main-bens-projects.vercel.app/chat",
    "https://focal-ai-abc123.vercel.app/",
  ])("blocks focal's deployment %s with no focalHosts", (url) => {
    expect(matchNeverRun(new URL(url))).toBe("focal");
  });

  it("leaves other vercel.app sites rankable", () => {
    expect(matchNeverRun(new URL("https://someone-else.vercel.app/list"))).toBeNull();
  });

  // A chat transcript is as sensitive as email, and its turns look like a card list.
  it.each([
    ["https://claude.ai/chat/abc", "assistant"],
    ["https://console.anthropic.com/dashboard", "assistant"],
    ["https://chatgpt.com/c/abc", "assistant"],
    ["https://chat.openai.com/c/abc", "assistant"],
    ["https://gemini.google.com/app", "assistant"],
    ["https://www.perplexity.ai/search", "assistant"],
    ["https://github.com/tsangh5/focal.ai", "developer"],
    ["https://console.cloud.google.com/home", "developer"],
    ["https://linear.app/team/issues", "developer"],
    ["https://console.neon.tech/app/projects", "developer"],
  ])("%s → %s", (url, category) => {
    expect(matchNeverRun(new URL(url))).toBe(category);
  });

  // Re-ordering a search engine's own results fights the page's purpose.
  it.each([
    ["https://www.google.com/search?q=ramen", "search-engine"],
    ["https://google.co.uk/search?q=ramen", "search-engine"],
    ["https://google.de/", "search-engine"],
    ["https://maps.google.com/maps", "search-engine"],
    ["https://www.bing.com/search?q=ramen", "search-engine"],
    ["https://duckduckgo.com/?q=ramen", "search-engine"],
    ["https://search.brave.com/search?q=ramen", "search-engine"],
  ])("%s → %s", (url, category) => {
    expect(matchNeverRun(new URL(url))).toBe(category);
  });

  // More specific Google hosts keep their own, more accurate reason.
  it.each([
    ["https://mail.google.com/mail/u/0", "email"],
    ["https://docs.google.com/document/d/x", "documents"],
    ["https://gemini.google.com/app", "assistant"],
    ["https://accounts.google.com/signin", "sign-in"],
  ])("%s keeps its specific category (%s)", (url, category) => {
    expect(matchNeverRun(new URL(url))).toBe(category);
  });

  it.each([
    "http://localhost:3000/chat",
    "http://127.0.0.1:8080/",
    "http://192.168.1.10/admin",
    "http://10.0.0.5:3000/",
    "http://dev.local/list",
    "http://box.internal/items",
  ])("blocks local host %s", (url) => {
    expect(matchNeverRun(new URL(url))).toBe("developer");
  });

  it.each([
    "https://www.yelp.com/search?find_desc=ramen",
    "https://www.goodreads.com/list/show/1",
    "https://www.imdb.com/chart/top",
    "https://open.spotify.com/playlist/abc",
    "https://www.tripadvisor.com/Restaurants-g60763",
  ])("allows %s", (url) => {
    expect(matchNeverRun(new URL(url))).toBeNull();
  });
});

describe("sensitive fields", () => {
  it("detects password inputs", () => {
    expect(hasSensitiveField(doc('<input type="password">'))).toBe(true);
  });
  it("ignores password inputs the user can't see", () => {
    expect(hasSensitiveField(doc('<div hidden><input type="password"></div>'))).toBe(false);
    expect(hasSensitiveField(doc('<form style="display:none"><input type="password"></form>'))).toBe(false);
    expect(hasSensitiveField(doc('<div hidden><input autocomplete="current-password"></div>'))).toBe(false);
    expect(hasSensitiveField(doc('<input autocomplete="current-password">'))).toBe(true);
  });
  it("detects payment autocomplete, names and frames", () => {
    expect(hasSensitiveField(doc('<input autocomplete="cc-number">'))).toBe(true);
    expect(hasSensitiveField(doc('<input name="cvc">'))).toBe(true);
    expect(hasSensitiveField(framed('<iframe src="https://js.stripe.com/v3/elements"></iframe>'))).toBe(true);
  });
  it("ignores search boxes", () => {
    expect(hasSensitiveField(doc('<input type="search" name="q"><input name="find_loc">'))).toBe(false);
  });
});

/** jsdom lays nothing out, so give the page's iframes a box (0×0 is how a hidden frame measures). */
function framed(html: string, width = 300, height = 60): Document {
  const d = doc(html);
  for (const frame of d.querySelectorAll("iframe")) {
    frame.getBoundingClientRect = () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  }
  return d;
}

describe("payment iframes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("block only when the frame has a visible box", () => {
    const frame = '<iframe src="https://js.stripe.com/v3/elements"></iframe>';
    expect(hasSensitiveField(framed(frame))).toBe(true);
    expect(hasSensitiveField(framed(frame, 0, 0))).toBe(false);
    expect(hasSensitiveField(framed(frame, 300, 0))).toBe(false);
    expect(hasSensitiveField(framed(frame, 0, 60))).toBe(false);
    expect(hasSensitiveField(doc(frame))).toBe(false); // unstubbed jsdom frames measure 0×0
  });

  it("ignore a payment frame that has a box but is hidden", () => {
    expect(hasSensitiveField(framed('<iframe style="visibility:hidden" src="https://js.stripe.com/v3/elements"></iframe>'))).toBe(false);
    expect(hasSensitiveField(framed('<div hidden><iframe src="https://js.stripe.com/v3/elements"></iframe></div>'))).toBe(false);
  });

  it("resolve relative and protocol-relative srcs against the page", () => {
    vi.stubGlobal("location", new URL("https://checkout.stripe.com/c/pay/cs_test_1"));
    expect(hasSensitiveField(framed('<iframe src="/elements-inner-card"></iframe>'))).toBe(true);
    expect(hasSensitiveField(framed('<iframe src="elements-inner-card?x=1"></iframe>'))).toBe(true);

    vi.stubGlobal("location", new URL("https://shop.example.com/cart"));
    expect(hasSensitiveField(framed('<iframe src="//js.stripe.com/v3/elements"></iframe>'))).toBe(true);
    // A relative src stays on the page's own host, whatever its path says.
    expect(hasSensitiveField(framed('<iframe src="/embed/js.stripe.com/v3"></iframe>'))).toBe(false);
    expect(hasSensitiveField(framed('<iframe src="https://ads.example.net/frame?ref=paypal.com"></iframe>'))).toBe(false);
  });

  it("ignore srcs that don't parse", () => {
    vi.stubGlobal("location", new URL("https://shop.example.com/cart"));
    expect(hasSensitiveField(framed('<iframe src="https://[js.stripe.com/v3"></iframe>'))).toBe(false);
  });
});

describe("checkEligibility", () => {
  it("allows a normal page", () => {
    expect(checkEligibility({ ...base, url: "https://www.yelp.com/search", document: doc("<p>hi</p>") })).toEqual({ eligible: true });
  });
  it("rejects non-http schemes and bad urls", () => {
    expect(checkEligibility({ ...base, url: "chrome://extensions" })).toMatchObject({ eligible: false, reason: { kind: "scheme" } });
    expect(checkEligibility({ ...base, url: "not a url" })).toMatchObject({ eligible: false, reason: { kind: "scheme" } });
  });
  it("respects the skip list including subdomains", () => {
    const settings = parseSettings({ skipSites: ["https://www.Reddit.com/"] });
    expect(checkEligibility({ ...base, settings, url: "https://old.reddit.com/r/books" })).toMatchObject({
      eligible: false,
      reason: { kind: "skipped", site: "reddit.com" },
    });
  });
  it("respects per-site off from the toolbar", () => {
    const settings = toggleSite(DEFAULT_SETTINGS, "www.yelp.com", false);
    expect(checkEligibility({ ...base, settings, url: "https://www.yelp.com/search" })).toMatchObject({
      eligible: false,
      reason: { kind: "site-off" },
    });
    const back = toggleSite(settings, "yelp.com", true);
    expect(checkEligibility({ ...base, settings: back, url: "https://www.yelp.com/search" }).eligible).toBe(true);
  });
  it("is off in incognito unless enabled", () => {
    expect(checkEligibility({ ...base, incognito: true, url: "https://www.yelp.com/" })).toMatchObject({ reason: { kind: "incognito" } });
    const settings = { ...DEFAULT_SETTINGS, incognito: true };
    expect(checkEligibility({ ...base, settings, incognito: true, url: "https://www.yelp.com/" }).eligible).toBe(true);
  });
  it("rejects pages with sensitive fields", () => {
    expect(checkEligibility({ ...base, url: "https://www.yelp.com/", document: doc('<input type="password">') })).toMatchObject({
      reason: { kind: "sensitive-field" },
    });
  });
  it("never-run beats everything", () => {
    expect(checkEligibility({ ...base, url: "https://mail.google.com/" })).toMatchObject({ reason: { kind: "never-run", category: "email" } });
  });
});

describe("settings helpers", () => {
  it("normalizes hosts", () => {
    expect(normalizeHost("HTTPS://WWW.Yelp.com:443/search?q=1")).toBe("yelp.com");
    expect(hostMatches("m.yelp.com", "yelp.com")).toBe(true);
    expect(hostMatches("notyelp.com", "yelp.com")).toBe(false);
  });
  it("parses junk safely", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ skipSites: ["a.com", 3, "A.com"], incognito: "yes" })).toEqual({ skipSites: ["a.com"], siteOff: [], incognito: false });
  });
});

describe("trusted origins for the /connect handoff", () => {
  it("accepts the build origin and the deployed sites", () => {
    for (const o of ["http://localhost:3000", "https://focal-ai.vercel.app", "https://focal.ai"]) {
      expect(isTrustedOrigin(o), o).toBe(true);
    }
  });

  it("rejects look-alikes, subdomains and missing origins", () => {
    for (const o of [
      "https://focal.ai.evil.com",
      "https://evil.focal.ai",
      "http://focal-ai.vercel.app",
      "https://focal-ai.vercel.app.evil.com",
      undefined,
    ]) {
      expect(isTrustedOrigin(o), String(o)).toBe(false);
    }
  });
});
