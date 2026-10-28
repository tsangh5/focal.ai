import { getDb } from "../db";
import { devSessionsEnabled } from "../page/session";
import { authEnabled } from "./config";
import { DEV_EMAIL, devAccount } from "./devAccount";
import { ensureUser } from "./users";

export interface Viewer {
  userId: string;
  email: string;
  /** False only for the local dev session, which has no database account. */
  persisted: boolean;
}

/** The signed-in website user (WorkOS cookie), or the dev session locally. */
export async function currentViewer(): Promise<Viewer | null> {
  const db = getDb();
  if (authEnabled() && db) {
    const { withAuth } = await import("@workos-inc/authkit-nextjs");
    const { user } = await withAuth();
    if (!user?.email) return null;
    const account = await ensureUser(db, { id: user.id, email: user.email });
    return { userId: account.id, email: user.email, persisted: true };
  }
  if (devSessionsEnabled()) {
    // With a database, the dev viewer is a real account shared with the extension's dev session.
    if (db) return { userId: (await devAccount(db)).id, email: DEV_EMAIL, persisted: true };
    return { userId: "dev", email: DEV_EMAIL, persisted: false };
  }
  return null;
}
