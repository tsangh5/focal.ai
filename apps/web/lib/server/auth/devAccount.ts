import type { Db, User } from "@focal-ai/db";
import { DEV_PROFILE } from "../profile/store";
import { ensureUser } from "./users";

export const DEV_EMAIL = "dev@localhost";

const cache = globalThis as { __focalDevAccount?: Promise<User> };

/**
 * Local dev with a database but no sign-in: one real account, dev@localhost,
 * shared by the website, the extension's dev session and MCP, seeded once with
 * the demo profile so pages rank out of the box.
 */
export function devAccount(db: Db): Promise<User> {
  cache.__focalDevAccount ??= (async () => {
    const user = await ensureUser(db, { id: "dev", email: DEV_EMAIL });
    const { entries } = await db.profile.load(user.id);
    if (entries.length === 0 && (await db.profile.activity(user.id, { limit: 1 })).length === 0) {
      for (const entry of DEV_PROFILE.entries) {
        await db.profile.commit(user.id, {
          id: crypto.randomUUID(),
          actor: "system",
          action: "add",
          entryId: entry.id,
          after: entry as never,
          at: new Date().toISOString(),
        });
      }
    }
    return user;
  })().catch((e: unknown) => {
    delete cache.__focalDevAccount;
    throw e;
  });
  return cache.__focalDevAccount;
}
