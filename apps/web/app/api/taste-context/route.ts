import { type InsightType, type ProfileEntry, type ProfileV2, type ThingEntry } from "@focal-ai/core";
import { currentViewer } from "@/lib/server/auth/viewer";
import { runSummary } from "@/lib/server/chat/summary";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/errors";
import { getQlooClient } from "@/lib/server/qloo";
import { checkRateLimit } from "@/lib/server/rateLimit";

const RATE_LIMIT = { limit: 20, windowMs: 60000 };
const TAG_TAKE = 18;
/**
 * Qloo scores at most 50 pinned results per call, so a type with more entries
 * than this is scored for the first 50 and the rest become unscored nodes.
 */
const MAX_PER_TYPE = 50;

export interface TasteTag {
  name: string;
  affinity?: number;
}

export interface TasteNode {
  id: string;
  name: string;
  /** Short type name, which is also the cluster the node belongs to. */
  type: string;
  strength: string;
  /** How well the rest of the profile predicts this entry, 0..1. */
  affinity?: number;
}

export interface TasteEdge {
  from: string;
  to: string;
  affinity: number;
}

const label = (type: string) => type.replace("urn:entity:", "").replace("_", " ");

/**
 * Qloo's own "Taste Context": `filter.type=urn:tag` returns the descriptive
 * vocabulary behind a taste set, blended across domains. Verified live
 * 2026-10-23 — Fugazi + Rintaro yields punk/noise rock alongside Chef/Cooking.
 */
async function tasteTags(signalIds: string[]): Promise<TasteTag[]> {
  const res = await getQlooClient().tagAffinities({ signalEntityIds: signalIds, take: TAG_TAKE });
  return res.tags.map((t) => ({
    name: t.name,
    ...(t.affinity !== undefined ? { affinity: t.affinity } : {}),
  }));
}

/**
 * Scores and edges for the whole profile in one call per type.
 *
 * For each type, the entries of that type are the pinned results and
 * everything else in the profile is the signal — so one call covers every
 * entry of that type at once, and the cost is the number of distinct types
 * (at most ten) rather than N x T pairwise calls. That is what lets the graph
 * show every node instead of a handful.
 *
 * `feature.explainability` then says which entries drove each score, and those
 * contributions are the edges: real cross-domain links, not a guess. Shared
 * tags cannot do this — Qloo's tags are domain-specific, so a band and a
 * restaurant have none in common even when their affinity is high.
 */
async function scoreAndLink(things: ThingEntry[]): Promise<{ scores: Map<string, number>; edges: TasteEdge[] }> {
  const client = getQlooClient();
  const byType = new Map<string, ThingEntry[]>();
  for (const t of things) byType.set(t.type, [...(byType.get(t.type) ?? []), t]);
  const known = new Set(things.map((t) => t.qlooId));

  const scores = new Map<string, number>();
  const edges = new Map<string, TasteEdge>();

  await Promise.all(
    [...byType].map(async ([type, targets]) => {
      const signals = things.filter((t) => t.type !== type);
      // Qloo leaves signal entities out of its own results, so an entry cannot
      // be scored against itself or its own type-mates.
      if (signals.length === 0) return;
      try {
        const res = await client.insights({
          resultType: type as InsightType,
          signalEntityIds: signals.map((s) => s.qlooId),
          resultEntityIds: targets.slice(0, MAX_PER_TYPE).map((t) => t.qlooId),
          explainability: true,
          take: Math.min(MAX_PER_TYPE, targets.length),
        });
        for (const scored of res.entities) {
          const id = scored.entity.entityId;
          if (scored.affinity !== undefined) scores.set(id, scored.affinity);
          for (const c of scored.contributions ?? []) {
            if (!known.has(c.entityId) || c.entityId === id) continue;
            // One edge per pair, keeping the stronger direction.
            const key = [id, c.entityId].sort().join("|");
            const existing = edges.get(key);
            if (!existing || c.score > existing.affinity) {
              edges.set(key, { from: c.entityId, to: id, affinity: c.score });
            }
          }
        }
      } catch {
        // One type failing leaves its nodes unscored rather than emptying the graph.
      }
    }),
  );
  return { scores, edges: [...edges.values()].sort((a, b) => b.affinity - a.affinity) };
}

export async function GET(): Promise<Response> {
  const viewer = await currentViewer();
  if (!viewer) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  }
  const limit = checkRateLimit(`context:${viewer.userId}`, RATE_LIMIT);
  if (!limit.ok) {
    return Response.json({ error: { code: "RATE_LIMIT", message: "Too many requests" } }, { status: 429 });
  }
  const db = getDb();
  if (!viewer.persisted || !db) {
    return Response.json({ tags: [], nodes: [], edges: [], summary: null });
  }
  const { entries } = await db.profile.load(viewer.userId);
  const profile: ProfileV2 = { version: 2, updatedAt: new Date().toISOString(), entries: entries as never };
  const things = (profile.entries as ProfileEntry[]).filter(
    (e): e is ThingEntry => e.kind === "thing" && e.strength !== "dislike",
  );
  if (things.length === 0) {
    return Response.json({ tags: [], nodes: [], edges: [], summary: null, reason: "empty" });
  }

  try {
    const [tags, linked] = await Promise.all([tasteTags(things.map((t) => t.qlooId)), scoreAndLink(things)]);

    // Every entry becomes a node, scored where Qloo could score it.
    const nodes: TasteNode[] = things.map((t) => {
      const affinity = linked.scores.get(t.qlooId);
      return {
        id: t.qlooId,
        name: t.name,
        type: label(t.type),
        strength: t.strength,
        ...(affinity !== undefined ? { affinity } : {}),
      };
    });

    const summary = await runSummary(
      things.map((t) => t.name),
      tags.map((t) => t.name),
    );
    return Response.json({ tags, nodes, edges: linked.edges, summary });
  } catch (e) {
    return errorResponse(e);
  }
}
