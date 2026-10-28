// Real extension sessions (fx_ tokens) for a fresh account: MCP, page API, hard rules, revocation.
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Db } from "@focal-ai/db";
import { database, expect, signIn, SEARCH, storage, test, WEB } from "../support";

let db: Db;
let userId = "";
let token = "";
let otherToken = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  db = database();
  userId = (await db.users.upsert(`e2e-${randomUUID()}@example.com`)).id;
  token = (await db.extensionSessions.issue(userId)).token;
  const other = await db.users.upsert(`e2e-other-${randomUUID()}@example.com`);
  otherToken = (await db.extensionSessions.issue(other.id)).token;
});

test.afterAll(async () => {
  await db.users.delete(userId).catch(() => {});
  await db.close();
});

async function mcp(t: string) {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${WEB}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${t}` } } }));
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text?: string }[]).find((c) => c.type === "text")?.text ?? "";
  return { isError: Boolean(res.isError), text, data: text.startsWith("{") ? (JSON.parse(text) as Record<string, unknown>) : undefined };
}

const YELP = ["Olive Garden", "Zuni Café", "House of Prime Rib", "Rintaro", "State Bird Provisions", "Che Fico"];
const identifyBody = {
  host: "yelp.com",
  pathPattern: "/search",
  signature: "div.biz",
  cityHints: ["San Francisco"],
  cards: YELP.map((name, i) => ({ clientId: `c${i}`, snippets: [name, "Restaurant"], links: [] })),
};

test("MCP: missing and unknown tokens get OAuth challenges", async ({ request }) => {
  const missing = await request.post("/mcp", { data: {} });
  expect(missing.status()).toBe(401);
  expect(missing.headers()["www-authenticate"]).toBe(`Bearer resource_metadata="${WEB}/.well-known/oauth-protected-resource/mcp"`);
  const bogus = await request.post("/mcp", { data: {}, headers: { authorization: "Bearer fx_not-a-real-session" } });
  expect(bogus.status()).toBe(401);
  expect(bogus.headers()["www-authenticate"]).toContain('error="invalid_token"');
});

test("MCP: an assistant reads and writes the profile with save-when-certain rules", async () => {
  const client = await mcp(token);
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  expect(tools).toEqual(["add_thing", "add_vibe", "propose_rule", "rank_list", "read_profile", "recommend", "remove_entry", "search_entities", "taste_summary"]);

  expect((await call(client, "search_entities", { query: "Rintaro", type: "place", city: "San Francisco" })).text).toContain("Rintaro");
  expect((await call(client, "add_thing", { name: "Rintaro", type: "place", strength: "like", city: "San Francisco" })).data).toMatchObject({ saved: true });
  expect((await call(client, "add_thing", { name: "Fugazi", type: "artist", strength: "love" })).data).toMatchObject({ saved: true });
  expect((await call(client, "add_thing", { name: "Zzyzx Unknown Bistro", type: "place", strength: "like" })).data).toMatchObject({ saved: false });
  expect((await call(client, "add_vibe", { vibe: "natural wine", strength: "like" })).data).toMatchObject({ saved: true });
  expect((await call(client, "propose_rule", { rule: "natural wine", tag_id: "urn:tag:cuisine:natural_wine" })).data).toMatchObject({ saved: true, status: "pending" });
  expect((await call(client, "taste_summary")).data).toMatchObject({ things: 2, vibes: 1, pending_rules: 1 });
  expect((await call(client, "recommend", { type: "place", city: "San Francisco" })).isError).toBe(false);
  const ranked = (await call(client, "rank_list", { type: "place", city: "San Francisco", items: YELP })).data as { items: { name: string; lifted: boolean }[] };
  expect(ranked.items[0]).toMatchObject({ name: "Rintaro", lifted: true });

  // The vibe and the rule share a name: the tool asks, then removes the kind it is given.
  expect((await call(client, "remove_entry", { name: "Natural Wine" })).data).toMatchObject({ removed: false, choices: [{ kind: "vibe" }, { kind: "rule" }] });
  expect((await call(client, "remove_entry", { name: "Natural Wine", kind: "vibe" })).data).toMatchObject({ removed: true });

  const { entries } = await db.profile.load(userId);
  expect(entries.map((e) => `${e.kind}:${e.name}:${e.strength}${e.status ? `:${e.status}` : ""}`).sort()).toEqual(
    ["rule:Natural Wine:never:pending", "thing:Fugazi:love", "thing:Rintaro:like"].sort(),
  );
  const activity = await db.profile.activity(userId);
  expect(activity).toHaveLength(5);
  expect(activity.every((a) => a.actor.startsWith("mcp:"))).toBe(true);
  await client.close();
});

test("page API with a real session ranks against the stored profile and keeps results per user", async ({ request }) => {
  const auth = { authorization: `Bearer ${token}` };
  const ident = await (await request.post("/api/page/identify", { headers: auth, data: identifyBody })).json();
  const body = await (await request.post("/api/page/rank", { headers: auth, data: { host: "yelp.com", pathPattern: "/search", pageType: ident.pageType, items: ident.items } })).json();
  expect(body.plan.ops.filter((o: { op: string }) => o.op === "annotate").length).toBeGreaterThan(0);
  expect((await db.pageResults.get(body.pageResultId, userId))?.hostname).toBe("yelp.com");
  expect((await request.get(`/api/page/result/${body.pageResultId}`, { headers: auth })).status()).toBe(200);
  expect((await request.get(`/api/page/result/${body.pageResultId}`, { headers: { authorization: `Bearer ${otherToken}` } })).status()).toBe(404);
});

test("a pending rule has no effect; an active hard rule folds matching items behind Show", async ({ ext, extPage, request }) => {
  const auth = { authorization: `Bearer ${token}` };
  const ident = await (await request.post("/api/page/identify", { headers: auth, data: identifyBody })).json();
  const pending = await (await request.post("/api/page/rank", { headers: auth, data: { host: "yelp.com", pathPattern: "/search", pageType: ident.pageType, items: ident.items } })).json();
  expect(pending.plan.ops.some((o: { op: string }) => o.op === "collapse")).toBe(false);

  // Mock tag search only knows wine tags, so save a website rule ("never izakaya") directly; manual rules are active.
  const id = randomUUID();
  const at = new Date().toISOString();
  const rule = { id, kind: "rule", qlooId: "urn:tag:venue_style:izakaya", name: "Izakaya", strength: "never", status: "active", source: "manual", createdAt: at };
  await db.profile.commit(userId, { id: randomUUID(), actor: "manual", action: "add", entryId: id, after: rule as never, at });

  await signIn(extPage, token, "e2e@example.com");
  const page = await ext.newPage();
  await page.goto(SEARCH);
  const fold = page.locator('[data-focal="fold"]');
  await expect(fold).toContainText("1 hidden by your rules (Izakaya)");
  await expect(page.locator('.biz[data-name="Rintaro"]')).toBeHidden();
  await fold.getByRole("button", { name: "Show" }).click();
  await expect(page.locator('.biz[data-name="Rintaro"]')).toBeVisible();
});

test("revoking the session signs the extension out and closes MCP access", async ({ ext, extPage, request }) => {
  expect((await request.delete("/api/extension/session", { headers: { authorization: `Bearer ${token}` } })).status()).toBe(204);
  expect((await request.post("/api/page/identify", { headers: { authorization: `Bearer ${token}` }, data: identifyBody })).status()).toBe(401);
  expect((await request.post("/mcp", { data: {}, headers: { authorization: `Bearer ${token}` } })).status()).toBe(401);

  await signIn(extPage, token, "e2e@example.com");
  const page = await ext.newPage();
  await page.goto(SEARCH);
  await expect.poll(async () => (await storage(extPage)).session, { timeout: 20_000 }).toBeUndefined();
  await expect(page.locator("[data-focal]")).toHaveCount(0);
});
