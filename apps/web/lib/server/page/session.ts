import type { ProfileV2 } from "@focal-ai/core";
import { getDb } from "../db";
import { devAccount } from "../auth/devAccount";
import { memoryProfileStore } from "../profile/store";

export interface PageSession {
  userId: string;
  profile: ProfileV2;
}

export function devSessionsEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.FOCAL_DEV_SESSION === "1";
}

export function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S{1,512})$/i.exec(req.headers.get("authorization") ?? "");
  return m?.[1] ?? null;
}

/**
 * Resolves the caller from the extension's bearer token: an extension session
 * in Postgres when the database is configured (or the dev account for non-fx
 * tokens when dev sessions are on), else the in-memory dev session.
 */
export async function resolveSession(req: Request): Promise<PageSession | null> {
  const token = bearer(req);
  if (!token) return null;
  const db = getDb();
  if (db) {
    // Real sessions are fx_ tokens; any other token is the local dev account when dev sessions are on.
    const userId = token.startsWith("fx_")
      ? (await db.extensionSessions.resolve(token))?.userId
      : devSessionsEnabled()
        ? (await devAccount(db)).id
        : undefined;
    if (!userId) return null;
    const { entries } = await db.profile.load(userId);
    const profile: ProfileV2 = { version: 2, updatedAt: new Date().toISOString(), entries: entries as unknown as ProfileV2["entries"] };
    return { userId, profile };
  }
  // The dev session shares the in-memory profile the website chat and pages edit.
  if (devSessionsEnabled()) return { userId: "dev", profile: await memoryProfileStore("dev").load() };
  return null;
}

export function unauthorizedResponse(): Response {
  return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
}
