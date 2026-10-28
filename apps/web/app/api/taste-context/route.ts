import { type InsightType, type ProfileEntry, type ProfileV2, type ThingEntry } from "@focal-ai/core";
import { currentViewer } from "@/lib/server/auth/viewer";
import { runSummary } from "@/lib/server/chat/summary";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/errors";
import { getQlooClient } from "@/lib/server/qloo";
import { qlooImageUrl } from "@/lib/server/qlooImage";
import { checkRateLimit } from "@/lib/server/rateLimit";

const RATE_LIMIT = { limit: 20, windowMs: 60000 };
const TAG_TAKE = 18;
/** Pairwise affinity costs one Qloo call per (source, target type), so cap it. */
const MAX_NODES = 6;

export interface TasteTag {
  name: string;
  affinity?: number;
}

export interface TasteNode {
  id: string;
  name: string;
  type: string;
  strength: string;
  imageUrl?: string;
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
 * Directed affinity between the user's own entries. Qloo scores a pinned
 * result set against a signal, so one call per (source, target type) gives a
 * row of the matrix. Affinity is asymmetric — Fugazi→Rintaro 0.75 but
 * Rintaro→Fugazi 0.83 — so both directions are kept and the stronger wins.
 */
async function tasteEdges(things: ThingEntry[]): Promise<TasteEdge[]> {
  const client = getQlooClient();
  const byType = new Map<string, ThingEntry[]>();
  for (const t of things) {
    byType.set(t.type, [...(byType.get(t.type) ?? []), t]);
  }
  const edges = new Map<string, TasteEdge>();
  for (const source of things) {
    for (const [type, targets] of byType) {
      const ids = targets.filter((t) => t.qlooId !== source.qlooId).map((t) => t.qlooId);
      if (ids.length === 0) continue;
      try {
        const res = await client.insights({
          resultType: type as InsightType,
          signalEntityIds: [source.qlooId],
          resultEntityIds: ids,
          take: ids.length,
        });
        for (const scored of res.entities) {
          if (scored.affinity === undefined) continue;
          // Undirected display: keep the stronger of the two directions.
          const key = [source.qlooId, scored.entity.entityId].sort().join("|");
          const existing = edges.get(key);
          if (!existing || scored.affinity > existing.affinity) {
            edges.set(key, { from: source.qlooId, to: scored.entity.entityId, affinity: scored.affinity });
          }
        }
      } catch {
        // One missing row should not fail the whole graph.
      }
    }
  }
  return [...edges.values()].sort((a, b) => b.affinity - a.affinity);
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

  const graphThings = things.slice(0, MAX_NODES);
  const nodes: TasteNode[] = graphThings.map((t) => {
    const imageUrl = qlooImageUrl(t.qlooId);
    return {
      id: t.qlooId,
      name: t.name,
      type: label(t.type),
      strength: t.strength,
      ...(imageUrl ? { imageUrl } : {}),
    };
  });

  try {
    const [tags, edges] = await Promise.all([
      tasteTags(things.map((t) => t.qlooId)),
      tasteEdges(graphThings),
    ]);
    const summary = await runSummary(
      things.map((t) => t.name),
      tags.map((t) => t.name),
    );
    return Response.json({ tags, nodes, edges, summary, truncated: things.length > MAX_NODES });
  } catch (e) {
    return errorResponse(e);
  }
}
