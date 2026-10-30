// @vitest-environment-options {"url": "https://www.yelp.com/search?find_loc=Brooklyn%2C+NY"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundReply, ContentMessage, IdentifyResponse } from "../src/api";
import type { RenderPlan } from "../src/types";
import { RESTAURANT_GRID } from "./fixtures";

const START_URL = "https://www.yelp.com/search?find_loc=Brooklyn%2C+NY";
type Reply = BackgroundReply<unknown>;
type Handler = (msg: ContentMessage, n: number) => Reply | Promise<Reply> | undefined;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const planLifting = (id: string, extra: RenderPlan["ops"] = []): RenderPlan => ({
  id: `p-${id}`,
  pageId: "r",
  createdAt: "2026-10-28T00:00:00Z",
  ops: [
    { op: "reorder", containerId: "x", order: [id] },
    { op: "annotate", containerId: "x", clientId: id, text: `Top pick ${id}`, badge: "top-pick" },
    ...extra,
  ],
  summary: { moved: 1, collapsed: 0, unresolved: 0, avgMovement: 0, lifted: 1 },
});
const ranked = (plan: RenderPlan | null, pageResultId: string | null = "r1"): Reply => ({ ok: true, data: { pageResultId, status: "ranked", plan } });
const identifyAll = (msg: Extract<ContentMessage, { type: "identify" }>): Reply => ({
  ok: true,
  data: { isList: true, pageType: "place", items: msg.body.cards.map((c) => ({ clientId: c.clientId, name: c.snippets[0]!, type: "place" as const })) } satisfies IdentifyResponse,
});

/** chrome.* for the content script; `rank` answers the nth rank call (0-based), identify names every card. */
function stubChrome(opts: { rank?: Handler; identify?: Handler; settingsGate?: Promise<void> } = {}) {
  const sent: ContentMessage[] = [];
  const listeners: ((changes: Record<string, { newValue?: unknown }>, area: string) => void)[] = [];
  let ranks = 0;
  let identifies = 0;
  vi.stubGlobal("chrome", {
    extension: { inIncognitoContext: false },
    storage: {
      local: {
        get: async (key: string) => {
          if (key === "settings" && opts.settingsGate) await opts.settingsGate;
          // Ranking is opt-in per site; these tests exercise the run loop on a
          // host the user has already enabled. The offer path is covered in
          // guards.test.ts.
          if (key === "settings") return { settings: { siteOn: [location.hostname.replace(/^www\./, "")] } };
          return {};
        },
        set: async () => {},
      },
      onChanged: { addListener: (fn: (typeof listeners)[number]) => listeners.push(fn) },
    },
    runtime: {
      sendMessage: async (msg: ContentMessage): Promise<Reply> => {
        sent.push(msg);
        if (msg.type === "identify") return (await opts.identify?.(msg, identifies++)) ?? identifyAll(msg);
        if (msg.type === "rank") return (await opts.rank?.(msg, ranks++)) ?? ranked(null);
        return { ok: true, data: {} };
      },
    },
  });
  return { sent, fire: (changes: Record<string, { newValue?: unknown }>, area = "local") => listeners.forEach((fn) => fn(changes, area)) };
}

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

/** A fresh page load; the content script's first pass settles unless something it waits on is deferred. */
async function visit(): Promise<HTMLElement> {
  document.body.innerHTML = RESTAURANT_GRID;
  const container = document.querySelector<HTMLElement>(".results")!;
  vi.resetModules();
  await import("../src/content");
  (await import("../src/apply/apply")).__setTrustCheckForTests(() => true);
  await vi.advanceTimersByTimeAsync(0);
  return container;
}

const count = (sent: ContentMessage[], type: ContentMessage["type"]) => sent.filter((m) => m.type === type).length;
const card = (n: number) => document.querySelector<HTMLElement>(`.card-100${n}`)!;
const label = (n: number) => card(n).querySelector('[data-focal="label"]');
const chips = () => [...document.querySelectorAll('[data-focal="chip"]')];
const hides = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(([p, v]) => p === "visibility" && v === "hidden").length;
/** A non-append change the old watcher saw too: a card replaced by a new element. */
function replaceCard(n: number, name: string) {
  card(n).outerHTML = `<div class="card card-200${n}"><a href="/biz/${name}"><h3>${name}</h3></a><p>Ramen · $$</p><span>1 Main St</span><button>Save</button></div>`;
}
const rects = (top: number) =>
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top, bottom: top + 40, left: 0, right: 100, width: 100, height: 40, x: 0, y: top, toJSON: () => ({}) } as DOMRect);

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState(null, "", START_URL);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Detach every observer an earlier module instance left on the page.
  document.body.replaceWith(document.createElement("body"));
});

