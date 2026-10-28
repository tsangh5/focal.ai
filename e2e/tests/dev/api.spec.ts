// Website API in local-dev mode: mock Qloo and Jev, dev sessions, database, sign-in not configured.
import { test, expect, type APIRequestContext } from "@playwright/test";
import type { Db } from "@focal-ai/db";
import { database, DEV_TOKEN, resetDevAccount, WEB } from "../support";

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };
const CARDS = [
  ["Olive Garden", "Italian"],
  ["Rintaro", "Izakaya"],
  ["Zuni Café", "Californian"],
  ["House of Prime Rib", "Steakhouse"],
  ["State Bird Provisions", "New American"],
  ["Che Fico", "Italian"],
].map(([name, cat], i) => ({ clientId: `c${i}`, snippets: [name, cat], links: [] }));
const identifyBody = (host = "yelp.com") => ({ host, pathPattern: "/search", signature: "div.biz", cityHints: ["San Francisco"], cards: CARDS });

let db: Db;
let devId = "";
test.beforeAll(() => {
  db = database();
});
test.afterAll(async () => db.close());
test.beforeEach(async () => {
  devId = await resetDevAccount(db);
});

async function identify(request: APIRequestContext, host = "yelp.com") {
  const res = await request.post("/api/page/identify", { headers: AUTH, data: identifyBody(host) });
  expect(res.status()).toBe(200);
  return res.json();
}

test.describe("health, headers, account", () => {
  test("health reports mock data", async ({ request }) => {
    expect(await (await request.get("/api/health")).json()).toEqual({ ok: true, hasQlooKey: false, dataSource: "mock" });
  });

  test("security headers on pages and APIs", async ({ request }) => {
    for (const path of ["/", "/profile", "/chat", "/api/health"]) {
      const h = (await request.get(path)).headers();
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["x-frame-options"], path).toBe("DENY");
      expect(h["content-security-policy"], path).toContain("default-src");
    }
  });

  test("/api/me is the local dev account", async ({ request }) => {
    expect(await (await request.get("/api/me")).json()).toEqual({ signedIn: true, email: "dev@localhost" });
  });
});

test.describe("page API used by the extension", () => {
  test("identify validates input; a restaurant site yields place items; an unknown site yields none", async ({ request }) => {
    expect((await request.post("/api/page/identify", { data: identifyBody() })).status()).toBe(401);
    expect((await request.post("/api/page/identify", { headers: { ...AUTH, "content-type": "application/json" }, data: "{nope" })).status()).toBe(400);
    expect((await request.post("/api/page/identify", { headers: AUTH, data: { ...identifyBody(), cards: [] } })).status()).toBe(400);
    const known = await identify(request);
    expect(known).toMatchObject({ isList: true, pageType: "place" });
    expect(known.items[1]).toEqual({ clientId: "c1", name: "Rintaro", type: "place", city: "San Francisco" });
    expect((await identify(request, "example.org")).items).toEqual([]);
  });

  test("rank lifts the clear match with a grounded reason and keeps the result for its owner", async ({ request }) => {
    const { pageType, items } = await identify(request);
    const res = await request.post("/api/page/rank", { headers: AUTH, data: { host: "yelp.com", pathPattern: "/search", pageType, items } });
    const body = await res.json();
    expect(body.status).toBe("ranked");
    const ops = body.plan.ops as { op: string; clientId?: string; order?: string[]; text?: string; badge?: string }[];
    expect(ops.find((o) => o.op === "reorder")!.order![0]).toBe("c1");
    expect(ops.filter((o) => o.op === "annotate")).toEqual([
      expect.objectContaining({ clientId: "c1", badge: "top-pick", text: "Top pick for you · because you like Fugazi" }),
    ]);
    const row = await (await request.get(`/api/page/result/${body.pageResultId}`, { headers: AUTH })).json();
    expect(row).toMatchObject({ userId: devId, hostname: "yelp.com", status: "ranked" });
    expect((await request.get(`/api/page/result/00000000-0000-4000-8000-000000000000`, { headers: AUTH })).status()).toBe(404);
  });
});

test.describe("profile, activity and settings APIs", () => {
  test("change, remove and undo show up in the activity log", async ({ request }) => {
    expect((await request.patch("/api/profile/dev-rintaro", { data: { strength: "love" } })).status()).toBe(200);
    expect((await request.delete("/api/profile/dev-fugazi")).status()).toBe(200);
    const { events } = await (await request.get("/api/activity")).json();
    expect(events.map((e: { action: string; actor: string }) => `${e.actor}:${e.action}`)).toEqual(["manual:remove", "manual:change"]);
    expect((await request.post(`/api/activity/${events[0].id}/undo`)).status()).toBe(200);
    const { entries } = await (await request.get("/api/profile")).json();
    expect(entries.map((e: { name: string; strength: string }) => `${e.name}:${e.strength}`).sort()).toEqual(["Fugazi:love", "Rintaro:love"]);
  });

  test("settings are shared by the website and the extension", async ({ request }) => {
    const saved = await (await request.put("/api/settings", { data: { skipSites: ["https://www.Reddit.com/r/x"] } })).json();
    expect(saved).toEqual({ skipSites: ["reddit.com"], siteOff: [] });
    expect(await (await request.get("/api/settings", { headers: AUTH })).json()).toEqual(saved);
  });
});

test.describe("sign-in, chat and MCP without sign-in configured", () => {
  test("sign-in routes report not configured", async ({ request }) => {
    for (const [method, path] of [["GET", "/sign-in"], ["POST", "/sign-out"], ["GET", "/auth/callback"]] as const) {
      const res = await request.fetch(path, { method, maxRedirects: 0 });
      expect(res.status(), path).toBe(404);
    }
    expect((await request.post("/api/extension/session")).status()).toBe(404);
  });

  test("chat accepts the dev account but has no model configured", async ({ request }) => {
    const res = await request.post("/api/chat", { data: { messages: [{ role: "user", content: "I love Fugazi" }] } });
    expect(res.status()).toBe(503);
  });

  test("MCP challenges callers without a token; metadata points at the resource", async ({ request }) => {
    const res = await request.post("/mcp", { data: {} });
    expect(res.status()).toBe(401);
    expect(res.headers()["www-authenticate"]).toContain("resource_metadata=");
    expect(await (await request.get("/.well-known/oauth-protected-resource/mcp")).json()).toMatchObject({ resource: `${WEB}/mcp` });
    expect((await request.get("/.well-known/oauth-authorization-server")).status()).toBe(404);
  });
});
