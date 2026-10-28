import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearnedLayout } from "../src/api";
import { applyLayout } from "../src/layouts/apply";
import { LAYOUT_TTL_MS, deleteLayout, getLayout, layoutKey, saveLayout } from "../src/layouts/store";

const LAYOUT: LearnedLayout = { fingerprint: "DIV.card", namePosition: { snippetIndex: 0 }, type: "place", citySource: null };
const KEY = layoutKey("yelp.com", "/search", "DIV.card");

/** chrome.storage.local over a map, copying values in and out like the real one. */
function stubStorage(): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => structuredClone({ [key]: data[key] }),
        set: async (items: Record<string, unknown>) => void Object.assign(data, structuredClone(items)),
      },
    },
  });
  return data;
}

let data: Record<string, unknown>;
beforeEach(() => {
  data = stubStorage();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("layout store", () => {
  it("keys a layout by host, path pattern and list signature", async () => {
    expect(KEY).toBe("yelp.com|/search|DIV.card");
    await saveLayout(KEY, LAYOUT);
    expect(await getLayout(KEY)).toMatchObject(LAYOUT);
    expect(await getLayout(layoutKey("resy.com", "/search", "DIV.card"))).toBeNull();
    expect(await getLayout(layoutKey("yelp.com", "/biz/:id", "DIV.card"))).toBeNull();
    expect(await getLayout(layoutKey("yelp.com", "/search", "LI.result"))).toBeNull();
  });

  it("expires a layout 14 days after it was learned", async () => {
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    await saveLayout(KEY, LAYOUT);
    vi.setSystemTime(Date.now() + LAYOUT_TTL_MS - 60_000);
    expect(await getLayout(KEY)).toMatchObject(LAYOUT);
    vi.setSystemTime(Date.now() + 120_000);
    expect(await getLayout(KEY)).toBeNull();
  });

  it("saving drops expired layouts and keeps the newest 200", async () => {
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    await saveLayout("expired", LAYOUT);
    vi.setSystemTime(Date.now() + LAYOUT_TTL_MS);
    for (let i = 0; i <= 200; i++) {
      vi.setSystemTime(Date.now() + 1000);
      await saveLayout(`k${i}`, LAYOUT);
    }
    const keys = Object.keys(data.layouts as Record<string, unknown>);
    expect(keys).toHaveLength(200);
    expect(keys).not.toContain("expired");
    expect(keys).not.toContain("k0");
    expect(keys).toContain("k200");
  });

  it("deletes one layout and keeps the rest", async () => {
    await saveLayout(KEY, LAYOUT);
    await saveLayout("other", LAYOUT);
    await deleteLayout(KEY);
    expect(await getLayout(KEY)).toBeNull();
    expect(await getLayout("other")).toMatchObject(LAYOUT);
  });
});

const cards = (rows: string[][]) => rows.map((snippets, i) => ({ clientId: `c${i}`, snippets, links: [] }));
const RAMEN = cards([["Rintaro", "Japanese · $$"], ["Ippudo", "Ramen · $$"], ["Chuko", "Ramen · $"], ["Okonomi", "Japanese · $$$"]]);

describe("applyLayout", () => {
  it("names each card from the learned snippet, with the page type and the hinted city only", () => {
    const layout = { ...LAYOUT, citySource: { hintIndex: 1 } };
    expect(applyLayout(layout, RAMEN, ["ramen", "Brooklyn, NY"])).toEqual({
      isList: true,
      pageType: "place",
      items: ["Rintaro", "Ippudo", "Chuko", "Okonomi"].map((name, i) => ({ clientId: `c${i}`, name, type: "place", city: "Brooklyn, NY" })),
    });
  });

  it("leaves the city out with no city source or no hint at that index", () => {
    expect(applyLayout(LAYOUT, RAMEN, ["Brooklyn, NY"])!.items[0]).toEqual({ clientId: "c0", name: "Rintaro", type: "place" });
    expect(applyLayout({ ...LAYOUT, citySource: { hintIndex: 2 } }, RAMEN, ["Brooklyn, NY"])!.items[0]).not.toHaveProperty("city");
  });

  it("skips cards with no snippet there, and gives up below 3 names", () => {
    const layout = { ...LAYOUT, namePosition: { snippetIndex: 1 } };
    const mixed = cards([["Rintaro", "Japanese"], ["Ippudo"], ["Chuko", "Ramen"], ["Okonomi", "Japanese"]]);
    expect(applyLayout(layout, mixed, [])!.items.map((i) => i.clientId)).toEqual(["c0", "c2", "c3"]);
    expect(applyLayout(layout, mixed.slice(0, 3), [])).toBeNull();
  });
});