describe("single-flight runs", () => {
  it("two overlapping runs produce one gate, and the list's visibility ends as the site's original", async () => {
    const settings = deferred<void>();
    stubChrome({ settingsGate: settings.promise, rank: () => ranked(planLifting("c2")) });
    document.body.innerHTML = RESTAURANT_GRID;
    const container = document.querySelector<HTMLElement>(".results")!;
    const original = container.style.getPropertyValue("visibility");
    const setProperty = vi.spyOn(container.style, "setProperty");
    vi.resetModules();
    await import("../src/content");
    // A second run arrives while the first is still waiting.
    history.pushState(null, "", "/search?find_loc=Queens");
    await vi.advanceTimersByTimeAsync(2000);
    settings.resolve();
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(hides(setProperty)).toBe(1);
    expect(container.style.getPropertyValue("visibility")).toBe(original);
    expect(label(3)).not.toBeNull();
  });

  it("a thrown sendMessage cancels only that pass's gate and leaves no chip behind", async () => {
    const { sent } = stubChrome({ identify: (_m, n) => (n === 0 ? Promise.reject(new Error("Receiving end does not exist")) : undefined), rank: () => ranked(planLifting("c2")) });
    const container = await visit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(chips()).toHaveLength(0);
    expect(container.style.getPropertyValue("visibility")).toBe("");
    // The failed pass is retried, and that one lands.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(count(sent, "identify")).toBe(2);
    expect(label(3)).not.toBeNull();
  });
});

describe("rerun gate", () => {
  it("a rerun never hides the list and mounts no ranking chip", async () => {
    const second = deferred<Reply>();
    stubChrome({ rank: (_m, n) => (n === 0 ? ranked(planLifting("c2")) : second.promise) });
    const container = await visit();
    expect(label(3)).not.toBeNull();
    const setProperty = vi.spyOn(container.style, "setProperty");
    replaceCard(4, "Nakamura");
    await vi.advanceTimersByTimeAsync(1500);
    expect(hides(setProperty)).toBe(0);
    expect(chips()).toHaveLength(0);
    second.resolve(ranked(planLifting("c0")));
    await vi.advanceTimersByTimeAsync(0);
    expect(hides(setProperty)).toBe(0);
    expect(label(1)).not.toBeNull();
  });

  it("a rerun whose effect is on screen offers an Apply chip; off screen it applies directly", async () => {
    stubChrome({ rank: (_m, n) => ranked(planLifting(n === 0 ? "c2" : "c0")) });
    rects(10);
    await visit();
    expect(label(3)).not.toBeNull();
    replaceCard(4, "Nakamura");
    await vi.advanceTimersByTimeAsync(1500);
    expect(chips()).toHaveLength(1);
    expect(label(1)).toBeNull();
    document.querySelector<HTMLButtonElement>('[data-focal="apply"]')!.click();
    expect(label(1)).not.toBeNull();
    expect(label(3)).toBeNull();

    rects(5000);
    replaceCard(2, "Ganso");
    await vi.advanceTimersByTimeAsync(1500);
    expect(chips()).toHaveLength(0);
    expect(document.querySelectorAll('[data-focal="strip"]')).toHaveLength(1);
  });
});

/** A first run whose plan lands after the user clicked in the list: the Apply chip is offered. */
async function offeredChip(extra: Partial<Parameters<typeof stubChrome>[0]> = {}) {
  const first = deferred<Reply>();
  const stub = stubChrome({ rank: (m, n) => (n === 0 ? first.promise : ranked(planLifting("c0"))), ...extra });
  const container = await visit();
  await vi.advanceTimersByTimeAsync(300);
  container.dispatchEvent(new Event("click"));
  first.resolve(ranked(planLifting("c2")));
  await vi.advanceTimersByTimeAsync(0);
  expect(chips()).toHaveLength(1);
  expect(chips()[0]!.textContent).toContain("focal found matches");
  return { ...stub, container, chip: chips()[0]!, button: document.querySelector<HTMLButtonElement>('[data-focal="apply"]')! };
}

