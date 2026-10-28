import { signInRequired, websiteCaller } from "@/lib/server/auth/caller";
import { getDb } from "@/lib/server/db";
import { clearMemoryProfile, profileStoreFor } from "@/lib/server/profile/store";
import { clearMemorySites, loadSites } from "@/lib/server/settings/store";

/** Download everything focal stores about the signed-in user as JSON. */
export async function GET(): Promise<Response> {
  const caller = await websiteCaller();
  if (!caller) return signInRequired();
  const db = getDb();
  const body =
    caller.persisted && db
      ? await db.profile.export(caller.userId)
      : {
          user: { id: caller.userId },
          profile: await profileStoreFor(caller.userId, false).load(),
          activity: await profileStoreFor(caller.userId, false).activity(500),
          sites: await loadSites(caller.userId, false),
        };
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="focal-export.json"',
      "Cache-Control": "no-store",
    },
  });
}

/** Delete the account: profile, activity, settings, page results and extension sessions. */
export async function DELETE(): Promise<Response> {
  const caller = await websiteCaller();
  if (!caller) return signInRequired();
  const db = getDb();
  if (caller.persisted && db) {
    await db.extensionSessions.revokeAll(caller.userId);
    await db.users.delete(caller.userId);
  } else {
    clearMemoryProfile(caller.userId);
    clearMemorySites(caller.userId);
  }
  return new Response(null, { status: 204 });
}
