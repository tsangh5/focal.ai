import { describe, expect, it, vi } from "vitest";
import { runPageRank, type CoreEntity, type CoreSearchFn, type PageCandidate, type PageItem, type ProfileV2 } from "@focal-ai/core";
import { QlooError } from "@focal-ai/qloo";
import {
  cachedResolutionResolver,
  UNRESOLVED_TTL_MS,
  type CachedResolution,
  type ResolutionKey,
  type ResolutionStore,
} from "@/lib/server/resolution/cache";

const PLACE = "urn:entity:place";

const RINTARO: CoreEntity = {
  entityId: "E-rintaro",
  name: "Rintaro",
  subtype: PLACE,
  disambiguation: "San Francisco",
};

const keyOf = (k: { normalizedName: string; type: string; city: string }) =>
  `${k.type}${k.normalizedName}${k.city}`;

/** In-memory ResolutionStore fake matching db.resolutions semantics. */
function fakeStore(seed: CachedResolution[] = []): ResolutionStore & { rows: Map<string, CachedResolution> } {
  const rows = new Map(seed.map((row) => [keyOf(row), row]));
  return {
    rows,
    async getMany(keys: ResolutionKey[]) {
      return keys
        .map((key) => rows.get(keyOf({ normalizedName: key.normalizedName, type: key.type, city: key.city ?? "" })))
        .filter((row): row is CachedResolution => row !== undefined);
    },
    async put(entries) {
      for (const entry of entries) {
        rows.set(keyOf({ normalizedName: entry.normalizedName, type: entry.type, city: entry.city ?? "" }), {
          normalizedName: entry.normalizedName,
          type: entry.type,
          city: entry.city ?? "",
          entityId: entry.entityId,
          status: entry.status,
          entity: entry.entity ?? null,
          updatedAt: new Date().toISOString(),
        });
      }
    },
  };
}

const candidate: PageCandidate = {
  clientId: "c0",
  name: "Rintaro",
  locationText: "San Francisco",
  originalIndex: 0,
};

const resolvedRow: CachedResolution = {
  normalizedName: "rintaro",
  type: PLACE,
  city: "san francisco",
  entityId: RINTARO.entityId,
  status: "resolved",
  entity: RINTARO,
  updatedAt: new Date().toISOString(),
};

