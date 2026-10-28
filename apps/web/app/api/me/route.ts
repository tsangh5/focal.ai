import { connection } from "next/server";
import { currentViewer } from "@/lib/server/auth/viewer";

/** Website header state: who is signed in, if anyone. Never returns tokens. */
export async function GET(): Promise<Response> {
  // Per-request: never prerender who is signed in.
  await connection();
  const viewer = await currentViewer();
  if (!viewer) return Response.json({ signedIn: false });
  return Response.json({ signedIn: true, email: viewer.email });
}
