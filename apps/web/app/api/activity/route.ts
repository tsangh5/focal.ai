import { signInRequired, websiteCaller } from "@/lib/server/auth/caller";
import { profileStoreFor } from "@/lib/server/profile/store";

export async function GET(): Promise<Response> {
  const caller = await websiteCaller();
  if (!caller) return signInRequired();
  const events = await profileStoreFor(caller.userId, caller.persisted).activity(100);
  return Response.json({ events }, { headers: { "Cache-Control": "no-store" } });
}
