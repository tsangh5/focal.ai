import { getDb } from "../db";
import { bearer, resolveSession } from "../page/session";
import { currentViewer } from "./viewer";

/** Who is calling a profile or settings API, and whether their data lives in Postgres. */
export interface Caller {
  userId: string;
  persisted: boolean;
  via: "website" | "extension";
}

/** The signed-in website user (cookie), or the local dev viewer. */
export async function websiteCaller(): Promise<Caller | null> {
  const viewer = await currentViewer();
  return viewer ? { userId: viewer.userId, persisted: viewer.persisted, via: "website" } : null;
}

/** The extension's bearer session, when the request carries one. */
export async function extensionCaller(req: Request): Promise<Caller | null> {
  if (!bearer(req)) return null;
  const session = await resolveSession(req);
  if (!session) return null;
  return { userId: session.userId, persisted: Boolean(getDb()) && session.userId !== "dev", via: "extension" };
}

/** Extension bearer first (it never carries website cookies), then the website session. */
export async function anyCaller(req: Request): Promise<Caller | null> {
  return bearer(req) ? extensionCaller(req) : websiteCaller();
}

export function signInRequired(): Response {
  return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
}
