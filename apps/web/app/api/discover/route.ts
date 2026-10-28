import { groundedReasonNames, selectSignals, type InsightType, type ProfileV2 } from "@focal-ai/core";
import { z } from "zod";
import { currentViewer } from "@/lib/server/auth/viewer";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/errors";
import { getQlooClient } from "@/lib/server/qloo";
import { qlooImageUrl } from "@/lib/server/qlooImage";
import { checkRateLimit } from "@/lib/server/rateLimit";

/** A mixed request fans out to one Qloo call per type, so keep the cap low. */
const RATE_LIMIT = { limit: 20, windowMs: 60000 };
/** Results per type: 8 when one type is asked for, fewer when mixing all ten. */
const TAKE = 8;
const TAKE_MIXED = 3;

/** Every type Qloo ranks; all ten verified live against insights. */
const TYPES = [
  "place",
  "movie",
  "tv_show",
  "artist",
  "book",
  "brand",
  "podcast",
  "videogame",
  "person",
  "destination",
] as const;

/**
 * `bias.trends` is per-type — these return "does not yet support trending
 * requests". Verified live 2026-10-28 across all ten types; the rest accept it.
 */
const TRENDS_UNSUPPORTED = new Set<(typeof TYPES)[number]>(["book", "videogame", "destination"]);

/** `all` is the default: a mixed feed, with the category filter opt-in. */
const querySchema = z.object({
  type: z.enum([...TYPES, "all"]).default("all"),
  city: z.string().trim().max(80).optional(),
  trends: z.enum(["low", "medium", "high"]).default("high"),
});

type DiscoverType = (typeof TYPES)[number];

export interface DiscoverItem {
  entityId: string;
  name: string;
  /** Which category this came from; shown as a chip in the mixed feed. */
  type: DiscoverType;
  affinity?: number;
  disambiguation?: string;
  /** Qloo artwork (`properties.image.url`), present for every entity type. */
  imageUrl?: string;
  /** Profile entries that drove this pick, from feature.explainability. */
  because: string[];
}

/**
 * Deterministic shuffle, seeded from the ids themselves.
 *
 * The mixed feed must not arrive grouped by category — ten places then ten
 * films reads as ten lists, not one. Seeding from the content rather than a
 * clock keeps a given set of recommendations in a stable order across
 * re-renders and retries, so the carousel does not reshuffle under the reader.
 */
function interleave(items: DiscoverItem[]): DiscoverItem[] {
  let seed = 0;
  for (const item of items) {
    for (let i = 0; i < item.entityId.length; i++) seed = (Math.imul(seed, 31) + item.entityId.charCodeAt(i)) >>> 0;
  }
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}


/**
 * "Trending for you": taste-driven recommendations, not a re-ranking. The
 * candidate set is Qloo's, so `filter.results.entities` is deliberately unset
 * and the generation parameters (bias.trends, take) apply.
 */
export async function GET(req: Request): Promise<Response> {
  const viewer = await currentViewer();
  if (!viewer) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  }
  const limit = checkRateLimit(`discover:${viewer.userId}`, RATE_LIMIT);
  if (!limit.ok) {
    return Response.json(
      { error: { code: "RATE_LIMIT", message: "Too many requests" } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    type: url.searchParams.get("type") ?? undefined,
    city: url.searchParams.get("city") ?? undefined,
    trends: url.searchParams.get("trends") ?? undefined,
  });
  if (!parsed.success) return errorResponse(parsed.error);

  const db = getDb();
  if (!viewer.persisted || !db) {
    return Response.json({ items: [], reason: "no stored profile" });
  }
  const { entries } = await db.profile.load(viewer.userId);
  const profile: ProfileV2 = { version: 2, updatedAt: new Date().toISOString(), entries: entries as never };

  // Destructured up front: the narrowing on `parsed.data` is lost inside the
  // closure below.
  const { type: requested, city, trends } = parsed.data;
  const mixed = requested === "all";
  const wanted: DiscoverType[] = mixed ? [...TYPES] : [requested];

  /** One type's recommendations. Returns [] rather than throwing, so one
   *  unsupported or failing category never empties the whole feed. */
  async function forType(type: DiscoverType): Promise<DiscoverItem[]> {
    const resultType = `urn:entity:${type}` as InsightType;
    const signals = selectSignals(profile, resultType);
    if (signals.entities.length === 0 && signals.tags.length === 0) return [];
    try {
      const res = await getQlooClient().insights({
        resultType,
        signalEntityIds: signals.entities.map((s) => s.id),
        signalTagIds: signals.tags.map((s) => s.id),
        ...(city && (type === "place" || type === "destination") ? { locationQuery: city } : {}),
        ...(TRENDS_UNSUPPORTED.has(type) ? {} : { biasTrends: trends }),
        explainability: true,
        take: mixed ? TAKE_MIXED : TAKE,
      });
      return res.entities.map((s) => {
        const imageUrl = qlooImageUrl(s.entity.entityId, s.entity.properties);
        return {
          entityId: s.entity.entityId,
          name: s.entity.name,
          type,
          ...(s.affinity !== undefined ? { affinity: s.affinity } : {}),
          ...(s.entity.disambiguation ? { disambiguation: s.entity.disambiguation } : {}),
          ...(imageUrl ? { imageUrl } : {}),
          because: groundedReasonNames(s.contributions, profile),
        };
      });
    } catch {
      return [];
    }
  }

  try {
    const started = Date.now();
    const byType = await Promise.all(wanted.map(forType));
    const flat = byType.flat();
    if (flat.length === 0) {
      return Response.json({ items: [], reason: "profile has nothing to go on yet" });
    }
    // Drop duplicates: the same entity can be returned under more than one type.
    const seen = new Set<string>();
    const unique = flat.filter((i) => !seen.has(i.entityId) && seen.add(i.entityId));
    return Response.json({
      items: mixed ? interleave(unique) : unique,
      types: [...new Set(unique.map((i) => i.type))],
      durationMs: Date.now() - started,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
