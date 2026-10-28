import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageResultItem } from "@focal-ai/core";
import { safeReturnTo } from "@/lib/server/auth/returnTo";
import { __setDbForTests } from "@/lib/server/db";
import {
  __setPageResultStoreForTests,
  createMemoryPageResultStore,
  getPageResultStore,
  type StoredPageResult,
} from "@/lib/server/page/store";
import { __resetRateLimitForTests } from "@/lib/server/rateLimit";
import { buildWhyView } from "@/lib/why";

// Route handlers call connection() to stay per-request; outside Next there is no request scope.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

process.env.QLOO_MOCK = "1";
process.env.FOCAL_DEV_SESSION = "1";

beforeAll(() => __setDbForTests(null));
beforeEach(() => {
  __resetRateLimitForTests();
  __setPageResultStoreForTests(createMemoryPageResultStore());
});

describe("safeReturnTo", () => {
  it("keeps same-origin paths", () => {
    expect(safeReturnTo("/why/abc")).toBe("/why/abc");
    expect(safeReturnTo("/chat?x=1")).toBe("/chat?x=1");
  });
  it("rejects anything that could leave the site", () => {
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "evil", "/a\nb", null, undefined, ""]) {
      expect(safeReturnTo(bad)).toBe("/connect");
    }
    expect(safeReturnTo("/" + "a".repeat(600))).toBe("/connect");
  });
});

const item = (clientId: string, name: string, originalIndex: number, extra: Partial<PageResultItem> = {}): PageResultItem => ({
  clientId,
  name,
  originalIndex,
  status: "resolved",
  outcome: "kept",
  ...extra,
});

const row = (over: Partial<StoredPageResult> = {}): StoredPageResult => ({
  id: "r1",
  userId: "dev",
  hostname: "example.com",
  status: "ranked",
  items: [
    item("a", "Alpha", 0, { affinity: 0.41 }),
    item("b", "Bravo", 1, { status: "unresolved", outcome: "unscored" }),
    item("c", "Charlie", 2, {
      affinity: 0.93,
      outcome: "lifted",
      label: { badge: "top-pick", text: "Top pick for you · because you like Fugazi", reasonNames: ["Fugazi"] },
    }),
  ],
  plan: {
    id: "p",
    pageId: "x",
    createdAt: "2026-10-20T00:00:00.000Z",
    ops: [{ op: "reorder", containerId: "k", order: ["c", "a", "b"] }],
    summary: { moved: 1, collapsed: 0, unresolved: 1, avgMovement: 1 },
  },
  meta: {
    resolved: 2,
    unresolved: 1,
    signals: { entities: [{ id: "f", name: "Fugazi", strength: "love" }], tags: [], localBoosts: [] },
    stats: { scored: 2, mean: 0.67, sd: 0.26 },
    qlooRequest: { path: "/v2/insights", params: { "filter.type": "urn:entity:place" } },
    durationMs: 1600,
  },
  createdAt: "2026-10-20T00:00:00.000Z",
  expiresAt: "2026-10-21T00:00:00.000Z",
  ...over,
});

describe("buildWhyView", () => {
  it("lists items in the order the user saw, with movement and exact affinity", () => {
    const view = buildWhyView(row());
    expect(view.items.map((i) => i.name)).toEqual(["Charlie", "Alpha", "Bravo"]);
    expect(view.items[0]).toMatchObject({ originalPosition: 3, finalPosition: 1, moved: 2, affinity: 0.93 });
    expect(view.items[1]).toMatchObject({ originalPosition: 1, finalPosition: 2, moved: -1 });
    expect(view.counts).toEqual({ lifted: 1, folded: 0, disliked: 0, resolved: 2, unresolved: 1 });
    expect(view.signals.entities.map((s) => s.name)).toEqual(["Fugazi"]);
    expect(view.qlooRequest?.path).toBe("/v2/insights");
    expect(view.durationMs).toBe(1600);
  });

  it("falls back to site order when there is no plan", () => {
    const view = buildWhyView(row({ status: "no_signals", plan: null, meta: {} }));
    expect(view.items.map((i) => i.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(view.items.every((i) => i.moved === 0)).toBe(true);
    expect(view.signals).toEqual({ entities: [], tags: [], localBoosts: [] });
    expect(view.stats.scored).toBe(2);
  });

  it("tolerates malformed stored data", () => {
    const view = buildWhyView(row({ items: "nope", plan: { ops: "bad" }, meta: null }));
    expect(view.items).toEqual([]);
  });

  it("renders a real ranked result from /api/page/rank", async () => {
    const { POST } = await import("@/app/api/page/rank/route");
    const names = ["Rintaro", "State Bird Provisions", "Zuni Café", "House of Prime Rib", "Che Fico"];
    const res = await POST(
      new Request("http://localhost/api/page/rank", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer dev-token" },
        body: JSON.stringify({
          host: "www.yelp.com",
          pathPattern: "/search",
          pageType: "place",
          items: names.map((name, i) => ({ clientId: `c${i}`, name, type: "place", city: "San Francisco" })),
        }),
      }),
    );
    expect(res.status).toBe(200);
    const { pageResultId } = (await res.json()) as { pageResultId: string };
    const stored = await getPageResultStore().get(pageResultId, "dev");
    expect(stored).not.toBeNull();
    const view = buildWhyView(stored!);
    expect(view.hostname).toBe("www.yelp.com");
    expect(view.items.map((i) => i.name).sort()).toEqual([...names].sort());
    expect(await getPageResultStore().get(pageResultId, "someone-else")).toBeNull();
  });
});

describe("GET /api/me", () => {
  it("reports the dev session locally without exposing tokens", async () => {
    const { GET } = await import("@/app/api/me/route");
    const body = await (await GET()).json();
    expect(body).toEqual({ signedIn: true, email: "dev@localhost" });
  });

  it("reports signed out when no session is available", async () => {
    process.env.FOCAL_DEV_SESSION = "0";
    try {
      const { GET } = await import("@/app/api/me/route");
      expect(await (await GET()).json()).toEqual({ signedIn: false });
    } finally {
      process.env.FOCAL_DEV_SESSION = "1";
    }
  });
});
