import { addEntry, findEntry } from "@focal-ai/core";
import { z } from "zod";
import { extensionCaller, signInRequired } from "@/lib/server/auth/caller";
import { errorResponse } from "@/lib/server/errors";
import { getPageResultStore } from "@/lib/server/page/store";
import {
  isEntityShortType,
  PRODUCT_SHORT_TYPE,
  SHORT_TYPES,
  toInsightType,
  type ShortType,
} from "@/lib/server/page/schemas";
import { badRequest, profileErrorResponse, readJson } from "@/lib/server/profile/errors";
import { profileStoreFor } from "@/lib/server/profile/store";
import { checkRateLimit } from "@/lib/server/rateLimit";

const bodySchema = z
  .object({
    pageResultId: z.string().uuid(),
    clientId: z.string().min(1).max(16),
    verdict: z.enum(["more", "less"]),
  })
  .strict();

interface StoredItem {
  clientId: string;
  name: string;
  entityId?: string;
  entityName?: string;
  disambiguation?: string;
  facets?: { tagId: string; tagName: string; valueName: string }[];
}

/**
 * "More like this" / "Not for me" on a lifted card: saves that thing as a
 * like or a dislike (source `page`), logged in the activity feed with undo.
 *
 * A product has no entity to save, so the feedback lands on the facet that
 * lifted it instead — a vibe on the Qloo tag the match came from (§5.11).
 * Only the strongest facet is written: it is the one the label named, so it
 * is the one the user was reacting to.
 */
export async function POST(req: Request): Promise<Response> {
  const caller = await extensionCaller(req);
  if (!caller) return signInRequired();
  if (!checkRateLimit(`feedback:${caller.userId}`, { limit: 30, windowMs: 60000 }).ok) {
    return Response.json({ error: { code: "RATE_LIMIT", message: "Too many feedback taps" } }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return badRequest();
  const { pageResultId, clientId, verdict } = parsed.data;

  const row = await getPageResultStore().get(pageResultId, caller.userId);
  const item = (row?.items as StoredItem[] | undefined)?.find((i) => i.clientId === clientId);
  const stored = (row?.meta as { pageType?: string } | undefined)?.pageType;
  const pageType = SHORT_TYPES.find((t) => t === stored);
  if (!row || pageType === undefined) {
    return Response.json({ error: { code: "NOT_FOUND", message: "that item can't be saved" } }, { status: 404 });
  }

  const store = profileStoreFor(caller.userId, caller.persisted);
  if (pageType === PRODUCT_SHORT_TYPE) {
    const facet = item?.facets?.[0];
    if (!facet) {
      return Response.json({ error: { code: "NOT_FOUND", message: "that item can't be saved" } }, { status: 404 });
    }
    const strength = verdict === "more" ? "like" : "dislike";
    try {
      const profile = await store.load();
      const existing = findEntry(profile, "vibe", facet.tagId);
      if (existing?.kind === "vibe" && existing.strength === strength) {
        return Response.json({ saved: true, name: existing.name, strength, unchanged: true });
      }
      const { profile: next, event } = addEntry(
        profile,
        { kind: "vibe", qlooId: facet.tagId, name: facet.valueName, strength, source: "page" },
        "page",
      );
      await store.commit(next, event);
      return Response.json({ saved: true, name: facet.valueName, strength, event_id: event.id });
    } catch (e) {
      return profileErrorResponse(e) ?? errorResponse(e);
    }
  }

  if (!item?.entityId || !isEntityShortType(pageType)) {
    return Response.json({ error: { code: "NOT_FOUND", message: "that item can't be saved" } }, { status: 404 });
  }
  try {
    const profile = await store.load();
    const existing = findEntry(profile, "thing", item.entityId);
    const strength = verdict === "more" ? "like" : "dislike";
    // "More like this" never downgrades a love.
    if (existing?.kind === "thing" && (existing.strength === strength || (verdict === "more" && existing.strength === "love"))) {
      return Response.json({ saved: true, name: existing.name, strength: existing.strength, unchanged: true });
    }
    const { profile: next, event } = addEntry(
      profile,
      {
        kind: "thing",
        qlooId: item.entityId,
        name: item.entityName ?? item.name,
        type: toInsightType(pageType),
        ...(item.disambiguation ? { disambiguation: item.disambiguation } : {}),
        strength,
        source: "page",
      },
      "page",
    );
    await store.commit(next, event);
    return Response.json({ saved: true, name: event.after?.name ?? item.name, strength, event_id: event.id });
  } catch (e) {
    return profileErrorResponse(e) ?? errorResponse(e);
  }
}
