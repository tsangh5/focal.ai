import { z } from "zod";
import { approveRule, undoEvent, ProfileError, type ActivityEvent } from "@focal-ai/core";
import { DbError } from "@focal-ai/db";
import { currentViewer } from "@/lib/server/auth/viewer";
import { dbProfileStore, memoryProfileStore } from "@/lib/server/chat/store";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/errors";

const ACTIVITY_LIMIT = 50;

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve_rule"), entry_id: z.string().min(1) }),
  z.object({ action: z.literal("undo"), event_id: z.string().min(1) }),
]);

function notFound(message: string): Response {
  return Response.json({ error: { code: "NOT_FOUND", message } }, { status: 404 });
}

/** Entries and the recent activity feed for the signed-in user. */
async function state(userId: string, persisted: boolean): Promise<Response> {
  const db = getDb();
  const store = persisted && db ? dbProfileStore(db, userId) : memoryProfileStore(userId);
  const { entries } = await store.load();
  const activity = persisted && db ? await db.profile.activity(userId, { limit: ACTIVITY_LIMIT }) : [];
  return Response.json({ entries, activity });
}

export async function GET(): Promise<Response> {
  const viewer = await currentViewer();
  if (!viewer) return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  return state(viewer.userId, viewer.persisted);
}

export async function POST(req: Request): Promise<Response> {
  const viewer = await currentViewer();
  if (!viewer) return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  const db = getDb();
  const store = viewer.persisted && db ? dbProfileStore(db, viewer.userId) : memoryProfileStore(viewer.userId);
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: { code: "BAD_REQUEST", message: "invalid request body" } }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return errorResponse(parsed.error);

  try {
    if (parsed.data.action === "approve_rule") {
      const entryId = parsed.data.entry_id;
      const profile = await store.load();
      const target = profile.entries.find((e) => e.id === entryId);
      if (!target || target.kind !== "rule" || target.status !== "pending") {
        return notFound("No pending rule with that id");
      }
      const write = approveRule(profile, target.id);
      await store.commit(write.profile, write.event);
    } else {
      if (!(viewer.persisted && db)) return notFound("No change with that id");
      const record = await db.profile.event(viewer.userId, parsed.data.event_id);
      if (!record || record.undoneBy || record.action === "undo") return notFound("No undoable change with that id");
      const profile = await store.load();
      const write = undoEvent(profile, record as ActivityEvent, "manual");
      await store.commit(write.profile, write.event);
    }
  } catch (e) {
    if (e instanceof DbError && e.code === "CONFLICT") {
      return Response.json(
        { error: { code: "CONFLICT", message: "Your profile changed elsewhere; reload and try again." } },
        { status: 409 },
      );
    }
    if (e instanceof ProfileError) return notFound(e.message);
    throw e;
  }
  return state(viewer.userId, viewer.persisted);
}