describe("cachedResolutionResolver", () => {
  it("serves a second resolve of the same item from cache with no search call", async () => {
    const store = fakeStore();
    const search = vi.fn<CoreSearchFn>(async () => [RINTARO]);
    const resolve = cachedResolutionResolver(store, "u1");

    const first = await resolve([candidate], search, PLACE);
    expect(first[0]).toMatchObject({ status: "resolved", entity: { entityId: RINTARO.entityId } });
    expect(search).toHaveBeenCalledTimes(1);

    const second = await resolve([candidate], search, PLACE);
    expect(second[0]).toMatchObject({ status: "resolved", entity: { entityId: RINTARO.entityId } });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("keeps cached ambiguous outcomes without re-searching", async () => {
    const store = fakeStore([{ ...resolvedRow, status: "ambiguous" }]);
    const search = vi.fn<CoreSearchFn>(async () => []);
    const resolved = await cachedResolutionResolver(store, "u1")([candidate], search, PLACE);
    expect(resolved[0]).toMatchObject({ status: "ambiguous", entity: { entityId: RINTARO.entityId } });
    expect(search).not.toHaveBeenCalled();
  });

  it("re-resolves an unresolved entry older than 7 days", async () => {
    const stale = new Date(Date.now() - UNRESOLVED_TTL_MS - 60_000).toISOString();
    const store = fakeStore([{ ...resolvedRow, status: "unresolved", entityId: null, entity: null, updatedAt: stale }]);
    const search = vi.fn<CoreSearchFn>(async () => [RINTARO]);

    const resolved = await cachedResolutionResolver(store, "u1")([candidate], search, PLACE);
    expect(resolved[0]).toMatchObject({ status: "resolved" });
    expect(search).toHaveBeenCalledTimes(1);
    const row = [...store.rows.values()][0]!;
    expect(row.status).toBe("resolved");
    expect(Date.parse(row.updatedAt)).toBeGreaterThan(Date.parse(stale));
  });

  it("reuses an unresolved entry that is still fresh", async () => {
    const store = fakeStore([{ ...resolvedRow, status: "unresolved", entityId: null, entity: null }]);
    const search = vi.fn<CoreSearchFn>(async () => [RINTARO]);
    const resolved = await cachedResolutionResolver(store, "u1")([candidate], search, PLACE);
    expect(resolved[0]).toMatchObject({ status: "unresolved" });
    expect(resolved[0]!.entity).toBeUndefined();
    expect(search).not.toHaveBeenCalled();
  });

  it("never caches a thrown search error", async () => {
    const store = fakeStore();
    const failing = vi.fn<CoreSearchFn>(async () => {
      throw new QlooError("RATE_LIMIT", "too many requests");
    });
    const resolve = cachedResolutionResolver(store, "u1");
    await expect(resolve([candidate], failing, PLACE)).rejects.toBeInstanceOf(QlooError);
    expect(store.rows.size).toBe(0);

    const working = vi.fn<CoreSearchFn>(async () => [RINTARO]);
    const resolved = await resolve([candidate], working, PLACE);
    expect(resolved[0]).toMatchObject({ status: "resolved" });
    expect(store.rows.size).toBe(1);
  });

  it("resolves uncached when the store read fails", async () => {
    const store = fakeStore();
    store.getMany = async () => {
      throw new Error("db down");
    };
    const search = vi.fn<CoreSearchFn>(async () => [RINTARO]);
    const resolved = await cachedResolutionResolver(store, "u1")([candidate], search, PLACE);
    expect(resolved[0]).toMatchObject({ status: "resolved" });
    expect(search).toHaveBeenCalledTimes(1);
  });
});

const PROFILE: ProfileV2 = {
  version: 2,
  updatedAt: "2026-10-20T00:00:00.000Z",
  entries: [
    {
      id: "e1",
      kind: "thing",
      qlooId: "E-seed",
      name: "Fugazi",
      type: "urn:entity:artist",
      strength: "love",
      source: "manual",
      createdAt: "2026-10-20T00:00:00.000Z",
    },
    {
      id: "e2",
      kind: "thing",
      qlooId: "E-rintaro-seed",
      name: "Rintaro",
      type: PLACE,
      strength: "like",
      source: "manual",
      createdAt: "2026-10-20T00:00:00.000Z",
    },
  ],
};

describe("cached resolution through the page rank pipeline", () => {
  it("a second rank of the same item makes no search call", async () => {
    const store = fakeStore();
    const search = vi.fn<CoreSearchFn>(async () => [RINTARO]);
    const insights = vi.fn(async () => ({ scores: [] }));
    const deps = { search, insights, resolve: cachedResolutionResolver(store, "u1") };
    const items: PageItem[] = [{ clientId: "c0", name: "Rintaro", originalIndex: 0, type: PLACE, city: "San Francisco" }];

    const first = await runPageRank({ pageId: "p1", pageType: PLACE, items, profile: PROFILE, deps });
    expect(first.items[0]).toMatchObject({ status: "resolved" });
    expect(search).toHaveBeenCalledTimes(1);

    const second = await runPageRank({ pageId: "p2", pageType: PLACE, items, profile: PROFILE, deps });
    expect(second.items[0]).toMatchObject({ status: "resolved" });
    expect(search).toHaveBeenCalledTimes(1);
  });
});

describe("caller budget isolation", () => {
  it("exhausted caller fires onLimited; a different caller still resolves", async () => {
    const { cachedResolutionResolver } = await import("@/lib/server/resolution/cache");
    const { checkRateLimit } = await import("@/lib/server/rateLimit");
    for (let i = 0; i < 90; i++) checkRateLimit("resolve:budget-user", { limit: 90, windowMs: 60_000 });
    let limited = 0;
    const search = vi.fn(async () => [] as never);
    const out = await cachedResolutionResolver(null, "budget-user", () => { limited++; })(
      [{ clientId: "c0", name: "X", originalIndex: 0 }] as never, search, "place",
    );
    expect(search).not.toHaveBeenCalled(); // the 91st miss makes no Qloo call
    expect(limited).toBe(1);
    expect((out as { status?: string }[])[0]?.status).toBe("unresolved");
    // Per-caller: a different key still resolves (two MCP callers don't share a bucket).
    const out2 = await cachedResolutionResolver(null, "mcp:user-b")(
      [{ clientId: "c0", name: "X", originalIndex: 0 }] as never, search, "place",
    );
    expect(search).toHaveBeenCalledOnce();
    void out2;
  });
});
