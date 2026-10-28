import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { __setDbForTests } from "@/lib/server/db";
import { __setIdentifierForTests } from "@/lib/server/page/identify";
import { __setPageResultStoreForTests, createMemoryPageResultStore } from "@/lib/server/page/store";
import { __resetRateLimitForTests } from "@/lib/server/rateLimit";

process.env.QLOO_MOCK = "1";
process.env.FOCAL_DEV_SESSION = "1";

type Post = (req: Request) => Promise<Response>;
let identifyPOST: Post;
let rankPOST: Post;
let resultGET: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

beforeAll(async () => {
  __setDbForTests(null);
  identifyPOST = (await import("@/app/api/page/identify/route")).POST;
  rankPOST = (await import("@/app/api/page/rank/route")).POST;
  resultGET = (await import("@/app/api/page/result/[id]/route")).GET;
});

beforeEach(() => {
  __resetRateLimitForTests();
  __setPageResultStoreForTests(createMemoryPageResultStore());
});
afterEach(() => __setIdentifierForTests(undefined));

const req = (url: string, body?: unknown, token: string | null = "dev-token") =>
  new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const SF = ["Rintaro", "State Bird Provisions", "Zuni Café", "House of Prime Rib", "Che Fico"];
const identifyBody = (host: string) => ({
  host,
  pathPattern: "/search",
  signature: "DIV.card",
  cityHints: ["San Francisco"],
  cards: [...SF, "Absolutely Not A Real Venue"].map((name, i) => ({
    clientId: `c${i}`,
    snippets: [name, "Restaurant · $$"],
    links: [],
  })),
});

describe("auth", () => {
  it("rejects requests without a session", async () => {
    expect((await identifyPOST(req("/api/page/identify", identifyBody("yelp.com"), null))).status).toBe(401);
    expect((await rankPOST(req("/api/page/rank", { host: "yelp.com", pathPattern: "/", pageType: "place", items: [] }, null))).status).toBe(401);
  });

  it("dev sessions are off in production", async () => {
    const env = process.env as Record<string, string | undefined>;
    const prev = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      expect((await identifyPOST(req("/api/page/identify", identifyBody("yelp.com")))).status).toBe(401);
    } finally {
      env.NODE_ENV = prev;
    }
  });
});

describe("POST /api/page/identify", () => {
  it("names, types and places the cards of a known list site", async () => {
    const res = await identifyPOST(req("/api/page/identify", identifyBody("yelp.com")));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isList).toBe(true);
    expect(body.pageType).toBe("place");
    expect(body.items[0]).toEqual({ clientId: "c0", name: "Rintaro", type: "place", city: "San Francisco" });
    expect(body.items).toHaveLength(6);
  });

  it("returns nothing for unknown sites (zero confidence)", async () => {
    const body = await (await identifyPOST(req("/api/page/identify", identifyBody("example.com")))).json();
    expect(body).toEqual({ isList: false, pageType: null, items: [] });
  });

  it("drops low-confidence cards and uses the majority type", async () => {
    __setIdentifierForTests({
      identify: async () => ({
        isList: true,
        cards: [
          { clientId: "c0", name: "Dune", type: "book", city: null, confidence: 0.95 },
          { clientId: "c1", name: "Piranesi", type: "book", city: null, confidence: 0.85 },
          { clientId: "c2", name: "Maybe", type: "book", city: null, confidence: 0.5 },
          { clientId: "c3", name: "Dune", type: "movie", city: null, confidence: 0.9 },
        ],
      }),
    });
    const body = await (await identifyPOST(req("/api/page/identify", identifyBody("example.com")))).json();
    expect(body.pageType).toBe("book");
    expect(body.items.map((i: { clientId: string }) => i.clientId)).toEqual(["c0", "c1", "c3"]);
  });

  it("validates the body: snippets are capped at 80 characters", async () => {
    const bad = identifyBody("yelp.com");
    bad.cards[0]!.snippets = ["x".repeat(81)];
    expect((await identifyPOST(req("/api/page/identify", bad))).status).toBe(400);
  });
});

describe("POST /api/page/rank → GET /api/page/result/:id", () => {
  it("lifts the clear match with a grounded label and stores the result", async () => {
    const identified = await (await identifyPOST(req("/api/page/identify", identifyBody("yelp.com")))).json();
    const res = await rankPOST(req("/api/page/rank", { host: "yelp.com", pathPattern: "/search", pageType: identified.pageType, items: identified.items }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ranked");
    expect(typeof body.pageResultId).toBe("string");
    expect(body.resolutionLimited).toBe(false); // request-scoped flag, always present
    expect(body.resolvedCount).toBeGreaterThan(0); // Rintaro & co. resolve under mock Qloo
    const reorder = body.plan.ops.find((o: { op: string }) => o.op === "reorder");
    expect(reorder.order[0]).toBe("c0");
    // c0 is Rintaro, which the dev profile already likes, so it is labelled as
    // a favourite rather than given a circular "because you like Rintaro".
    const label = body.plan.ops.find((o: { op: string; clientId?: string }) => o.op === "annotate" && o.clientId === "c0");
    expect(label.badge).toBe("favourite");
    expect(label.text).toBe("You like this");
    // Anything else that lifts is scored, and carries a grounded reason.
    const scored = body.plan.ops.filter(
      (o: { op: string; badge?: string }) => o.op === "annotate" && o.badge !== "favourite",
    );
    for (const op of scored) expect(op.text).toMatch(/^(Top pick for you|Good match)/);
    expect(JSON.stringify(body.plan)).not.toMatch(/0\.93/);

    const stored = await resultGET(req(`/api/page/result/${body.pageResultId}`), { params: Promise.resolve({ id: body.pageResultId }) });
    expect(stored.status).toBe(200);
    const row = await stored.json();
    expect(row.hostname).toBe("yelp.com");
    const rintaro = row.items.find((i: { clientId: string }) => i.clientId === "c0");
    expect(rintaro.affinity).toBeCloseTo(0.93);
    expect(row.meta.insightsCalls).toBe(1);
  });

  it("unknown page result ids are 404", async () => {
    const res = await resultGET(req("/api/page/result/nope"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("rejects types outside Qloo's insight types", async () => {
    const res = await rankPOST(req("/api/page/rank", { host: "x.com", pathPattern: "/", pageType: "album", items: [{ clientId: "c0", name: "Repeater", type: "album" }] }));
    expect(res.status).toBe(400);
  });
});
