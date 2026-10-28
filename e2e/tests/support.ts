import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect as baseExpect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { openDb, type Db } from "@focal-ai/db";
import { DATABASE_URL, EXT_DIR, EXTENSION_ID, SITES_PORT, WEB_PORT } from "../servers";

export const WEB = `http://localhost:${WEB_PORT}`;
export const SITES = "http://www.yelp.com";
export const SEARCH = `${SITES}/search?find_desc=dinner&find_loc=San+Francisco`;
/** Any token that isn't an fx_ session is the dev@localhost account in dev mode. */
export const DEV_TOKEN = "dev-token";

/** Fixture hostnames, served by sites/server.mjs. */
const HOSTS = ["www.yelp.com", "example.org", "mail.google.com", "letterboxd.com"];

/** Count request lines in the Next dev log, e.g. "POST /api/page/identify". */
export function logCount(pattern: string): number {
  const log = process.env.WEB_LOG;
  if (!log || !existsSync(log)) return 0;
  return readFileSync(log, "utf8").split("\n").filter((l) => l.includes(pattern)).length;
}

export function database(): Db {
  return openDb(DATABASE_URL, { max: 2 });
}

type Fixtures = { ext: BrowserContext; extPage: Page; extensionId: string };

/** A Chromium with the unpacked extension loaded and the fixture sites mapped to localhost. */
export const test = base.extend<Fixtures>({
  ext: async ({}, use, testInfo) => {
    const context = await chromium.launchPersistentContext(join(testInfo.outputDir, "profile"), {
      channel: "chromium",
      headless: true,
      args: [
        "--no-proxy-server",
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
        `--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${SITES_PORT}`).join(", ")}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({}, use) => {
    await use(EXTENSION_ID);
  },
  // An extension page has the worker's chrome.* APIs and, unlike the worker, doesn't restart under us.
  extPage: async ({ ext, extensionId }, use) => {
    const page = await ext.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await use(page);
    await page.close().catch(() => {});
  },
});

export const expect = baseExpect;

export async function signIn(extPage: Page, token = DEV_TOKEN, email = "dev@localhost"): Promise<void> {
  await extPage.evaluate(
    ([t, e]) => chrome.storage.local.set({ session: { token: t, email: e, savedAt: new Date().toISOString() } }),
    [token, email],
  );
}

export async function setSettings(extPage: Page, settings: Record<string, unknown>): Promise<void> {
  await extPage.evaluate((s) => chrome.storage.local.set({ settings: s }), settings);
}

export async function storage(extPage: Page): Promise<Record<string, unknown>> {
  return extPage.evaluate(() => chrome.storage.local.get(null));
}

/**
 * Card names in visual order (top to bottom, then left to right), hidden ones left out.
 * Waits for running animations first: cards slide into place, and their boxes move with them.
 */
export async function visualOrder(page: Page, selector: string): Promise<string[]> {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  return page.$$eval(selector, (els) =>
    els
      .map((el) => ({ name: (el as HTMLElement).dataset.name ?? "", r: el.getBoundingClientRect(), shown: (el as HTMLElement).offsetParent !== null }))
      .filter((x) => x.shown)
      .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left)
      .map((x) => x.name),
  );
}

export async function domOrder(page: Page, selector: string): Promise<string[]> {
  return page.$$eval(selector, (els) => els.map((el) => (el as HTMLElement).dataset.name ?? ""));
}

/** focal label text per card name (labels render in open shadow roots). */
export async function labels(page: Page, cardSelector: string): Promise<Record<string, { text: string; badge: string | null }>> {
  return page.$$eval(cardSelector, (cards) => {
    const out: Record<string, { text: string; badge: string | null }> = {};
    for (const card of cards) {
      const host = card.querySelector('[data-focal="label"]');
      if (!host) continue;
      out[(card as HTMLElement).dataset.name ?? ""] = {
        text: host.shadowRoot?.querySelector("span")?.textContent?.trim() ?? "",
        badge: host.getAttribute("data-badge"),
      };
    }
    return out;
  });
}

/** The demo profile the dev account starts with (mock Qloo ids): loves Fugazi, likes Rintaro. */
const DEV_ENTRIES = [
  { id: "dev-fugazi", kind: "thing", qlooId: "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948", name: "Fugazi", type: "urn:entity:artist", strength: "love", source: "manual", createdAt: "2026-10-20T00:00:00.000Z" },
  { id: "dev-rintaro", kind: "thing", qlooId: "3A8F2C41-7B6D-4E92-8A55-1F0C9D2E6A01", name: "Rintaro", type: "urn:entity:place", strength: "like", source: "manual", createdAt: "2026-10-20T00:00:00.000Z" },
];

/**
 * Puts dev@localhost back to the demo profile with no activity or site
 * settings, so each test starts from the same place. Returns the account id.
 */
export async function resetDevAccount(db: Db): Promise<string> {
  const user = await db.users.upsert("dev@localhost", { workos: "dev" });
  await db.sql`DELETE FROM activity_events WHERE user_id = ${user.id}`;
  await db.sql`DELETE FROM profile_entries WHERE user_id = ${user.id}`;
  await db.sql`DELETE FROM site_settings WHERE user_id = ${user.id}`;
  for (const entry of DEV_ENTRIES) {
    await db.profile.commit(user.id, { id: crypto.randomUUID(), actor: "system", action: "add", entryId: entry.id, after: entry as never, at: new Date().toISOString() });
  }
  await db.sql`DELETE FROM activity_events WHERE user_id = ${user.id}`;
  return user.id;
}

export { WEB_PORT };
