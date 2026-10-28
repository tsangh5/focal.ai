import { groundedReasonNames, selectSignals, type InsightType, type ProfileV2 } from "@focal-ai/core";
import { z } from "zod";
import { currentViewer } from "@/lib/server/auth/viewer";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/errors";
import { getQlooClient } from "@/lib/server/qloo";
import { qlooImageUrl } from "@/lib/server/qlooImage";
import { checkRateLimit } from "@/lib/server/rateLimit";

/** One Qloo call per request; the front page asks for a single type at a time. */
const RATE_LIMIT = { limit: 30, windowMs: 60000 };
const TAKE = 8;

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

const querySchema = z.object({
  type: z.enum(TYPES).default("place"),
  city: z.string().trim().max(80).optional(),
  trends: z.enum(["low", "medium", "high"]).default("high"),
});

export interface DiscoverItem {
  entityId: string;
  name: string;
  affinity?: number;
  disambiguation?: string;
  /** Qloo artwork (`properties.image.url`), present for every entity type. */
  imageUrl?: string;
  /** Profile entries that drove this pick, from feature.explainability. */
  because: string[];
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

  const resultType = `urn:entity:${parsed.data.type}` as InsightType;
  const signals = selectSignals(profile, resultType);
  if (signals.entities.length === 0 && signals.tags.length === 0) {
    return Response.json({ items: [], reason: "profile has nothing to go on yet" });
  }

  try {
    const res = await getQlooClient().insights({
      resultType,
      signalEntityIds: signals.entities.map((s) => s.id),
      signalTagIds: signals.tags.map((s) => s.id),
      ...(parsed.data.city ? { locationQuery: parsed.data.city } : {}),
      ...(TRENDS_UNSUPPORTED.has(parsed.data.type) ? {} : { biasTrends: parsed.data.trends }),
      explainability: true,
      take: TAKE,
    });
    const items: DiscoverItem[] = res.entities.map((s) => {
      const imageUrl = qlooImageUrl(s.entity.entityId, s.entity.properties);
      return {
        entityId: s.entity.entityId,
        name: s.entity.name,
        ...(s.affinity !== undefined ? { affinity: s.affinity } : {}),
        ...(s.entity.disambiguation ? { disambiguation: s.entity.disambiguation } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        because: groundedReasonNames(s.contributions, profile),
      };
    });
    return Response.json({ items, durationMs: res.durationMs });
  } catch (e) {
    return errorResponse(e);
  }
}
