import { signInRequired, websiteCaller } from "@/lib/server/auth/caller";
import { profileStoreFor } from "@/lib/server/profile/store";

export async function GET(): Promise<Response> {
  const caller = await websiteCaller();
  if (!caller) return signInRequired();
  const profile = await profileStoreFor(caller.userId, caller.persisted).load();
  return Response.json({ entries: profile.entries }, { headers: { "Cache-Control": "no-store" } });
}
