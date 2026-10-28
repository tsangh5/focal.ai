import { addEntry, findEntry } from "@focal-ai/core";
import { z } from "zod";
import { extensionCaller, signInRequired } from "@/lib/server/auth/caller";
import { errorResponse } from "@/lib/server/errors";
import { getPageResultStore } from "@/lib/server/page/store";
import { SHORT_TYPES, toInsightType } from "@/lib/server/page/schemas";
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
}

/**
 * "More like this" / "Not for me" on a lifted card: saves that thing as a
 * like or a dislike (source `page`), logged in the activity feed with undo.
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
  const pageType = (row?.meta as { pageType?: string } | undefined)?.pageType;
  if (!row || !item?.entityId || !SHORT_TYPES.includes(pageType as (typeof SHORT_TYPES)[number])) {
    return Response.json({ error: { code: "NOT_FOUND", message: "that item can't be saved" } }, { status: 404 });
  }

  const store = profileStoreFor(caller.userId, caller.persisted);
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
        type: toInsightType(pageType as (typeof SHORT_TYPES)[number]),
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