describe("Apply chip lifetime", () => {
  it("is removed on a URL change", async () => {
    await offeredChip();
    history.pushState(null, "", "/search?find_loc=Queens");
    await vi.advanceTimersByTimeAsync(1000);
    expect(chips()).toHaveLength(0);
  });

  it("is removed when the list goes away", async () => {
    const { container } = await offeredChip();
    container.remove();
    await vi.advanceTimersByTimeAsync(1000);
    expect(chips()).toHaveLength(0);
  });

  it("is removed by the next gate, so chips never stack", async () => {
    const { chip } = await offeredChip();
    replaceCard(4, "Nakamura");
    await vi.advanceTimersByTimeAsync(1500);
    expect(chip.isConnected).toBe(false);
    expect(chips().length).toBeLessThanOrEqual(1);
  });

  it("a stale chip can't apply after a newer plan", async () => {
    const { chip, button } = await offeredChip();
    replaceCard(4, "Nakamura");
    await vi.advanceTimersByTimeAsync(1500);
    expect(label(1)).not.toBeNull();
    expect(chip.isConnected).toBe(false);
    button.click();
    expect(label(3)).toBeNull();
    expect(label(1)).not.toBeNull();
  });
});

describe("retries and sign-in", () => {
  it("signed_out does not retry, and a session appearing in storage reruns", async () => {
    const { sent, fire } = stubChrome({ identify: (_m, n) => (n === 0 ? { ok: false, error: "signed_out", status: 401 } : undefined) });
    await visit();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(count(sent, "identify")).toBe(1);
    fire({ session: { newValue: undefined } });
    fire({ session: { newValue: { token: "t" } } }, "sync");
    await vi.advanceTimersByTimeAsync(1000);
    expect(count(sent, "identify")).toBe(1);
    fire({ session: { newValue: { token: "t", savedAt: "now" } } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(count(sent, "identify")).toBe(2);
    expect(count(sent, "rank")).toBe(1);
  });

  it("a transient failure retries at most 3 times", async () => {
    const { sent } = stubChrome({ identify: () => ({ ok: false, error: "http_503", status: 503 }) });
    await visit();
    await vi.advanceTimersByTimeAsync(10 * 61_000);
    expect(count(sent, "identify")).toBe(4);
  });

  it("a successful identify and rank disarms a pending retry, and a later failure gets a fresh one", async () => {
    const { sent } = stubChrome({ identify: (_m, n) => (n === 0 || n === 2 ? { ok: false, error: "http_502", status: 502 } : undefined) });
    await visit();
    const more = (n: number, name: string) =>
      document.querySelector(".results")!.insertAdjacentHTML("beforeend", `<div class="card card-100${n}"><a href="/biz/${n}"><h3>${name}</h3></a><p>Ramen</p><span>${n} St</span></div>`);
    // More cards load before the retry is due; that pass identifies and ranks.
    more(5, "Nakamura");
    await vi.advanceTimersByTimeAsync(1000);
    expect(count(sent, "rank")).toBe(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(count(sent, "identify")).toBe(2);
    expect(count(sent, "rank")).toBe(1);
    // A new failure starts a new episode, and its retry lands.
    more(6, "Ganso");
    await vi.advanceTimersByTimeAsync(1000);
    expect(count(sent, "identify")).toBe(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(count(sent, "identify")).toBe(4);
    expect(count(sent, "rank")).toBe(2);
  });
});

describe("undo stickiness", () => {
  it("a user Undo sticks across a non-append mutation", async () => {
    const { sent } = stubChrome({ rank: () => ranked(planLifting("c2")) });
    await visit();
    document.querySelector<HTMLButtonElement>('[data-focal="undo"]')!.click();
    expect(document.querySelector("[data-focal]")).toBeNull();
    replaceCard(4, "Nakamura");
    await vi.advanceTimersByTimeAsync(5000);
    expect(count(sent, "rank")).toBe(1);
    expect(document.querySelector("[data-focal]")).toBeNull();
  });

  it("a programmatic undo doesn't set it: later cards are still labelled", async () => {
    stubChrome({
      rank: (msg, n) => {
        if (n === 0) return ranked(planLifting("c2"));
        if (n === 1) return ranked(null);
        const fresh = msg.type === "rank" ? msg.body.items.at(-1)!.clientId : "";
        return ranked({ ...planLifting(fresh), ops: [{ op: "annotate", containerId: "x", clientId: fresh, text: "Good match", badge: "good-match" }] });
      },
    });
    await visit();
    replaceCard(4, "Nakamura");
    await vi.advanceTimersByTimeAsync(1500);
    expect(document.querySelector('[data-focal="strip"]')).toBeNull();
    document.querySelector(".results")!.insertAdjacentHTML("beforeend", '<div class="card card-1009"><a href="/biz/q"><h3>Ganso</h3></a><p>Ramen</p><span>2 St</span></div>');
    await vi.advanceTimersByTimeAsync(1500);
    expect(card(9).querySelector('[data-focal="label"]')).not.toBeNull();
  });
});

describe("SPA navigation", () => {
  it("a URL change resets per-page state and clears the page result", async () => {
    const { sent } = stubChrome({ rank: () => ranked(planLifting("c2")) });
    await visit();
    expect(document.querySelector('[data-focal="strip"]')).not.toBeNull();
    document.querySelector<HTMLInputElement>('input[name="find_loc"]')!.value = "Queens, NY";
    history.pushState(null, "", "/search?find_loc=Queens%2C+NY");
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.filter((m) => m.type === "page-result").at(-1)).toEqual({ type: "page-result", pageResultId: null, lifted: 0 });
    expect(document.querySelector("[data-focal]")).toBeNull();
    await vi.advanceTimersByTimeAsync(1500);
    const identifies = sent.flatMap((m) => (m.type === "identify" ? [m.body] : []));
    expect(identifies).toHaveLength(2);
    expect(identifies[1]!.cityHints[0]).toBe("Queens, NY");
    expect(label(3)).not.toBeNull();
  });
});

describe("site re-sorts", () => {
  it("a same-node re-sort reruns", async () => {
    const { sent } = stubChrome();
    const container = await visit();
    container.append(card(1));
    await vi.advanceTimersByTimeAsync(1500);
    expect(count(sent, "rank")).toBe(2);
  });

  it("recycled nodes with new contents rerun", async () => {
    const { sent } = stubChrome();
    await visit();
    card(2).querySelector("h3")!.textContent = "Nakamura";
    await vi.advanceTimersByTimeAsync(1500);
    expect(count(sent, "rank")).toBe(2);
  });
});

describe("planEffectOnScreen", () => {
  const plain = (top: number) => ({ top, bottom: top + 40, left: 0, right: 100, width: 100, height: 40, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  /** Only `visible` elements are on screen. */
  function screen(visible: Element[]) {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return plain(visible.includes(this) ? 10 : 5000);
    });
  }
  async function setup() {
    stubChrome();
    const { planEffectOnScreen } = await import("../src/content");
    const { detectList } = await import("../src/detect/detect");
    document.body.innerHTML = RESTAURANT_GRID;
    const list = detectList(document)!;
    return { planEffectOnScreen, list, el: (id: string) => list.cards.get(id)! };
  }
  const fold = (ids: string[]): RenderPlan => ({
    ...planLifting("c0"),
    ops: [{ op: "collapse", containerId: "x", clientIds: ids, label: `${ids.length} folded` }],
    summary: { moved: 0, collapsed: ids.length, unresolved: 0, avgMovement: 0, lifted: 0 },
  });

  it("a fold-only plan counts the cards it would fold away", async () => {
    const { planEffectOnScreen, list, el } = await setup();
    screen([el("c3")]);
    expect(planEffectOnScreen(list, fold(["c3"]))).toBe(true);
    expect(planEffectOnScreen(list, fold(["c2"]))).toBe(false);
  });

  it("counts the previous plan's lifted cards only when it is on this same container", async () => {
    const { planEffectOnScreen, list, el } = await setup();
    screen([el("c3")]);
    const previous = { active: true, plan: planLifting("c3"), container: list.container, cards: list.cards };
    expect(planEffectOnScreen(list, planLifting("c1"), previous)).toBe(true);
    expect(planEffectOnScreen(list, planLifting("c1"), { ...previous, container: document.createElement("div") })).toBe(false);
    expect(planEffectOnScreen(list, planLifting("c1"), { ...previous, active: false })).toBe(false);
    expect(planEffectOnScreen(list, planLifting("c1"))).toBe(false);
  });

  it("counts the DOM-first slots a lift fills and the new plan's lifted cards", async () => {
    const { planEffectOnScreen, list, el } = await setup();
    screen([el("c0")]);
    expect(planEffectOnScreen(list, planLifting("c3"))).toBe(true);
    screen([el("c2")]);
    expect(planEffectOnScreen(list, planLifting("c2"))).toBe(true);
    expect(planEffectOnScreen(list, planLifting("c3"))).toBe(false);
  });
});
