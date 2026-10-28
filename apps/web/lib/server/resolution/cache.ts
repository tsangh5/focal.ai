import { checkRateLimit } from "../rateLimit";
/**
 * Shared resolution cache (P-04): resolver-OUTCOME cache over the core
 * resolver, keyed by (normalized name, type URN, normalized city). Hits skip
 * the Qloo /search call entirely; misses resolve through the unchanged core
 * resolver and their outcomes are written back. The core resolver stays the
 * only owner of match decisions; @focal-ai/core never sees the store.
 *
 * Store rows are shared across users (spec §4.5 ResolutionCache): they hold
 * entity references and statuses only, never page or user data.
 */
import {
  normalizeName,
  resolveCandidates,
  type CoreEntity,
  type CoreResolveFn,
  type ResolvedCandidate,
  type ResolutionStatus,
} from "@focal-ai/core";
import { getDb } from "../db";

/** Unresolved entries go stale after 7 days; resolved/ambiguous are valid forever. */
export const UNRESOLVED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResolutionKey {
  normalizedName: string;
  type: string;
  city?: string;
}

export interface CachedResolution extends ResolutionKey {
  city: string;
  entityId: string | null;
  status: string;
  entity: unknown;
  updatedAt: string;
}

/** Minimal store contract; satisfied by db.resolutions. */
export interface ResolutionStore {
  getMany(keys: ResolutionKey[]): Promise<CachedResolution[]>;
  put(
    entries: (ResolutionKey & { entityId: string | null; status: string; entity?: unknown })[],
  ): Promise<void>;
}

let storeOverride: ResolutionStore | null | undefined;

/** db.resolutions when a database is configured; null keeps today's behaviour. */
export function getResolutionStore(): ResolutionStore | null {
  if (storeOverride !== undefined) return storeOverride;
  // Mock resolutions carry fixture IDs — never let them into the shared cache.
  if (process.env.QLOO_MOCK === "1") return null;
  return getDb()?.resolutions ?? null;
}

export function __setResolutionStoreForTests(store: ResolutionStore | null | undefined): void {
  storeOverride = store;
}

const keyOf = (k: { normalizedName: string; type: string; city: string }) =>
  JSON.stringify([k.type, k.normalizedName, k.city]);

function stillValid(row: CachedResolution): boolean {
  if (row.status === "unresolved") {
    return Date.now() - Date.parse(row.updatedAt) <= UNRESOLVED_TTL_MS;
  }
  return true;
}

/**
 * Wraps core's resolveCandidates: one batched lookup up front, hits reuse the
 * cached entity + status, and each miss resolves (and writes back) one at a
 * time so a thrown search error is never cached. Cache read/write failures
 * fall back to plain resolution rather than failing the rank.
 */
export function cachedResolutionResolver(
  store: ResolutionStore | null,
  callerKey: string,
  onLimited?: () => void,
): CoreResolveFn {
  return async (candidates, search, expectedType, defaults) => {
    const keys = candidates.map((candidate) => ({
      normalizedName: normalizeName(candidate.name),
      type: expectedType,
      city: normalizeName(candidate.locationText ?? defaults?.location ?? ""),
    }));

    let rows: CachedResolution[] = [];
    if (store) {
      try {
        rows = await store.getMany(keys);
      } catch {
        rows = [];
      }
    }
    const hits = new Map(rows.filter(stillValid).map((row) => [keyOf(row), row]));

    const resolved: (ResolvedCandidate | undefined)[] = new Array(candidates.length);
    const misses: number[] = [];
    candidates.forEach((candidate, index) => {
      const hit = hits.get(keyOf(keys[index]!));
      if (hit === undefined) {
        misses.push(index);
        return;
      }
      resolved[index] = {
        ...candidate,
        status: hit.status as ResolutionStatus,
        ...(hit.entity == null ? {} : { entity: hit.entity as CoreEntity }),
      };
    });

    for (const index of misses) {
      // Per-caller uncached budget: a 60-item rank fans out to paced Qloo
      // searches — cap them so one caller can't starve the queue (R8-8).
      if (!checkRateLimit(`resolve:${callerKey}`, { limit: 90, windowMs: 60_000 }).ok) {
        onLimited?.(); // per-request signal (R9-7) — never module state
        resolved[index] = { ...candidates[index]!, status: "unresolved" as ResolutionStatus };
        continue;
      }
      const [outcome] = await resolveCandidates([candidates[index]!], search, expectedType, defaults);
      resolved[index] = outcome;
      if (!store) continue;
      try {
        await store.put([
          {
            ...keys[index]!,
            entityId: outcome?.entity?.entityId ?? null,
            status: outcome?.status ?? "unresolved",
            entity: outcome?.entity ?? null,
          },
        ]);
      } catch {
        // A cache write failure must not fail the rank.
      }
    }

    return resolved.map((r) => r!);
  }
}
