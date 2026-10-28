import { approveRule, changeStrength, removeEntry, type ProfileWrite } from "@focal-ai/core";
import { z } from "zod";
import { signInRequired, websiteCaller } from "@/lib/server/auth/caller";
import { errorResponse } from "@/lib/server/errors";
import { badRequest, profileErrorResponse, readJson } from "@/lib/server/profile/errors";
import { profileStoreFor } from "@/lib/server/profile/store";

const patchSchema = z.union([
  z.object({ strength: z.enum(["love", "like", "dislike"]) }).strict(),
  z.object({ approve: z.literal(true) }).strict(),
]);

type Ctx = { params: Promise<{ id: string }> };

async function write(ctx: Ctx, change: (id: string, profile: Parameters<typeof removeEntry>[0]) => ProfileWrite): Promise<Response> {
  const caller = await websiteCaller();
  if (!caller) return signInRequired();
  const { id } = await ctx.params;
  const store = profileStoreFor(caller.userId, caller.persisted);
  try {
    const { profile, event } = change(id, await store.load());
    await store.commit(profile, event);
    return Response.json({ entry: event.after ?? null, event });
  } catch (e) {
    return profileErrorResponse(e) ?? errorResponse(e);
  }
}

/** Change a thing's or vibe's strength, or approve a pending rule (website only). */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return badRequest();
  const body = parsed.data;
  return write(ctx, (id, profile) =>
    "approve" in body ? approveRule(profile, id) : changeStrength(profile, id, body.strength, "manual"),
  );
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  return write(ctx, (id, profile) => removeEntry(profile, id, "manual"));
}
