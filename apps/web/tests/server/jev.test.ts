import { describe, expect, it, vi } from "vitest";
import { buildJevRequest, createJevIdentifier, JevError, parseJevAnswers } from "@/lib/server/jev/client";
import { selectIdentified } from "@/lib/server/page/identify";
import type { IdentifyBody } from "@/lib/server/page/schemas";

const body: IdentifyBody = {
  host: "yelp.com",
  pathPattern: "/search",
  signature: "DIV.card",
  cityHints: ["San Francisco, CA", "ramen"],
  cards: [
    { clientId: "c0", snippets: ["Sponsored", "Rintaro", "Izakaya · $$"], links: [{ host: "resy.com", path: "/x" }] },
    { clientId: "c1", snippets: ["Zuni Café", "Californian"], links: [] },
    { clientId: "c2", snippets: ["Sign up for deals"], links: [] },
  ],
};

const answers = {
  answers: {
    is_list: { noul: 0.97 },
    c0_name: { choice: "s1", confidence: 0.99 },
    c0_type: { choice: "place", confidence: 0.98 },
    c0_city: { choice: "h0", confidence: 0.9 },
    c1_name: { choice: "s0", confidence: 0.95 },
    c1_type: { choice: "place", confidence: 0.7 },
    c1_city: { choice: "unknown", confidence: 0.6 },
    c2_name: { choice: "none", confidence: 0.9 },
    c2_type: { choice: "not_a_thing", confidence: 0.95 },
  },
  usage: { input_tokens: 1500 },
};

describe("Jev request", () => {
  it("asks per-card name / type / brand / city choices plus is_list, without links", () => {
    const req = buildJevRequest(body, "jev-latest");
    const q = req.questions as Record<string, { type: string; criteria: Record<string, string> | null }>;
    expect(Object.keys(q)).toEqual([
      "is_list",
      ...[0, 1, 2].flatMap((i) => [`c${i}_name`, `c${i}_type`, `c${i}_brand`, `c${i}_city`]),
    ]);
    expect(q.is_list!.type).toBe("noul");
    expect(q.c0_name!.criteria).toMatchObject({ s0: "Sponsored", s1: "Rintaro", none: expect.any(String) });
    expect(Object.keys(q.c0_type!.criteria!)).toContain("video_game");
    expect(Object.keys(q.c0_type!.criteria!)).toContain("product");
    expect(q.c0_brand!.criteria).toMatchObject({ s1: "Rintaro", none: expect.any(String) });
    expect(q.c0_city!.criteria).toMatchObject({ unknown: expect.any(String), h0: "San Francisco, CA", h1: "ramen" });
    expect(JSON.stringify(req)).not.toContain("resy.com");
  });

  it("skips city questions when the page has no hints", () => {
    const req = buildJevRequest({ ...body, cityHints: [] }, "jev-latest");
    expect(Object.keys(req.questions as object).some((k) => k.endsWith("_city"))).toBe(false);
  });
});

describe("Jev answers", () => {
  it("maps choices back to snippets, types and hints, confidence = min(name, type)", () => {
    const page = parseJevAnswers(body, answers);
    expect(page.isList).toBe(true);
    expect(page.cards).toEqual([
      { clientId: "c0", name: "Rintaro", type: "place", city: "San Francisco, CA", confidence: 0.98 },
      { clientId: "c1", name: "Zuni Café", type: "place", city: null, confidence: 0.7 },
      { clientId: "c2", name: null, type: null, city: null, confidence: 0.9 },
    ]);
    expect(selectIdentified(page).items).toEqual([{ clientId: "c0", name: "Rintaro", type: "place", city: "San Francisco, CA" }]);
  });

  it("only keeps a city for places and destinations", () => {
    const page = parseJevAnswers(
      { ...body, cards: [body.cards[1]!] },
      { answers: { is_list: { noul: 0.9 }, c0_name: { choice: "s0", confidence: 1 }, c0_type: { choice: "movie", confidence: 1 }, c0_city: { choice: "h0", confidence: 0.9 } } },
    );
    expect(page.cards[0]!.city).toBeNull();
  });

  it("maps video_game to videogame and treats a low is_list as no list", () => {
    const page = parseJevAnswers(
      { ...body, cards: [body.cards[1]!] },
      { answers: { is_list: { noul: 0.2 }, c0_name: { choice: "s0", confidence: 1 }, c0_type: { choice: "video_game", confidence: 1 } } },
    );
    expect(page.cards[0]!.type).toBe("videogame");
    expect(page.isList).toBe(false);
    expect(selectIdentified(page)).toEqual({ isList: false, pageType: null, items: [] });
  });
});

describe("createJevIdentifier", () => {
  it("POSTs to /v1/systemone with the bearer key", async () => {
    const fetchImpl = vi.fn(async () => Response.json(answers));
    const jev = createJevIdentifier({ apiKey: "k-test", fetchImpl: fetchImpl as unknown as typeof fetch });
    const page = await jev.identify(body);
    expect(page.cards[0]!.name).toBe("Rintaro");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k-test");
    expect(JSON.parse(init.body as string).model).toBe("jev-latest");
  });

  it("throws JevError on HTTP errors and malformed bodies", async () => {
    const bad = createJevIdentifier({ apiKey: "k", fetchImpl: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch });
    await expect(bad.identify(body)).rejects.toBeInstanceOf(JevError);
    const empty = createJevIdentifier({ apiKey: "k", fetchImpl: (async () => Response.json({})) as unknown as typeof fetch });
    await expect(empty.identify(body)).rejects.toThrow("no answers");
  });
});
