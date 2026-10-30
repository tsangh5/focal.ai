// @vitest-environment-options {"url": "https://www.yelp.com/search?find_loc=Brooklyn%2C+NY"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundReply, ContentMessage, IdentifyResponse, LearnedLayout, RankRequest, RankResponse } from "../src/api";
import { layoutKey } from "../src/layouts/store";
import type { RenderPlan } from "../src/types";
import { RESTAURANT_GRID } from "./fixtures";

const KEY = layoutKey("yelp.com", "/search", "DIV.card");
const LAYOUT: LearnedLayout = { fingerprint: "DIV.card", namePosition: { snippetIndex: 0 }, type: "place", citySource: { hintIndex: 0 } };
const NAMES = ["Rintaro", "Ippudo", "Chuko", "Okonomi"];

/**
 * chrome.* for the content script. Storage copies values like the real one;
 * identify answers like the server (first snippet, a learned layout) and rank
 * answers with `rank`.
 */
function stubChrome(rank: Partial<RankResponse>, stored?: LearnedLayout) {
  // Ranking is opt-in per site, so these tests start from a host the user has
  // already enabled; the offer path is covered separately.
  const data: Record<string, unknown> = {
    settings: { siteOn: [location.hostname.replace(/^www\./, "")] },
    ...(stored ? { layouts: { [KEY]: { ...stored, savedAt: new Date().toISOString() } } } : {}),
  };
  const sent: ContentMessage[] = [];
  vi.stubGlobal("chrome", {
    extension: { inIncognitoContext: false },
    storage: {
      local: {
        get: async (key: string) => structuredClone({ [key]: data[key] }),
        set: async (items: Record<string, unknown>) => void Object.assign(data, structuredClone(items)),
      },
    },
    runtime: {
      sendMessage: async (msg: ContentMessage): Promise<BackgroundReply<unknown>> => {
        sent.push(msg);
        if (msg.type === "identify") {
          const items = msg.body.cards.map((c) => ({ clientId: c.clientId, name: c.snippets[0]!, type: "place" as const }));
          return { ok: true, data: { isList: true, pageType: "place", items, layout: LAYOUT } satisfies IdentifyResponse };
        }
        if (msg.type === "rank") return { ok: true, data: { pageResultId: null, status: "ranked", plan: null, ...rank } };
        return { ok: true, data: {} };
      },
    },
  });
  return { data, sent };
}

/** A fresh page load: the content script runs once and settles. */
async function visit(): Promise<void> {
  document.body.innerHTML = RESTAURANT_GRID;
  vi.resetModules();
  await import("../src/content");
  await vi.advanceTimersByTimeAsync(0);
}

const storedLayout = (data: Record<string, unknown>) => (data.layouts as Record<string, unknown> | undefined)?.[KEY];
const ranks = (sent: ContentMessage[]) => sent.flatMap((m): RankRequest[] => (m.type === "rank" ? [m.body] : []));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("content script with learned layouts", () => {
  it("makes no identify call on a second run on the same layout, and ranks with names, type and city only", async () => {
    const { data, sent } = stubChrome({ resolvedCount: 4, resolutionLimited: false });
    await visit();
    expect(sent.map((m) => m.type)).toEqual(["identify", "rank"]);
    expect(storedLayout(data)).toMatchObject(LAYOUT);

    sent.length = 0;
    await visit();
    expect(sent.map((m) => m.type)).toEqual(["rank"]);
    expect(ranks(sent)[0]).toEqual({
      host: "yelp.com",
      pathPattern: "/search",
      pageType: "place",
      items: NAMES.map((name, i) => ({ clientId: `c${i}`, name, type: "place", city: "Brooklyn, NY" })),
    });
  });

  it("deletes the stored layout when its rank resolves nothing", async () => {
    const { data, sent } = stubChrome({ status: "nothing_scored", resolvedCount: 0, resolutionLimited: false }, LAYOUT);
    await visit();
    expect(sent.map((m) => m.type)).toEqual(["rank"]);
    expect(storedLayout(data)).toBeUndefined();
  });

  it.each<[string, Partial<RankResponse>]>([
    ["the lookup budget skipped items", { status: "nothing_scored", resolvedCount: 0, resolutionLimited: true }],
    ["resolution never ran (no_signals)", { status: "no_signals", resolvedCount: 0, resolutionLimited: false }],
    ["the server doesn't report resolvedCount", { status: "nothing_scored" }],
    ["something resolved", { status: "ranked", resolvedCount: 2, resolutionLimited: false }],
  ])("keeps the stored layout when %s", async (_, rank) => {
    const { data, sent } = stubChrome(rank, LAYOUT);
    await visit();
    expect(sent.map((m) => m.type)).toEqual(["rank"]);
    expect(storedLayout(data)).toMatchObject(LAYOUT);
  });

  it("tops up infinite scroll from the stored layout too", async () => {
    const plan: RenderPlan = {
      id: "p1",
      pageId: "r1",
      createdAt: "2026-10-28T00:00:00Z",
      ops: [
        { op: "reorder", containerId: "focal:results", order: ["c2", "c0", "c1", "c3"] },
        { op: "annotate", containerId: "focal:results", clientId: "c2", text: "Top pick for you", badge: "top-pick" },
      ],
      summary: { moved: 1, collapsed: 0, unresolved: 0, avgMovement: 0, lifted: 1 },
    };
    const { sent } = stubChrome({ pageResultId: "r1", status: "ranked", plan, resolvedCount: 4, resolutionLimited: false }, LAYOUT);
    await visit();
    expect(document.querySelector('[data-focal="label"]')).not.toBeNull();

    document.querySelector(".results")!.insertAdjacentHTML(
      "beforeend",
      '<div class="card card-1005"><a href="/biz/nakamura"><h3>Nakamura</h3></a><p>Ramen · $$</p><span>172 Delancey St</span><button>Save</button></div>',
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.some((m) => m.type === "identify")).toBe(false);
    expect(ranks(sent).map((r) => r.items.map((i) => i.name))).toEqual([NAMES, [...NAMES, "Nakamura"]]);
  });
});
