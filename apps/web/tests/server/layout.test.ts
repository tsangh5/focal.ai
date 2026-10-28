import { describe, expect, it } from "vitest";
import type { CardAnswer } from "@/lib/server/page/identify";
import { deriveLayout } from "@/lib/server/page/layout";
import type { IdentifyBody } from "@/lib/server/page/schemas";

const NAMES = ["Rintaro", "Zuni Café", "Che Fico", "State Bird Provisions", "Nopa"];

const body: IdentifyBody = {
  host: "yelp.com",
  pathPattern: "/search",
  signature: "DIV.card",
  cityHints: ["San Francisco", "ramen"],
  cards: NAMES.map((name, i) => ({ clientId: `c${i}`, snippets: ["Sponsored", name, "Restaurant · $$"], links: [] })),
};

const card = (i: number, over: Partial<CardAnswer> = {}): CardAnswer => ({
  clientId: `c${i}`,
  name: NAMES[i]!,
  type: "place",
  city: "San Francisco",
  confidence: 0.9,
  ...over,
});

const answer = (cards: CardAnswer[]) => ({ isList: true, cards });
const all = (over: (i: number) => Partial<CardAnswer> = () => ({})) => NAMES.map((_, i) => card(i, over(i)));

describe("deriveLayout", () => {
  it("learns the name position, type and city hint when the confident cards agree", () => {
    expect(deriveLayout(body, answer(all()))).toEqual({
      fingerprint: "DIV.card",
      namePosition: { snippetIndex: 1 },
      type: "place",
      citySource: { hintIndex: 0 },
    });
  });

  it("needs 3 confident cards and ignores unsure ones", () => {
    expect(deriveLayout(body, answer(all((i) => (i >= 2 ? { confidence: 0.5 } : {}))))).toBeNull();
    expect(deriveLayout(body, answer(all((i) => (i >= 3 ? { confidence: 0.5 } : {}))))?.namePosition).toEqual({ snippetIndex: 1 });
  });

  it("learns nothing when confident cards disagree on type, or the page isn't a list", () => {
    expect(deriveLayout(body, answer(all((i) => (i === 4 ? { type: "movie" } : {}))))).toBeNull();
    expect(deriveLayout(body, { isList: false, cards: all() })).toBeNull();
  });

  it("needs 80% of the names at one snippet position", () => {
    expect(deriveLayout(body, answer(all((i) => (i >= 3 ? { name: "Restaurant · $$" } : {}))))).toBeNull();
    expect(deriveLayout(body, answer(all((i) => (i === 4 ? { name: "Restaurant · $$" } : {}))))?.namePosition).toEqual({ snippetIndex: 1 });
  });

  it("keeps a city source only when every confident card names the same hint, and only for places", () => {
    expect(deriveLayout(body, answer(all((i) => (i === 4 ? { city: "ramen" } : {}))))?.citySource).toBeNull();
    expect(deriveLayout(body, answer(all((i) => (i === 0 ? { city: null } : {}))))?.citySource).toBeNull();
    expect(deriveLayout(body, answer(all(() => ({ type: "book" }))))?.citySource).toBeNull();
  });
});
