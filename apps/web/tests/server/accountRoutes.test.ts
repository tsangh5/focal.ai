import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addEntry } from "@focal-ai/core";
import { __setDbForTests } from "@/lib/server/db";
import { __setPageResultStoreForTests, createMemoryPageResultStore } from "@/lib/server/page/store";
import { clearMemoryProfile, memoryProfileStore } from "@/lib/server/profile/store";
import { __resetRateLimitForTests } from "@/lib/server/rateLimit";
import { clearMemorySites } from "@/lib/server/settings/store";

// Route handlers call connection() to stay per-request; outside Next there is no request scope.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

process.env.QLOO_MOCK = "1";
process.env.FOCAL_DEV_SESSION = "1";

type Handler = (req: Request, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
const routes: Record<string, Record<string, Handler>> = {};

beforeAll(async () => {
  __setDbForTests(null);
  routes.profile = (await import("@/app/api/profile/route")) as unknown as Record<string, Handler>;
  routes.entry = (await import("@/app/api/profile/[id]/route")) as unknown as Record<string, Handler>;
  routes.activity = (await import("@/app/api/activity/route")) as unknown as Record<string, Handler>;
  routes.undo = (await import("@/app/api/activity/[id]/undo/route")) as unknown as Record<string, Handler>;
  routes.settings = (await import("@/app/api/settings/route")) as unknown as Record<string, Handler>;
  routes.account = (await import("@/app/api/account/route")) as unknown as Record<string, Handler>;
  routes.feedback = (await import("@/app/api/feedback/route")) as unknown as Record<string, Handler>;
  routes.rank = (await import("@/app/api/page/rank/route")) as unknown as Record<string, Handler>;
});

beforeEach(() => {
  __resetRateLimitForTests();
  __setPageResultStoreForTests(createMemoryPageResultStore());
  clearMemoryProfile("dev");
  clearMemorySites("dev");
});

const req = (url: string, method = "GET", body?: unknown, token?: string) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

describe("profile", () => {
  it("lists the dev viewer's entries and changes a strength", async () => {
    const { entries } = (await json(await routes.profile!.GET!(req("/api/profile")))) as { entries: { id: string; name: string }[] };
    expect(entries.map((e) => e.name)).toEqual(["Fugazi", "Rintaro"]);
    const res = await routes.entry!.PATCH!(req("/api/profile/dev-rintaro", "PATCH", { strength: "love" }), params("dev-rintaro"));
    expect(res.status).toBe(200);
    expect((await memoryProfileStore("dev").load()).entries.find((e) => e.id === "dev-rintaro")).toMatchObject({ strength: "love" });
  });

  it("approves a pending rule, which only the website can do", async () => {
    const store = memoryProfileStore("dev");
    const { profile, event } = addEntry(await store.load(), { kind: "rule", qlooId: "urn:tag:chain", name: "chains", source: "chat" }, "chat");
    await store.commit(profile, event);
    expect(event.after).toMatchObject({ status: "pending" });
    const res = await routes.entry!.PATCH!(req(`/api/profile/${event.entryId}`, "PATCH", { approve: true }), params(event.entryId));
    expect(res.status).toBe(200);
    expect((await store.load()).entries.find((e) => e.id === event.entryId)).toMatchObject({ status: "active" });
  });

  it("rejects bad bodies and unknown entries; removes entries", async () => {
    expect((await routes.entry!.PATCH!(req("/api/profile/dev-rintaro", "PATCH", { strength: "adore" }), params("dev-rintaro"))).status).toBe(400);
    expect((await routes.entry!.PATCH!(req("/api/profile/nope", "PATCH", { strength: "like" }), params("nope"))).status).toBe(404);
    expect((await routes.entry!.PATCH!(req("/api/profile/dev-fugazi", "PATCH", { approve: true }), params("dev-fugazi"))).status).toBe(400);
    expect((await routes.entry!.DELETE!(req("/api/profile/dev-fugazi", "DELETE"), params("dev-fugazi"))).status).toBe(200);
    expect((await memoryProfileStore("dev").load()).entries.map((e) => e.name)).toEqual(["Rintaro"]);
  });
});

describe("activity", () => {
  it("lists changes newest first and undoes one, once", async () => {
    await routes.entry!.DELETE!(req("/api/profile/dev-fugazi", "DELETE"), params("dev-fugazi"));
    const { events } = (await json(await routes.activity!.GET!(req("/api/activity")))) as { events: { id: string; action: string; actor: string }[] };
    expect(events).toMatchObject([{ action: "remove", actor: "manual" }]);
    const id = events[0]!.id;
    expect((await routes.undo!.POST!(req(`/api/activity/${id}/undo`, "POST"), params(id))).status).toBe(200);
    expect((await memoryProfileStore("dev").load()).entries.map((e) => e.name).sort()).toEqual(["Fugazi", "Rintaro"]);
    expect((await routes.undo!.POST!(req(`/api/activity/${id}/undo`, "POST"), params(id))).status).toBe(409);
    expect((await routes.undo!.POST!(req("/api/activity/missing/undo", "POST"), params("missing"))).status).toBe(404);
  });
});

describe("settings", () => {
  it("normalizes and replaces site lists, for the website and the extension", async () => {
    const put = await routes.settings!.PUT!(req("/api/settings", "PUT", { skipSites: ["https://www.Reddit.com/r/x", "reddit.com", "not a host!"] }));
    expect(await json(put)).toEqual({ skipSites: ["reddit.com"], siteOff: [] });
    const fromExtension = await routes.settings!.PUT!(req("/api/settings", "PUT", { siteOff: ["yelp.com"] }, "dev-token"));
    expect(await json(fromExtension)).toEqual({ skipSites: ["reddit.com"], siteOff: ["yelp.com"] });
    expect(await json(await routes.settings!.GET!(req("/api/settings", "GET", undefined, "dev-token")))).toEqual({ skipSites: ["reddit.com"], siteOff: ["yelp.com"] });
    expect((await routes.settings!.PUT!(req("/api/settings", "PUT", { extra: true }))).status).toBe(400);
  });
});

describe("feedback from a page", () => {
  async function rankYelp() {
    const items = ["Olive Garden", "Rintaro", "Zuni Café", "State Bird Provisions", "House of Prime Rib"].map((name, i) => ({
      clientId: `c${i}`,
      name,
      type: "place",
      city: "San Francisco",
    }));
    const res = await routes.rank!.POST!(req("/api/page/rank", "POST", { host: "yelp.com", pathPattern: "/search", pageType: "place", items }, "dev-token"));
    return (await json(res)).pageResultId as string;
  }

  it("Not for me saves a dislike and More like this never downgrades a love", async () => {
    const id = await rankYelp();
    const less = await routes.feedback!.POST!(req("/api/feedback", "POST", { pageResultId: id, clientId: "c2", verdict: "less" }, "dev-token"));
    expect(await json(less)).toMatchObject({ saved: true, name: "Zuni Café", strength: "dislike" });
    const zuni = (await memoryProfileStore("dev").load()).entries.find((e) => e.name === "Zuni Café");
    expect(zuni).toMatchObject({ kind: "thing", strength: "dislike", source: "page", type: "urn:entity:place" });

    await routes.entry!.PATCH!(req("/api/profile/dev-rintaro", "PATCH", { strength: "love" }), params("dev-rintaro"));
    const more = await routes.feedback!.POST!(req("/api/feedback", "POST", { pageResultId: id, clientId: "c1", verdict: "more" }, "dev-token"));
    expect(await json(more)).toMatchObject({ saved: true, strength: "love", unchanged: true });
  });

  it("needs the extension session and a known, resolved item", async () => {
    const id = await rankYelp();
    expect((await routes.feedback!.POST!(req("/api/feedback", "POST", { pageResultId: id, clientId: "c1", verdict: "more" }))).status).toBe(401);
    expect((await routes.feedback!.POST!(req("/api/feedback", "POST", { pageResultId: id, clientId: "c0", verdict: "more" }, "dev-token"))).status).toBe(404);
    expect((await routes.feedback!.POST!(req("/api/feedback", "POST", { pageResultId: id, clientId: "c1", verdict: "meh" }, "dev-token"))).status).toBe(400);
  });
});

describe("account", () => {
  it("exports everything as a JSON download and deletes the account", async () => {
    const res = await routes.account!.GET!(req("/api/account"));
    expect(res.headers.get("content-disposition")).toContain("focal-export.json");
    expect(((await json(res)).profile as { entries: unknown[] }).entries).toHaveLength(2);
    await routes.settings!.PUT!(req("/api/settings", "PUT", { skipSites: ["reddit.com"] }));
    await routes.entry!.DELETE!(req("/api/profile/dev-fugazi", "DELETE"), params("dev-fugazi"));
    expect((await routes.account!.DELETE!(req("/api/account", "DELETE"))).status).toBe(204);
    expect(await json(await routes.settings!.GET!(req("/api/settings")))).toEqual({ skipSites: [], siteOff: [] });
    expect((await json(await routes.activity!.GET!(req("/api/activity")))).events).toEqual([]);
  });
});

describe("OAuth authorization-server metadata", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WORKOS_AUTHKIT_DOMAIN;
  });

  it("answers 502 when AuthKit can't be reached", async () => {
    process.env.WORKOS_AUTHKIT_DOMAIN = "example.authkit.app";
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const { GET } = await import("@/app/api/oauth/authorization-server/route");
    const res = await GET();
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: "UPSTREAM" } });
  });
});
