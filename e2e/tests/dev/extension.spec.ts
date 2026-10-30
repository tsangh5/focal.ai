import type { BrowserContext, Page } from "@playwright/test";
import type { Db } from "@focal-ai/db";
import {
  database,
  DEV_TOKEN,
  domOrder,
  expect,
  labels,
  logCount,
  resetDevAccount,
  SEARCH,
  setSettings,
  signIn,
  SITES,
  storage,
  test,
  visualOrder,
  WEB,
} from "../support";

const ORIGINAL = ["Olive Garden", "Chili's", "Zuni Café", "House of Prime Rib", "Rintaro", "State Bird Provisions", "Che Fico", "Kin Khao"];
const QUIET_MS = 6000;

let db: Db;
let devId = "";
test.beforeAll(() => {
  db = database();
});
test.afterAll(async () => db.close());
test.beforeEach(async () => {
  devId = await resetDevAccount(db);
});

const strip = (page: Page) => page.locator('[data-focal="strip"]');

test.describe("reorder, labels, strip, undo", () => {
  test("flex list: lifts the clear match with CSS order, labels it, and Undo restores", async ({ ext, extPage }) => {
    await signIn(extPage);
    const page = await ext.newPage();
    await page.goto(SEARCH);
    await expect(strip(page)).toBeVisible();
    await expect(page.locator('[data-focal="strip-text"]')).toHaveText("focal lifted 1 match for your taste");

    expect(await visualOrder(page, ".biz")).toEqual(["Rintaro", ...ORIGINAL.filter((n) => n !== "Rintaro")]);
    expect(await domOrder(page, ".biz")).toEqual(ORIGINAL);
    const got = await labels(page, ".biz");
    expect(Object.keys(got)).toEqual(["Rintaro"]);
    // The demo profile likes Rintaro outright, so the label is the favourite
    // badge saying so directly rather than a grounded "because you like X".
    // `labels()` already reads the span inside the label's shadow root; the
    // tooltip only carries the reason on compact tiles, not a flex list.
    expect(got.Rintaro).toMatchObject({ badge: "favourite", text: "You like this" });

    await page.locator('[data-focal="undo"]').click();
    await expect(page.locator("[data-focal]")).toHaveCount(0);
    await expect.poll(() => visualOrder(page, ".biz")).toEqual(ORIGINAL);
  });

  test("block list (ul/li): moves DOM nodes and Undo restores the DOM order", async ({ ext, extPage }) => {
    await signIn(extPage);
    const page = await ext.newPage();
    await page.goto(`${SITES}/block?find_loc=San+Francisco`);
    await expect(strip(page)).toBeVisible();
    expect((await domOrder(page, "li.row"))[0]).toBe("Rintaro");
    await page.locator('[data-focal="undo"]').click();
    await expect.poll(() => domOrder(page, "li.row")).toEqual(ORIGINAL);
  });

  test("table rows: reorders without putting non-row elements in the table", async ({ ext, extPage }) => {
    await signIn(extPage);
    const page = await ext.newPage();
    await page.goto(`${SITES}/table?find_loc=San+Francisco`);
    await expect(strip(page)).toBeVisible();
    expect((await domOrder(page, "tr.r"))[0]).toBe("Rintaro");
    expect(await page.$$eval("tbody > :not(tr)", (e) => e.length)).toBe(0);
  });

  test("Why this order? opens the explanation for this page", async ({ ext, extPage }) => {
    await signIn(extPage);
    const page = await ext.newPage();
    await page.goto(SEARCH);
    await expect(strip(page)).toBeVisible();
    const [why] = await Promise.all([ext.waitForEvent("page"), page.locator('[data-focal="why"]').click()]);
    await why.waitForLoadState();
    expect(why.url()).toMatch(new RegExp(`^${WEB}/why/[0-9a-f-]{36}$`));
    await expect(why.getByRole("heading", { level: 1 })).toHaveText("yelp.com");
    await expect(why.locator('tr[data-outcome="lifted"]')).toContainText("Rintaro");
  });
});

