import { describe, expect, it } from "vitest";
import { runProductRank, validatePlan, type DescribedProduct, type TasteTag } from "../src/index";
import { profileOf, rule, thing, vibe } from "./helpers-v2";

const TASTE: TasteTag[] = [
  { id: "urn:tag:keyword:minimalism", name: "Minimalism", affinity: 0.88 },
  { id: "urn:tag:genre:music:punk", name: "Punk", affinity: 0.71 },
  { id: "urn:tag:keyword:casual", name: "Casual", affinity: 0.4 },
];

const GRID: DescribedProduct[] = [
  { clientId: "c0", name: "Dry-EX Polo Shirt", originalIndex: 0, descriptor: { style: "athletic", formality: "casual" } },
  { clientId: "c1", name: "Pleated Wide Leg Pants", originalIndex: 1, descriptor: { style: "tailored", formality: "smart-casual" } },
  { clientId: "c2", name: "Supima Crew Neck T-Shirt", originalIndex: 2, descriptor: { style: "minimal", formality: "casual" } },
  { clientId: "c3", name: "Linen Blend Shirt", originalIndex: 3, descriptor: { style: "classic", formality: "smart-casual" } },
  { clientId: "c4", name: "Selvedge Denim Jacket", originalIndex: 4, descriptor: { style: "workwear", formality: "casual" } },
];

const profile = profileOf(thing("FUGAZI", { name: "Fugazi", type: "urn:entity:artist", strength: "love" }));

describe("runProductRank", () => {
  it("lifts the products whose facets match the taste vocabulary", () => {
    const result = runProductRank({ pageId: "p1", items: GRID, tasteTags: TASTE, profile });

    expect(result.status).toBe("ranked");
    expect(result.plan).not.toBeNull();
    expect(validatePlan(result.plan!)).toEqual({ ok: true });
    expect(result.meta.insightsCalls).toBe(0);

    // c2 (minimal 0.88 + casual 0.4) beats c4 (punk 0.71 + casual 0.4).
    const reorder = result.plan!.ops.find((o) => o.op === "reorder");
    expect(reorder).toMatchObject({ order: ["c2", "c4", "c0", "c1", "c3"] });
  });

  it("names the facets the score came from, not an entity", () => {
    const result = runProductRank({ pageId: "p1", items: GRID, tasteTags: TASTE, profile });
    const annotate = result.plan!.ops.find((o) => o.op === "annotate" && o.clientId === "c2");
    expect(annotate).toMatchObject({ text: "Top pick for you · your taste leans minimal and casual" });
  });

  it("folds products a hard rule tags, with no product-specific machinery", () => {
    const withRule = profileOf(
      thing("FUGAZI", { name: "Fugazi", type: "urn:entity:artist", strength: "love" }),
      rule("urn:tag:keyword:casual", { name: "casual" }),
    );
    const result = runProductRank({ pageId: "p1", items: GRID, tasteTags: TASTE, profile: withRule });

    const collapse = result.plan!.ops.find((o) => o.op === "collapse");
    // Every product whose formality matched the "casual" taste tag is folded.
    expect(collapse).toMatchObject({ clientIds: ["c0", "c2", "c4"] });
    expect(result.items.filter((i) => i.outcome === "folded")).toHaveLength(3);
  });

  it("suppresses products carrying a disliked vibe", () => {
    const withDislike = profileOf(
      thing("FUGAZI", { name: "Fugazi", type: "urn:entity:artist", strength: "love" }),
      vibe("urn:tag:keyword:minimalism", { name: "minimalism", strength: "dislike" }),
    );
    const result = runProductRank({ pageId: "p1", items: GRID, tasteTags: TASTE, profile: withDislike });

    expect(result.items.find((i) => i.clientId === "c2")?.outcome).toBe("disliked");
    expect(result.plan!.ops.find((o) => o.op === "reorder")).not.toMatchObject({ order: ["c2"] });
  });

  it("makes no claim when the taste and product vocabularies do not overlap", () => {
    const unrelated: TasteTag[] = [{ id: "urn:tag:genre:media:anime", name: "Anime", affinity: 0.9 }];
    const result = runProductRank({ pageId: "p1", items: GRID, tasteTags: unrelated, profile });

    expect(result.status).toBe("nothing_scored");
    expect(result.plan).toBeNull();
    expect(result.items.every((i) => i.outcome === "unscored")).toBe(true);
  });

  it("returns no_signals for a profile with nothing liked and no rules", () => {
    const result = runProductRank({ pageId: "p1", items: GRID, tasteTags: TASTE, profile: profileOf() });
    expect(result.status).toBe("no_signals");
    expect(result.plan).toBeNull();
  });

  it("keeps the page order when every product scores the same", () => {
    const flat: DescribedProduct[] = GRID.map((p) => ({ ...p, descriptor: { style: "minimal" } }));
    const result = runProductRank({ pageId: "p1", items: flat, tasteTags: TASTE, profile });
    // No spread means no z-score, so nothing is lifted and nothing is planned.
    expect(result.plan).toBeNull();
    expect(result.items.map((i) => i.clientId)).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  });
});
