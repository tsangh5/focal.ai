import { createEmptyProfileV2, type ActivityEvent, type ProfileV2 } from "@focal-ai/core";
import type { Db } from "@focal-ai/db";
import { getDb } from "../db";

/** An activity event as listed on the website, with who undid it (if anyone). */
export interface ActivityItem extends ActivityEvent {
  undoneBy: string | null;
}

/**
 * One user's profile and activity log. Postgres when the database is
 * configured; otherwise process memory, so local dev works without one.
 */
export interface ProfileStore {
  load(): Promise<ProfileV2>;
  commit(next: ProfileV2, event: ActivityEvent): Promise<void>;
  activity(limit?: number): Promise<ActivityItem[]>;
}

/**
 * Dev-only demo profile (no database): loves Fugazi (artist) and likes
 * Rintaro, so place pages get a cross-domain signal plus a page-type one.
 */
export const DEV_PROFILE: ProfileV2 = {
  version: 2,
  updatedAt: "2026-10-20T00:00:00.000Z",
  entries: [
    {
      id: "dev-fugazi",
      kind: "thing",
      qlooId: "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948",
      name: "Fugazi",
      type: "urn:entity:artist",
      strength: "love",
      source: "manual",
      createdAt: "2026-10-20T00:00:00.000Z",
    },
    {
      id: "dev-rintaro",
      kind: "thing",
      qlooId: "3A8F2C41-7B6D-4E92-8A55-1F0C9D2E6A01",
      name: "Rintaro",
      type: "urn:entity:place",
      strength: "like",
      source: "manual",
      createdAt: "2026-10-20T00:00:00.000Z",
    },
  ],
};

export function dbProfileStore(db: Db, userId: string): ProfileStore {
  let version = 0;
  return {
    async load() {
      const loaded = await db.profile.load(userId);
      version = loaded.version;
      return { version: 2, updatedAt: new Date().toISOString(), entries: loaded.entries as unknown as ProfileV2["entries"] };
    },
    async commit(_next, event) {
      version = await db.profile.commit(userId, event as never, version);
    },
    async activity(limit = 100) {
      return (await db.profile.activity(userId, { limit })) as unknown as ActivityItem[];
    },
  };
}

interface MemoryState {
  profiles: Map<string, ProfileV2>;
  activity: Map<string, ActivityItem[]>;
}

// Route handlers and pages load separate module instances in Next, so the
// in-memory fallback lives on globalThis to be shared between them.
const memoryState = ((globalThis as { __focalProfiles?: MemoryState }).__focalProfiles ??= {
  profiles: new Map(),
  activity: new Map(),
});

export function memoryProfileStore(userId: string): ProfileStore {
  return {
    async load() {
      return memoryState.profiles.get(userId) ?? (userId === "dev" ? DEV_PROFILE : createEmptyProfileV2());
    },
    async commit(next, event) {
      memoryState.profiles.set(userId, next);
      const log: ActivityItem[] = memoryState.activity.get(userId) ?? [];
      if (event.undoes) {
        const undone = log.find((e) => e.id === event.undoes);
        if (undone) undone.undoneBy = event.id;
      }
      memoryState.activity.set(userId, [{ ...event, undoneBy: null }, ...log].slice(0, 500));
    },
    async activity(limit = 100) {
      return (memoryState.activity.get(userId) ?? []).slice(0, limit);
    },
  };
}

/** Forget a user's in-memory profile (account deletion without a database). */
export function clearMemoryProfile(userId: string): void {
  memoryState.profiles.delete(userId);
  memoryState.activity.delete(userId);
}

/** The store for a user: Postgres for real accounts, memory for the local dev viewer. */
export function profileStoreFor(userId: string, persisted: boolean): ProfileStore {
  const db = getDb();
  return persisted && db ? dbProfileStore(db, userId) : memoryProfileStore(userId);
}