test.describe("feedback on lifted cards", () => {
  test("Not for me saves a dislike from the page, and the card is not lifted again", async ({ ext, extPage }) => {
    await signIn(extPage);
    const page = await ext.newPage();
    await page.goto(SEARCH);
    const label = page.locator('.biz[data-name="Rintaro"] [data-focal="label"]');
    await expect(label).toBeVisible();
    await label.getByRole("button", { name: "Not for me" }).click();
    await expect(label.getByRole("status")).toHaveText("Saved · not for you");

    const { entries } = await db.profile.load(devId);
    expect(entries.find((e) => e.name === "Rintaro")).toMatchObject({ strength: "dislike" });
    const [latest] = await db.profile.activity(devId, { limit: 1 });
    expect(latest).toMatchObject({ actor: "page", action: "change" });

    await page.reload();
    await page.waitForTimeout(QUIET_MS);
    expect(Object.keys(await labels(page, ".biz"))).not.toContain("Rintaro");
  });

  test("More like this on a liked card saves without downgrading", async ({ ext, extPage }) => {
    await signIn(extPage);
    const page = await ext.newPage();
    await page.goto(SEARCH);
    const label = page.locator('.biz[data-name="Rintaro"] [data-focal="label"]');
    await label.getByRole("button", { name: "More like this" }).click();
    await expect(label.getByRole("status")).toHaveText("Saved · more like this");
    const { entries } = await db.profile.load(devId);
    expect(entries.find((e) => e.name === "Rintaro")).toMatchObject({ strength: "like" });
  });
});

test.describe("where it must not run", () => {
  async function untouched(ext: BrowserContext, url: string) {
    const before = logCount("POST /api/page/identify");
    const page = await ext.newPage();
    await page.goto(url);
    await page.waitForTimeout(QUIET_MS);
    await expect(page.locator("[data-focal]")).toHaveCount(0);
    expect(logCount("POST /api/page/identify")).toBe(before);
  }

  test("signed out", async ({ ext }) => untouched(ext, SEARCH));

  test("a page with a password field", async ({ ext, extPage }) => {
    await signIn(extPage);
    await untouched(ext, `${SITES}/login?find_loc=San+Francisco`);
  });

  test("a never-run site (email)", async ({ ext, extPage }) => {
    await signIn(extPage);
    await untouched(ext, "http://mail.google.com/");
  });

  test("a site on the skip list", async ({ ext, extPage }) => {
    await signIn(extPage);
    await setSettings(extPage, { skipSites: ["yelp.com"], siteOff: [], incognito: false });
    await untouched(ext, SEARCH);
  });

  test("an unknown site is identified but nothing is ranked or changed", async ({ ext, extPage }) => {
    await signIn(extPage);
    const identify = logCount("POST /api/page/identify");
    const rank = logCount("POST /api/page/rank");
    const page = await ext.newPage();
    await page.goto("http://example.org/");
    await expect.poll(() => logCount("POST /api/page/identify"), { timeout: 15_000 }).toBeGreaterThan(identify);
    await page.waitForTimeout(3000);
    expect(logCount("POST /api/page/rank")).toBe(rank);
    await expect(page.locator("[data-focal]")).toHaveCount(0);
  });

  test("a film grid with no matches is left as the site made it", async ({ ext, extPage }) => {
    await signIn(extPage);
    const identify = logCount("POST /api/page/identify");
    const page = await ext.newPage();
    await page.goto("http://letterboxd.com/films");
    await expect.poll(() => logCount("POST /api/page/identify"), { timeout: 15_000 }).toBeGreaterThan(identify);
    await page.waitForTimeout(4000);
    await expect(page.locator("[data-focal]")).toHaveCount(0);
  });
});

test.describe("pages that change", () => {
  test("infinite scroll: a later match is labelled where it appears and seen items stay put", async ({ ext, extPage }) => {
    await signIn(extPage);
    const page = await ext.newPage();
    await page.goto(`${SITES}/infinite?find_loc=San+Francisco`);
    await expect(strip(page)).toBeVisible();
    const before = await visualOrder(page, ".biz");
    await page.locator("#more").click();
    await expect(page.locator('.biz[data-name="Rintaro"] [data-focal="label"]')).toHaveCount(1, { timeout: 20_000 });
    const after = await visualOrder(page, ".biz");
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual(["Rintaro", "Nari", "Lazy Bear"]);
  });

  test("single-page navigation: a new list after a URL change is ranked again", async ({ ext, extPage }) => {
    await signIn(extPage);
    const page = await ext.newPage();
    await page.goto(`${SITES}/spa?find_loc=San+Francisco`);
    await page.waitForTimeout(QUIET_MS);
    await page.locator("#next").click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('.biz[data-name="Rintaro"] [data-focal="label"]')).toHaveCount(1, { timeout: 20_000 });
    expect((await visualOrder(page, ".biz"))[0]).toBe("Rintaro");
  });
});

