import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildDescribeRequest,
  createJevDescriber,
  parseDescribeAnswers,
} from "@/lib/server/jev/client";
import { __setDbForTests } from "@/lib/server/db";
import { __setDescriberForTests, __setIdentifierForTests } from "@/lib/server/page/identify";
import { __setPageResultStoreForTests, createMemoryPageResultStore } from "@/lib/server/page/store";
import { __resetRateLimitForTests } from "@/lib/server/rateLimit";

process.env.QLOO_MOCK = "1";
process.env.FOCAL_DEV_SESSION = "1";

const NAMES = [
  "Dry-EX Short Sleeve Polo Shirt",
  "Supima Cotton Crew Neck T-Shirt",
  "Selvedge Denim Work Shirt",
  "Pleated Wide Leg Pants",
  "Linen Blend Long Sleeve Shirt",
];

describe("Jev describe request", () => {
  it("asks one choice per facet per product and sends only names", () => {
    const req = buildDescribeRequest(["Selvedge Denim Work Shirt"], "jev-latest");
    const q = req.questions as Record<string, { type: string; criteria: Record<string, string> }>;
    expect(Object.keys(q)).toEqual(["p0_style", "p0_palette", "p0_formality"]);
    expect(q.p0_style!.type).toBe("choice");
    expect(Object.keys(q.p0_style!.criteria)).toContain("workwear");
    expect(Object.keys(q.p0_formality!.criteria)).toContain("unknown");
  });

  it("keeps a facet unset when the answer is unknown or low confidence", () => {
    const payload = {
      answers: {
        p0_style: { choice: "workwear", confidence: 0.95 },
        p0_palette: { choice: "unknown", confidence: 0.9 },
        p0_formality: { choice: "casual", confidence: 0.3 },
      },
    };
    expect(parseDescribeAnswers(["Selvedge Denim Work Shirt"], payload)).toEqual([{ style: "workwear" }]);
  });

  it("drops choices that are not in the vocabulary", () => {
    const payload = { answers: { p0_style: { choice: "cottagecore", confidence: 0.99 } } };
    expect(parseDescribeAnswers(["A Shirt"], payload)).toEqual([{}]);
  });

  it("returns a descriptor per product without calling out for an empty list", async () => {
    let calls = 0;
    const describer = createJevDescriber({
      apiKey: "k",
      fetchImpl: (async () => {
        calls += 1;
        return new Response(JSON.stringify({ answers: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(await describer.describe([])).toEqual([]);
    expect(calls).toBe(0);
    expect(await describer.describe(["A", "B"])).toEqual([{}, {}]);
    expect(calls).toBe(1);
  });
});

type Post = (req: Request) => Promise<Response>;
let rankPOST: Post;
let feedbackPOST: Post;

beforeAll(async () => {
  __setDbForTests(null);
  rankPOST = (await import("@/app/api/page/rank/route")).POST;
  feedbackPOST = (await import("@/app/api/feedback/route")).POST;
});

beforeEach(() => {
  __resetRateLimitForTests();
  __setPageResultStoreForTests(createMemoryPageResultStore());
});
afterEach(() => {
  __setIdentifierForTests(undefined);
  __setDescriberForTests(undefined);
});

const req = (url: string, body?: unknown, token: string | null = "dev-token") =>
  new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const rankBody = {
  host: "uniqlo.com",
  pathPattern: "/ca/en/men/shirts-and-polo-shirts",
  pageType: "product" as const,
  items: NAMES.map((name, i) => ({ clientId: `c${i}`, name, type: "product" as const })),
};

describe("POST /api/page/rank on a product grid", () => {
  it("ranks products without an insights call and labels the facets", async () => {
    const res = await rankPOST(req("/api/page/rank", rankBody));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; plan: { ops: { op: string; text?: string }[] } | null };

    expect(body.status).toBe("ranked");
    expect(body.plan).not.toBeNull();
    const annotate = body.plan!.ops.filter((o) => o.op === "annotate");
    expect(annotate.length).toBeGreaterThan(0);
    // Reasons name a facet, never a product or an entity.
    expect(annotate[0]!.text).toMatch(/your taste leans/);
  });

  it("makes no claim when no product matches the taste vocabulary", async () => {
    __setDescriberForTests({ describe: async (names) => names.map(() => ({})) });
    const res = await rankPOST(req("/api/page/rank", rankBody));
    const body = (await res.json()) as { status: string; plan: unknown };
    expect(body.status).toBe("nothing_scored");
    expect(body.plan).toBeNull();
  });
});

describe("POST /api/feedback on a lifted product", () => {
  it("saves the facet behind the lift as a vibe, not the product", async () => {
    const ranked = (await (await rankPOST(req("/api/page/rank", rankBody))).json()) as {
      pageResultId: string;
      plan: { ops: { op: string; clientId?: string }[] };
    };
    const lifted = ranked.plan.ops.find((o) => o.op === "annotate")?.clientId;
    expect(lifted).toBeDefined();

    const res = await feedbackPOST(
      req("/api/feedback", { pageResultId: ranked.pageResultId, clientId: lifted, verdict: "more" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: boolean; name: string; strength: string };
    expect(body).toMatchObject({ saved: true, strength: "like" });
    // The facet's display word, not the product title.
    expect(NAMES).not.toContain(body.name);
  });

  it("404s on a product that was never matched to a facet", async () => {
    const ranked = (await (await rankPOST(req("/api/page/rank", rankBody))).json()) as { pageResultId: string };
    const res = await feedbackPOST(
      req("/api/feedback", { pageResultId: ranked.pageResultId, clientId: "c99", verdict: "more" }),
    );
    expect(res.status).toBe(404);
  });
});

describe("buildWhyView on a product result", () => {
  it("explains the score by facet and carries the page type", async () => {
    const { buildWhyView } = await import("@/lib/why");
    const { getPageResultStore } = await import("@/lib/server/page/store");

    const ranked = (await (await rankPOST(req("/api/page/rank", rankBody))).json()) as { pageResultId: string };
    const stored = await getPageResultStore().get(ranked.pageResultId, "dev");
    expect(stored).not.toBeNull();
    const view = buildWhyView(stored!);

    expect(view.pageType).toBe("product");
    const scored = view.items.find((i) => i.facets.length > 0);
    expect(scored).toBeDefined();
    // Every facet names a Qloo tag and the affinity it contributed.
    for (const f of scored!.facets) {
      expect(f.tagId).toMatch(/^urn:tag:/);
      expect(f.affinity).toBeGreaterThan(0);
    }
    // The sum of the facets is exactly the item's score.
    const sum = scored!.facets.reduce((s, f) => s + f.affinity, 0);
    expect(scored!.affinity).toBeCloseTo(sum, 5);
  });
});
