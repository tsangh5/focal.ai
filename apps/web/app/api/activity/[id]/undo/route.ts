import { undoEvent } from "@focal-ai/core";
import { signInRequired, websiteCaller } from "@/lib/server/auth/caller";
import { errorResponse } from "@/lib/server/errors";
import { profileErrorResponse } from "@/lib/server/profile/errors";
import { profileStoreFor } from "@/lib/server/profile/store";

/** Undo one activity event; the undo is itself logged (and can be undone). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const caller = await websiteCaller();
  if (!caller) return signInRequired();
  const { id } = await ctx.params;
  const store = profileStoreFor(caller.userId, caller.persisted);
  const target = (await store.activity(500)).find((e) => e.id === id);
  if (!target) return Response.json({ error: { code: "NOT_FOUND", message: "no such activity" } }, { status: 404 });
  if (target.undoneBy) {
    return Response.json({ error: { code: "NOT_UNDOABLE", message: "this change was already undone" } }, { status: 409 });
  }
  try {
    const { profile, event } = undoEvent(await store.load(), target, "manual");
    await store.commit(profile, event);
    return Response.json({ event });
  } catch (e) {
    return profileErrorResponse(e) ?? errorResponse(e);
  }
}
