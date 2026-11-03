import { describe, expect, it } from "vitest";
import { callerKey, FREE_ALLOWANCE, quotaExceeded } from "@/lib/server/quota";

const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/page/identify", { headers });

describe("caller-supplied keys", () => {
  it("reads a plausible key from its header", () => {
    expect(callerKey(req({ "x-focal-jev-key": "apikey_abcdefgh" }), "x-focal-jev-key")).toBe("apikey_abcdefgh");
  });

  it("ignores a missing, blank or implausible header", () => {
    expect(callerKey(req(), "x-focal-jev-key")).toBeUndefined();
    expect(callerKey(req({ "x-focal-jev-key": "   " }), "x-focal-jev-key")).toBeUndefined();
    // Too short to be a key: treat as absent rather than send junk upstream.
    expect(callerKey(req({ "x-focal-jev-key": "abc" }), "x-focal-jev-key")).toBeUndefined();
    expect(callerKey(req({ "x-focal-jev-key": "x".repeat(401) }), "x-focal-jev-key")).toBeUndefined();
  });

  it("trims surrounding whitespace, which pasting usually adds", () => {
    expect(callerKey(req({ "x-focal-groq-key": "  gsk_abcdefgh  " }), "x-focal-groq-key")).toBe("gsk_abcdefgh");
  });
});

describe("quota exhaustion", () => {
  it("answers 402 and names the unit that ran out", async () => {
    const res = quotaExceeded("rank", { allowed: false, used: 25, limit: 25, ownKey: false });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "QUOTA_EXCEEDED", kind: "rank", used: 25, limit: 25 });
    expect(body.error.message).toContain("ranked pages");
  });

  it("names chat messages for the chat counter, not pages", async () => {
    const body = await quotaExceeded("chat", { allowed: false, used: 25, limit: 25, ownKey: false }).json();
    expect(body.error.message).toContain("chat messages");
  });

  it("meters the two separately", () => {
    expect(Object.keys(FREE_ALLOWANCE).sort()).toEqual(["chat", "rank"]);
    for (const n of Object.values(FREE_ALLOWANCE)) expect(n).toBeGreaterThan(0);
  });
});
