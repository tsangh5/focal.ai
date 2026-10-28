import { describe, expect, it } from "vitest";
import { describeFromName, facetCriteria, scoreProduct, scoreProducts, type TasteTag } from "../src/index";

/** A punk-and-workwear leaning taste set, as `tagAffinities` would return it. */
const TASTE: TasteTag[] = [
  { id: "urn:tag:genre:music:punk", name: "Punk", affinity: 0.92 },
  { id: "urn:tag:keyword:minimalism", name: "Minimalism", affinity: 0.81 },
  { id: "urn:tag:keyword:casual", name: "Casual", affinity: 0.64 },
  { id: "urn:tag:genre:music:classical", name: "Classical", affinity: 0.12 },
  { id: "urn:tag:keyword:unscored", name: "Streetwear" },
];

describe("scoreProduct", () => {
  it("sums one affinity per facet and credits the matched tags", () => {
    const result = scoreProduct({ style: "minimal", formality: "casual" }, TASTE);
    expect(result.score).toBeCloseTo(0.81 + 0.64, 5);
    expect(result.matches.map((m) => m.facet)).toEqual(["style", "formality"]);
    expect(result.tagIds).toEqual(["urn:tag:keyword:minimalism", "urn:tag:keyword:casual"]);
  });

  it("matches a facet to its strongest synonym, not the first one found", () => {
    // "workwear" lists both punk (0.92) and americana (absent); punk wins.
    const result = scoreProduct({ style: "workwear" }, TASTE);
    expect(result.matches[0]?.tagName).toBe("Punk");
    expect(result.score).toBeCloseTo(0.92, 5);
  });

  it("counts a facet once however many synonyms the tag name hits", () => {
    const verbose: TasteTag[] = [{ id: "t", name: "Minimal minimalist minimalism", affinity: 0.5 }];
    expect(scoreProduct({ style: "minimal" }, verbose).score).toBeCloseTo(0.5, 5);
  });

  it("scores an unmatched product 0 so it still counts toward the page mean", () => {
    const result = scoreProduct({ style: "athletic", palette: "bright" }, TASTE);
    expect(result.score).toBe(0);
    expect(result.matches).toEqual([]);
    expect(result.tagIds).toEqual([]);
  });

  it("skips tags Qloo returned with no affinity", () => {
    // An unscored match must not read as a zero-strength one.
    const unscored: TasteTag[] = [{ id: "urn:tag:keyword:streetwear", name: "Streetwear" }];
    expect(scoreProduct({ style: "street" }, unscored).matches).toEqual([]);
    expect(scoreProduct({ style: "street" }, unscored).score).toBe(0);
  });

  it("ignores unknown facet values and unknown facets", () => {
    expect(scoreProduct({ style: "not-a-style" }, TASTE).score).toBe(0);
    expect(scoreProduct({}, TASTE).score).toBe(0);
  });

  it("matches whole words only", () => {
    const tags: TasteTag[] = [{ id: "t", name: "Smart Home", affinity: 0.9 }];
    // "art" must not match inside "Smart"; nothing in the vocabulary should hit.
    expect(scoreProduct({ style: "minimal", palette: "neutral", formality: "casual" }, tags).matches).toEqual([]);
  });

  it("matches a prefix so a stem reaches its -ism form", () => {
    const tags: TasteTag[] = [{ id: "t", name: "Minimalism", affinity: 0.7 }];
    expect(scoreProduct({ style: "minimal" }, tags).matches[0]?.tagId).toBe("t");
  });

  // The failure class the table exists to avoid: a tag from an unrelated
  // domain reaching a facet through a word that means something else there,
  // which manufactures a taste signal out of nothing.
  it.each([
    ["Natural Wine", { palette: "earth" }],
    ["Organic", { palette: "earth" }],
    ["Japanese", { style: "minimal" }],
    ["Science Fiction", { style: "utility" }],
    ["Thai", { palette: "bright" }],
  ])("does not read %s as a style signal", (tagName, descriptor) => {
    const tags: TasteTag[] = [{ id: "t", name: tagName, affinity: 0.9 }];
    expect(scoreProduct(descriptor, tags).matches).toEqual([]);
  });
});

describe("scoreProducts", () => {
  it("spreads scores across a grid so the lift step has something to rank on", () => {
    const products = [
      { clientId: "c0", name: "Dry-EX Short Sleeve Polo Shirt", originalIndex: 0, descriptor: { style: "athletic" } },
      { clientId: "c1", name: "Supima Cotton Crew Neck T-Shirt", originalIndex: 1, descriptor: { style: "minimal", formality: "casual" } },
      { clientId: "c2", name: "Selvedge Denim Work Shirt", originalIndex: 2, descriptor: { style: "workwear", formality: "casual" } },
    ];
    const scores = scoreProducts(products, TASTE);
    expect(scores.map((s) => s.clientId)).toEqual(["c0", "c1", "c2"]);
    expect(scores[0]!.score).toBe(0);
    expect(scores[2]!.score).toBeGreaterThan(scores[1]!.score);
  });
});

describe("describeFromName", () => {
  it("reads facets out of descriptive apparel titles", () => {
    expect(describeFromName("Pleated Wide Leg Pants")).toMatchObject({ style: "tailored" });
    expect(describeFromName("Dry-EX Short Sleeve Polo Shirt")).toMatchObject({ style: "athletic" });
    expect(describeFromName("Selvedge Denim Jacket")).toMatchObject({ style: "workwear" });
    expect(describeFromName("Fleece Full-Zip Jacket")).toMatchObject({ style: "outdoor" });
  });

  it("leaves facets it cannot see unset rather than guessing", () => {
    expect(describeFromName("Item 4028")).toEqual({});
  });
});

describe("facetCriteria", () => {
  it("offers every facet value plus an explicit unknown", () => {
    const criteria = facetCriteria("formality");
    expect(Object.keys(criteria)).toContain("smart-casual");
    expect(Object.keys(criteria)).toContain("unknown");
  });
});
