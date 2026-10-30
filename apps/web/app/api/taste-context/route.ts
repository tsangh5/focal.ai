import { type ProfileEntry, type ProfileV2, type ThingEntry } from "@focal-ai/core";
import { currentViewer } from "@/lib/server/auth/viewer";
import { runSummary } from "@/lib/server/chat/summary";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/errors";
import { getQlooClient } from "@/lib/server/qloo";
import { checkRateLimit } from "@/lib/server/rateLimit";

const RATE_LIMIT = { limit: 20, windowMs: 60000 };
const TAG_TAKE = 18;


export interface TasteTag {
  name: string;
  affinity?: number;
}

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
    return Response.json({ tags: [], summary: null });
  }
  const { entries } = await db.profile.load(viewer.userId);
  const profile: ProfileV2 = { version: 2, updatedAt: new Date().toISOString(), entries: entries as never };
  const things = (profile.entries as ProfileEntry[]).filter(
    (e): e is ThingEntry => e.kind === "thing" && e.strength !== "dislike",
  );
  if (things.length === 0) {
    return Response.json({ tags: [], summary: null, reason: "empty" });
  }

  try {
    const tags = await tasteTags(things.map((t) => t.qlooId));
    const summary = await runSummary(
      things.map((t) => t.name),
      tags.map((t) => t.name),
    );
    return Response.json({ tags, summary });
  } catch (e) {
    return errorResponse(e);
  }
}
