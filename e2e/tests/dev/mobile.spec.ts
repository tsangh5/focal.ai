// The website on a phone: nothing scrolls sideways, the header still reaches every page, fields don't make iOS zoom.
import type { Page } from "@playwright/test";
import type { Db } from "@focal-ai/db";
import { database, DEV_TOKEN, expect, resetDevAccount, test } from "../support";

test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

let db: Db;
test.beforeAll(() => {
  db = database();
});
test.afterAll(async () => db.close());
test.beforeEach(async () => {
  await resetDevAccount(db);
});

/** How far the page is wider than the screen, in CSS pixels. */
async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("no page scrolls sideways at 360px", async ({ page, request }) => {
  // A real "Why this order?" result: its table is the widest thing on the site.
  const auth = { authorization: `Bearer ${DEV_TOKEN}` };
  const cards = ["Olive Garden", "Rintaro", "Zuni Café", "State Bird Provisions"].map((name, i) => ({ clientId: `c${i}`, snippets: [name], links: [] }));
  const base = { host: "yelp.com", pathPattern: "/search" };
  const ident = await (await request.post("/api/page/identify", { headers: auth, data: { ...base, signature: "div.biz", cityHints: ["San Francisco"], cards } })).json();
  const { pageResultId } = await (await request.post("/api/page/rank", { headers: auth, data: { ...base, pageType: ident.pageType, items: ident.items } })).json();

  for (const path of ["/", "/chat", "/profile", "/activity", "/settings", "/onboarding", "/privacy", "/sign-in/failed", `/why/${pageResultId}`]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await sidewaysOverflow(page), path).toBeLessThanOrEqual(0);
  }
});

test("the header keeps every link and the account menu on a phone", async ({ page }) => {
  await page.goto("/profile");
  const nav = page.getByRole("navigation", { name: "Site" });
  for (const name of ["Chat", "Profile", "Activity", "Settings", "Extension"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  }
  // The trigger shows only its icon; the menu still names the account.
  const trigger = page.getByRole("button", { name: "Account menu" });
  await expect(trigger).toBeVisible();
  await expect(trigger.getByText("dev@localhost")).toBeHidden();
  await trigger.click();
  await expect(page.getByRole("menu")).toContainText("dev@localhost");
  await page.keyboard.press("Escape");

  await nav.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page).toHaveURL(/\/activity$/);
});

test("fields are 16px so iOS doesn't zoom, and the chat box stays on screen", async ({ page }) => {
  await page.goto("/chat");
  const box = page.getByRole("textbox", { name: "Tell Iris what you like" });
  expect(await box.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
  const viewport = page.viewportSize()!;
  const at = (await box.boundingBox())!;
  expect(at.y + at.height).toBeLessThanOrEqual(viewport.height);

  await page.goto("/profile");
  expect(await page.getByRole("combobox", { name: "How much you like Rintaro" }).evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
});

test("the always-skipped list opens one category at a time", async ({ page }) => {
  await page.goto("/settings");
  const banking = page.locator('[data-category="banking"]');
  await expect(banking.getByText("paypal.com")).toBeHidden();
  await banking.locator("summary").click();
  await expect(banking.getByText("paypal.com")).toBeVisible();
});