test.describe("website hand-off and popup", () => {
  test("only the focal website can message the extension", async ({ ext, extPage, extensionId }) => {
    const site = await ext.newPage();
    await site.goto(SEARCH);
    expect(await site.evaluate(() => typeof (globalThis as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime?.sendMessage)).toBe("undefined");

    const focal = await ext.newPage();
    await focal.goto(`${WEB}/api/health`);
    const call = (msg: unknown) =>
      focal.evaluate(([id, m]) => new Promise((resolve) => chrome.runtime.sendMessage(id as string, m, resolve)), [extensionId, msg] as const);
    expect(await call({ type: "focal:ping" })).toEqual({ ok: true, version: "0.1.0" });
    expect(await call({ type: "focal:session", token: DEV_TOKEN, email: "dev@localhost" })).toEqual({ ok: true });
    expect((await storage(extPage)).session).toMatchObject({ token: DEV_TOKEN });
    await setSettings(extPage, { skipSites: [], siteOff: [], incognito: true });
    expect(await call({ type: "focal:settings", settings: { skipSites: ["https://www.Example.com/x"], siteOff: [] } })).toEqual({ ok: true });
    // The website doesn't manage incognito; the browser's choice is kept.
    expect((await storage(extPage)).settings).toEqual({ skipSites: ["example.com"], siteOff: [], incognito: true });
    expect(await call({ type: "focal:nope" })).toEqual({ ok: false, error: "bad_message" });
    expect(await call({ type: "focal:signout" })).toEqual({ ok: true });
    expect((await storage(extPage)).session).toBeUndefined();
  });

  test("popup signed out links to sign-in and chat", async ({ ext, extensionId }) => {
    const popup = await ext.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await expect(popup.locator("#account")).toContainText("Not signed in");
    await expect(popup.locator("#account a")).toHaveAttribute("href", `${WEB}/sign-in?from=extension`);
    await expect(popup.locator("#dashboard")).toHaveAttribute("href", `${WEB}/chat`);
  });

  async function popupFor(ext: BrowserContext, extPage: Page, extensionId: string, urlPattern: string) {
    const tab = await extPage.evaluate(async (p) => (await chrome.tabs.query({ url: p }))[0], urlPattern);
    expect(tab, `tab for ${urlPattern}`).toBeTruthy();
    const popup = await ext.newPage();
    // The real popup reads the active tab; point it at the site tab under test.
    await popup.addInitScript((t) => {
      chrome.tabs.query = (async () => [t]) as unknown as typeof chrome.tabs.query;
    }, tab);
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    return popup;
  }

  test("popup on a ranked page: Why works, and switching the site off syncs to the account", async ({ ext, extPage, extensionId, request }) => {
    await signIn(extPage);
    const page = await ext.newPage();
    await page.goto(SEARCH);
    await expect(strip(page)).toBeVisible();

    const popup = await popupFor(ext, extPage, extensionId, "http://www.yelp.com/*");
    await expect(popup.locator("#account")).toHaveText("Signed in as dev@localhost");
    await expect(popup.locator("#site-toggle")).toBeChecked();
    const [why] = await Promise.all([ext.waitForEvent("page"), popup.locator("#why").click()]);
    await why.waitForLoadState();
    expect(why.url()).toMatch(/\/why\/[0-9a-f-]{36}$/);

    const reload = page.waitForEvent("load");
    await popup.locator("#site-toggle").click();
    await reload;
    expect((await storage(extPage)).settings).toMatchObject({ siteOff: ["yelp.com"] });
    await expect
      .poll(async () => (await (await request.get("/api/settings", { headers: { authorization: `Bearer ${DEV_TOKEN}` } })).json()).siteOff)
      .toEqual(["yelp.com"]);
    await page.waitForTimeout(QUIET_MS);
    await expect(page.locator("[data-focal]")).toHaveCount(0);
  });

  test("popup on a never-run site: the switch is disabled with the reason", async ({ ext, extPage, extensionId }) => {
    await signIn(extPage);
    const page = await ext.newPage();
    await page.goto("http://mail.google.com/");
    const popup = await popupFor(ext, extPage, extensionId, "http://mail.google.com/*");
    await expect(popup.locator("#site-toggle")).toBeDisabled();
    await expect(popup.locator("#site-status")).toHaveText("focal never runs on this kind of site.");
  });
});
