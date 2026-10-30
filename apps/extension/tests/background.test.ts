// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackgroundReply, ContentMessage } from "../src/api";

type Reply = BackgroundReply<unknown>;
type Listener = (msg: ContentMessage, sender: { tab?: { id?: number } }, sendResponse: (reply: Reply) => void) => boolean;
type Answer = { status: number; body?: unknown };

const IDENTIFY: ContentMessage = { type: "identify", body: { host: "yelp.com", pathPattern: "/search", signature: "DIV.card", cityHints: [], cards: [] } };
const RANK: ContentMessage = { type: "rank", body: { host: "yelp.com", pathPattern: "/search", pageType: "place", items: [] } };
const NOT_A_LIST: Answer = { status: 200, body: { isList: false, pageType: null, items: [] } };
const SETTINGS: Answer = { status: 200, body: { skipSites: ["reddit.com"], siteOff: [] } };

/**
 * A fresh service worker, signed in. fetch answers each "METHOD /path" with
 * `answer`, and rejects with the signal's reason on abort like the real one.
 */
async function startWorker(answer: (route: string) => Answer | Promise<Answer>) {
  const local: Record<string, unknown> = { session: { token: "fx_test", savedAt: "2026-10-28T00:00:00Z" } };
  let onMessage: Listener | undefined;
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => structuredClone({ [key]: local[key] }),
        set: async (items: Record<string, unknown>) => void Object.assign(local, structuredClone(items)),
        remove: async (key: string) => void delete local[key],
      },
      session: { get: async () => ({}), set: async () => {} },
    },
    runtime: {
      onMessage: { addListener: (fn: Listener) => void (onMessage = fn) },
      onMessageExternal: { addListener: () => {} },
    },
    tabs: { create: async () => ({}) },
  });
  const routes: string[] = [];
  const fetch = vi.fn(
    (url: string, init: RequestInit = {}) =>
      new Promise((resolve, reject) => {
        const route = `${init.method ?? "GET"} ${new URL(url).pathname}`;
        routes.push(route);
        init.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        void Promise.resolve(answer(route)).then(({ status, body }) => resolve({ status, ok: status >= 200 && status < 300, json: async () => body }));
      }),
  );
  vi.stubGlobal("fetch", fetch);
  vi.resetModules();
  await import("../src/background");
  const send = (msg: ContentMessage) => new Promise<Reply>((resolve) => onMessage!(msg, { tab: { id: 1 } }, resolve));
  const pulls = () => routes.filter((r) => r === "GET /api/settings").length;
  return { local, fetch, send, pulls };
}

/** Lets fire-and-forget work (the settings pull an identify starts) finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("server calls", () => {
  it("give up on a hung request after 15 s and reply { ok: false, error } instead of throwing", async () => {
    const clock = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(clock.signal);
    const { fetch, send } = await startWorker(() => new Promise<Answer>(() => {}));
    const reply = send({ type: "feedback", body: { pageResultId: "p", clientId: "c0", verdict: "more" } });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(fetch.mock.calls[0]![1]!.signal).toBe(clock.signal);
    clock.abort(new DOMException("signal timed out", "TimeoutError"));
    await expect(reply).resolves.toEqual({ ok: false, error: "signal timed out" });
  });

  it("give a rank 45 s, since a new list's first rank resolves every name", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { send } = await startWorker(() => ({ status: 200, body: { plan: null } }));
    await send(RANK);
    expect(timeout).toHaveBeenCalledWith(45_000);
  });
});

describe("site decisions", () => {
  const ON = (siteOn: string[]): Answer => ({ status: 200, body: { siteOn, skipSites: [], siteOff: [] } });

  it("survive signing in when they were made signed out, and reach the account", async () => {
    const puts: unknown[] = [];
    const { local, fetch, send } = await startWorker((route) => (route === "GET /api/settings" ? ON(["yelp.com"]) : route === "PUT /api/settings" ? { status: 200 } : NOT_A_LIST));
    const session = local.session;
    delete local.session;
    await send({ type: "enable-site", host: "guide.michelin.com", on: true });
    expect(local.pendingSites).toEqual({ "guide.michelin.com": true });

    local.session = session;
    await send(IDENTIFY);
    await vi.waitFor(() => expect(local.pendingSites).toBeUndefined());
    for (const [, init] of fetch.mock.calls) if (init?.method === "PUT") puts.push(JSON.parse(init.body as string));
    expect((local.settings as { siteOn: string[] }).siteOn).toEqual(["yelp.com", "guide.michelin.com"]);
    expect(puts[0]).toEqual({ siteOn: ["yelp.com", "guide.michelin.com"], skipSites: [], siteOff: [] });
  });

  it("stop being pending once stored, and aren't undone by a pull that left before", async () => {
    let answerPull: (answer: Answer) => void = () => {};
    const { local, send } = await startWorker((route) =>
      route === "GET /api/settings" ? new Promise<Answer>((resolve) => (answerPull = resolve)) : route === "PUT /api/settings" ? { status: 200 } : NOT_A_LIST,
    );
    await send(IDENTIFY);
    await send({ type: "enable-site", host: "guide.michelin.com", on: true });
    expect(local.pendingSites).toBeUndefined();
    answerPull(ON([]));
    await settle();
    expect((local.settings as { siteOn: string[] }).siteOn).toEqual(["guide.michelin.com"]);
  });

  it("stay pending while the account can't be reached", async () => {
    const { local, send } = await startWorker((route) => (route === "PUT /api/settings" ? { status: 503 } : route === "GET /api/settings" ? ON([]) : NOT_A_LIST));
    await send({ type: "enable-site", host: "guide.michelin.com", on: true });
    expect(local.pendingSites).toEqual({ "guide.michelin.com": true });
    await send(IDENTIFY);
    await settle();
    expect((local.settings as { siteOn: string[] }).siteOn).toEqual(["guide.michelin.com"]);
    expect(local.pendingSites).toEqual({ "guide.michelin.com": true });
  });
});

describe("settings pull", () => {
  it("is retried on the next identify after a failure, and held for 5 minutes only after a success", async () => {
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    const settings: Answer[] = [{ status: 503 }, SETTINGS, SETTINGS];
    const { local, send, pulls } = await startWorker((route) => (route === "GET /api/settings" ? settings.shift()! : NOT_A_LIST));
    const identify = async () => {
      await send(IDENTIFY);
      await settle();
    };

    await identify();
    expect(pulls()).toBe(1);
    await identify();
    expect(pulls()).toBe(2);
    expect(local.settings).toEqual({ siteOn: [], skipSites: ["reddit.com"], siteOff: [], incognito: false });
    await identify();
    expect(pulls()).toBe(2);
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    await identify();
    expect(pulls()).toBe(3);
  });

  it("runs one pull at a time however many identify calls arrive meanwhile", async () => {
    let finish: (answer: Answer) => void = () => {};
    const { send, pulls } = await startWorker((route) => (route === "GET /api/settings" ? new Promise<Answer>((resolve) => (finish = resolve)) : NOT_A_LIST));
    await Promise.all([send(IDENTIFY), send(IDENTIFY), send(IDENTIFY)]);
    await settle();
    expect(pulls()).toBe(1);
    finish({ status: 503 });
    await settle();
    await send(IDENTIFY);
    await settle();
    expect(pulls()).toBe(2);
  });
});
