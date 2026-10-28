// Website pages in local-dev mode (the dev@localhost account, no sign-in).
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Db } from "@focal-ai/db";
import { database, expect, resetDevAccount, SEARCH, signIn, storage, test, WEB } from "../support";

let db: Db;
let devId = "";
test.beforeAll(() => {
  db = database();
});
test.afterAll(async () => db.close());
test.beforeEach(async () => {
  devId = await resetDevAccount(db);
});

async function studioResults(page: Page): Promise<string[]> {
  return page.getByRole("list", { name: /results/ }).getByRole("heading", { level: 3 }).allTextContents();
}

async function addSeed(page: Page, name: string) {
  await page.getByPlaceholder("Search artists, films, places…").fill(name);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("listitem").filter({ hasText: name }).getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(page.getByRole("button", { name: `Remove ${name}` })).toBeVisible();
}

/** An assistant connected over MCP with a real session for the dev account. */
async function assistant() {
  const { token } = await db.extensionSessions.issue(devId);
  const client = new Client({ name: "e2e-assistant", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${WEB}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

test.describe("landing and header", () => {
  test("landing explains focal and starts onboarding; Try it opens the playground", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("The web, rendered for you.");
    await expect(page.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/onboarding");
    await page.getByRole("link", { name: "Try it without installing" }).click();
    await expect(page).toHaveURL(`${WEB}/try`);
    await expect(page.getByText("MOCK DATA")).toBeVisible();
  });

  test("header links reach every account page", async ({ page }) => {
    await page.goto("/chat");
    for (const [name, path, heading] of [
      ["Profile", "/profile", "Your taste"],
      ["Activity", "/activity", "Activity"],
      ["Settings", "/settings", "Settings"],
      ["Chat", "/chat", "Tell focal what you like"],
    ] as const) {
      await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(`${WEB}${path}`);
      await expect(page.getByText(heading, { exact: true }).first()).toBeVisible();
    }
  });

  test("account menu shows the account and its pages", async ({ page }) => {
    await page.goto("/chat");
    await page.getByRole("button", { name: "Account menu" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toContainText("dev@localhost");
    await expect(menu.getByRole("menuitem", { name: "Your taste" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Settings" })).toBeVisible();
  });

  test("unknown explanations and failed sign-ins get friendly pages", async ({ page }) => {
    await page.goto("/why/00000000-0000-4000-8000-000000000000");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This explanation isn't available");
    await page.goto("/sign-in/failed");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign-in didn't finish");
  });

  // Known issue: pages stream their shell first (partial prerendering), so notFound() inside it still answers 200.
  test.fixme("not-found pages answer with HTTP 404", async ({ request }) => {
    expect((await request.get("/why/00000000-0000-4000-8000-000000000000")).status()).toBe(404);
  });
});

test.describe("Studio playground (/try)", () => {
  test("add a like, Focus, and switch Original / Focal / Diff", async ({ page }) => {
    await page.goto("/try");
    await expect(page.getByRole("list", { name: /results/ }).getByRole("heading", { level: 3 })).toHaveCount(12);
    const original = await studioResults(page);
    await addSeed(page, "Rintaro");
    await page.getByRole("button", { name: "Focus 12 results" }).click();
    await expect(page.getByRole("button", { name: "Focal", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await studioResults(page)).not.toEqual(original);
    await expect(page.getByText("/v2/insights").first()).toBeVisible();
    await page.getByRole("button", { name: "Diff", exact: true }).click();
    await page.getByRole("button", { name: "Original", exact: true }).click();
    expect(await studioResults(page)).toEqual(original);
  });

  test("the playground profile persists, exports and clears", async ({ page }) => {
    await page.goto("/try");
    await addSeed(page, "Fugazi");
    await page.reload();
    await expect(page.getByRole("button", { name: "Remove Fugazi" })).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export JSON" }).click()]);
    expect(JSON.parse(readFileSync(await download.path(), "utf8")).seeds.map((s: { name: string }) => s.name)).toContain("Fugazi");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText("0 seeds")).toBeVisible();
  });

  test("Paste ranks your own list; Ask focal proposes rules", async ({ page }) => {
    await page.goto("/try");
    await addSeed(page, "Rintaro");
    await page.getByRole("button", { name: "Paste" }).click();
    await page.getByPlaceholder(/Paste restaurant names/).fill("Olive Garden\nZuni Café\nRintaro\nState Bird Provisions");
    await page.getByPlaceholder(/City \(optional\)/).fill("San Francisco");
    await page.getByRole("button", { name: /Use this list/ }).click();
    await page.getByRole("button", { name: "Focus 4 results" }).click();
    await expect(page.getByRole("list", { name: /results/ }).getByRole("heading", { level: 3 })).toHaveCount(4);
    await page.getByRole("tab", { name: "Ask focal" }).click();
    await page.getByRole("textbox", { name: "Ask the agent" }).fill("hide sponsored and boost natural wine");
    await page.getByRole("textbox", { name: "Ask the agent" }).press("Enter");
    await expect(page.getByText("Proposed rules")).toBeVisible();
  });
});

test.describe("chat", () => {
  test("controls are labelled, and a missing model is reported", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByRole("textbox", { name: "Tell focal what you like" })).toBeVisible();
    await page.getByRole("button", { name: "I love Fugazi" }).click();
    await expect(page.getByText("Chat isn't configured on this server yet.")).toBeVisible();
  });

  test("shows the agent's reply (model response stubbed)", async ({ page }) => {
    await page.route("**/api/chat", (route) =>
      route.fulfill({ json: { reply: "Saved Fugazi as a love.", events: [], provider: "groq" } }),
    );
    await page.goto("/chat");
    await page.getByRole("textbox", { name: "Tell focal what you like" }).fill("I love Fugazi");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator('[data-role="assistant"]').filter({ hasText: "Saved Fugazi as a love." })).toBeVisible();
  });
});

test.describe("profile, activity and settings", () => {
  test("approve a rule an assistant proposed; it becomes a hard rule", async ({ page }) => {
    const mcp = await assistant();
    await mcp.callTool({ name: "propose_rule", arguments: { rule: "natural wine", tag_id: "urn:tag:cuisine:natural_wine" } });
    await mcp.close();

    await page.goto("/profile");
    const pending = page.locator('[data-section="Rules waiting for you"]');
    await expect(pending.locator('[data-kind="rule"]')).toContainText("Never Natural Wine");
    await expect(pending.locator('[data-kind="rule"]')).toContainText("added via assistant");
    await pending.getByRole("button", { name: "Approve" }).click();
    await expect(pending).toHaveCount(0);
    await expect(page.locator('[data-section="Hard rules"]')).toContainText("Never Natural Wine");
    const { entries } = await db.profile.load(devId);
    expect(entries.find((e) => e.kind === "rule")).toMatchObject({ status: "active" });
  });

  test("change strength and remove from the profile, then undo from activity", async ({ page }) => {
    await page.goto("/profile");
    await page.getByRole("combobox", { name: "How much you like Rintaro" }).selectOption("love");
    await expect(page.getByRole("combobox", { name: "How much you like Rintaro" })).toHaveValue("love");
    await page.getByRole("button", { name: "Remove Fugazi" }).click();
    await expect(page.locator('[data-entry="Fugazi"]')).toHaveCount(0);

    await page.goto("/activity");
    const removed = page.locator('[data-event="remove"]');
    await expect(removed).toContainText("Removed Fugazi");
    await expect(removed).toContainText("you");
    await removed.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator('[data-event="remove"]').getByText("Undone")).toBeVisible();
    await expect(page.locator('[data-event="undo"]').first()).toContainText("Fugazi");

    await page.goto("/profile");
    await expect(page.locator('[data-entry="Fugazi"]')).toBeVisible();
  });

  test("assistant changes are attributed in the activity feed", async ({ page }) => {
    const mcp = await assistant();
    await mcp.callTool({ name: "add_thing", arguments: { name: "Zuni Café", type: "place", strength: "like", city: "San Francisco" } });
    await mcp.close();
    await page.goto("/activity");
    await expect(page.locator('[data-event="add"]').first()).toContainText("Saved Zuni Café · like");
    await expect(page.locator('[data-event="add"]').first()).toContainText("via assistant");
  });

  test("sites to skip reach the extension straight away", async ({ ext, extPage }) => {
    await signIn(extPage);
    const settings = await ext.newPage();
    await settings.goto(`${WEB}/settings`);
    await settings.getByRole("textbox", { name: "Site to skip" }).fill("https://www.yelp.com/search");
    await settings.getByRole("button", { name: "Add", exact: true }).click();
    await expect(settings.locator('[data-host="yelp.com"]')).toBeVisible();
    await expect.poll(async () => ((await storage(extPage)).settings as { skipSites?: string[] } | undefined)?.skipSites).toEqual(["yelp.com"]);

    const page = await ext.newPage();
    await page.goto(SEARCH);
    await page.waitForTimeout(5000);
    await expect(page.locator("[data-focal]")).toHaveCount(0);

    await settings.getByRole("button", { name: "Remove yelp.com" }).click();
    await expect(settings.getByText("You aren't skipping any sites.")).toBeVisible();
  });

  test("download my data", async ({ page }) => {
    await page.goto("/settings");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download my data" }).click()]);
    const data = JSON.parse(readFileSync(await download.path(), "utf8"));
    expect(data.user.email).toBe("dev@localhost");
    expect(data.profile.entries.map((e: { name: string }) => e.name).sort()).toEqual(["Fugazi", "Rintaro"]);
  });
});

test.describe("onboarding", () => {
  test("walks through taste, sites to skip, extension and try-it links", async ({ page }) => {
    await page.goto("/onboarding");
    const steps = page.getByRole("navigation", { name: "Onboarding steps" });
    await expect(steps.getByRole("button", { name: "1. Your taste" })).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("heading", { name: "Tell focal what you like" })).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Sites to skip", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Connect the extension")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    // The demo profile likes a restaurant and loves a band: restaurant and film lists.
    await expect(page.getByRole("link", { name: "Restaurants on Yelp" })).toHaveAttribute("href", "https://www.yelp.com/search?find_desc=restaurants");
    await expect(page.getByRole("link", { name: "Popular films on Letterboxd" })).toBeVisible();
    await page.getByRole("link", { name: "Done" }).click();
    await expect(page).toHaveURL(`${WEB}/profile`);
  });
});
