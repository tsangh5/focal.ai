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
    const reply = send(RANK);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(fetch.mock.calls[0]![1]!.signal).toBe(clock.signal);
    clock.abort(new DOMException("signal timed out", "TimeoutError"));
    await expect(reply).resolves.toEqual({ ok: false, error: "signal timed out" });
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
    expect(local.settings).toEqual({ skipSites: ["reddit.com"], siteOff: [], incognito: false });
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
