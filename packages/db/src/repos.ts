import { json, toIso, type Sql } from "./client";
import {
  DbError,
  type UsageKind,
  type ActivityRecord,
  type Layout,
  type PageResultRecord,
  type Resolution,
  type ResolutionKey,
  type SiteMode,
  type SiteSetting,
  type StoredEntry,
  type StoredEvent,
  type User,
} from "./types";

type Row = Record<string, unknown>;

const userFrom = (r: Row): User => ({
  id: r.id as string,
  email: r.email as string,
  authIds: (r.auth_ids ?? {}) as Record<string, string>,
  profileVersion: r.profile_version as number,
  createdAt: toIso(r.created_at as Date)!,
});

export function usersRepo(sql: Sql) {
  return {
    /** Finds or creates the user for an email; merges provider ids. */
    async upsert(email: string, authIds: Record<string, string> = {}): Promise<User> {
      const [row] = await sql`
        INSERT INTO users (email, auth_ids) VALUES (${email.trim()}, ${json(sql, authIds)})
        ON CONFLICT (lower(email)) DO UPDATE SET auth_ids = users.auth_ids || EXCLUDED.auth_ids
        RETURNING *`;
      return userFrom(row!);
    },
    async get(id: string): Promise<User | null> {
      const [row] = await sql`SELECT * FROM users WHERE id = ${id}`;
      return row ? userFrom(row) : null;
    },
    /** Finds the user linked to an identity provider's user id, e.g. ("workos", "user_…"). */
    async byAuthId(provider: string, id: string): Promise<User | null> {
      const [row] = await sql`SELECT * FROM users WHERE auth_ids->>${provider} = ${id} LIMIT 1`;
      return row ? userFrom(row) : null;
    },
    async byEmail(email: string): Promise<User | null> {
      const [row] = await sql`SELECT * FROM users WHERE lower(email) = lower(${email.trim()})`;
      return row ? userFrom(row) : null;
    },
    /** Deletes the account and everything owned by it (profile, activity, settings, page results). */
    async delete(id: string): Promise<boolean> {
      const rows = await sql`DELETE FROM users WHERE id = ${id} RETURNING id`;
      return rows.length > 0;
    },
  };
}

const eventFrom = <E extends StoredEntry>(r: Row): ActivityRecord<E> => ({
  id: r.id as string,
  actor: r.actor as string,
  action: r.action as StoredEvent["action"],
  entryId: r.entry_id as string,
  ...(r.before ? { before: r.before as E } : {}),
  ...(r.after ? { after: r.after as E } : {}),
  ...(r.undoes ? { undoes: r.undoes as string } : {}),
  at: toIso(r.at as Date)!,
  undoneBy: (r.undone_by as string | null) ?? null,
});

export function profileRepo(sql: Sql) {
  return {
    async load<E extends StoredEntry = StoredEntry>(userId: string): Promise<{ version: number; entries: E[] }> {
      const [user] = await sql`SELECT profile_version FROM users WHERE id = ${userId}`;
      if (!user) throw new DbError("NOT_FOUND", `user ${userId} not found`);
      const rows = await sql`SELECT data FROM profile_entries WHERE user_id = ${userId} ORDER BY created_at, id`;
      return { version: user.profile_version as number, entries: rows.map((r) => r.data as E) };
    },

    /**
     * Persists one core profile write: the entry becomes `event.after`
     * (deleted when absent) and the event is appended to the activity log, in
     * one transaction. `expectedVersion` guards against concurrent writers
     * (chat and MCP at once); a mismatch throws CONFLICT and nothing changes.
     */
    async commit(userId: string, event: StoredEvent, expectedVersion?: number): Promise<number> {
      return sql.begin(async (tx) => {
        const [user] = await tx`SELECT profile_version FROM users WHERE id = ${userId} FOR UPDATE`;
        if (!user) throw new DbError("NOT_FOUND", `user ${userId} not found`);
        if (expectedVersion !== undefined && user.profile_version !== expectedVersion) {
          throw new DbError("CONFLICT", `profile version is ${user.profile_version}, expected ${expectedVersion}`);
        }
        const after = event.after;
        if (after) {
          if (after.id !== event.entryId) throw new DbError("CONFLICT", "event.after.id must equal event.entryId");
          const [owner] = await tx`SELECT user_id FROM profile_entries WHERE id = ${after.id}`;
          if (owner && owner.user_id !== userId) throw new DbError("CONFLICT", `entry ${after.id} belongs to another user`);
          await tx`
            INSERT INTO profile_entries (id, user_id, kind, qloo_id, strength, status, source, data, created_at, updated_at)
            VALUES (${after.id}, ${userId}, ${after.kind}, ${after.qlooId}, ${after.strength}, ${after.status ?? null},
                    ${after.source}, ${json(tx as unknown as Sql, after)}, ${after.createdAt}, ${event.at})
            ON CONFLICT (id) DO UPDATE SET
              kind = EXCLUDED.kind, qloo_id = EXCLUDED.qloo_id, strength = EXCLUDED.strength,
              status = EXCLUDED.status, source = EXCLUDED.source, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`;
        } else {
          await tx`DELETE FROM profile_entries WHERE id = ${event.entryId} AND user_id = ${userId}`;
        }
        await tx`
          INSERT INTO activity_events (id, user_id, actor, action, entry_id, before, after, undoes, at)
          VALUES (${event.id}, ${userId}, ${event.actor}, ${event.action}, ${event.entryId},
                  ${event.before ? json(tx as unknown as Sql, event.before) : null},
                  ${event.after ? json(tx as unknown as Sql, event.after) : null},
                  ${event.undoes ?? null}, ${event.at})`;
        if (event.undoes) {
          const marked = await tx`
            UPDATE activity_events SET undone_by = ${event.id}
            WHERE id = ${event.undoes} AND user_id = ${userId} AND undone_by IS NULL RETURNING id`;
          if (marked.length === 0) throw new DbError("CONFLICT", `event ${event.undoes} is not undoable`);
        }
        const [next] = await tx`
          UPDATE users SET profile_version = profile_version + 1 WHERE id = ${userId} RETURNING profile_version`;
        return next!.profile_version as number;
      });
    },

    async activity<E extends StoredEntry = StoredEntry>(
      userId: string,
      opts: { limit?: number; before?: string } = {},
    ): Promise<ActivityRecord<E>[]> {
      const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
      const rows = opts.before
        ? await sql`SELECT * FROM activity_events WHERE user_id = ${userId} AND at < ${opts.before} ORDER BY at DESC, id DESC LIMIT ${limit}`
        : await sql`SELECT * FROM activity_events WHERE user_id = ${userId} ORDER BY at DESC, id DESC LIMIT ${limit}`;
      return rows.map((r) => eventFrom<E>(r));
    },

    async event<E extends StoredEntry = StoredEntry>(userId: string, id: string): Promise<ActivityRecord<E> | null> {
      const [row] = await sql`SELECT * FROM activity_events WHERE user_id = ${userId} AND id = ${id}`;
      return row ? eventFrom<E>(row) : null;
    },

    /** Full export: account, profile entries, settings and activity. */
    async export(userId: string) {
      const [user] = await sql`SELECT * FROM users WHERE id = ${userId}`;
      if (!user) throw new DbError("NOT_FOUND", `user ${userId} not found`);
      const entries = await sql`SELECT data FROM profile_entries WHERE user_id = ${userId} ORDER BY created_at, id`;
      const events = await sql`SELECT * FROM activity_events WHERE user_id = ${userId} ORDER BY at, id`;
      const sites = await sql`SELECT hostname, mode FROM site_settings WHERE user_id = ${userId} ORDER BY hostname`;
      return {
        user: userFrom(user),
        profile: { version: 2 as const, entries: entries.map((r) => r.data as StoredEntry) },
        activity: events.map((r) => eventFrom(r)),
        sites: sites.map((r) => ({ hostname: r.hostname as string, mode: r.mode as SiteMode })),
      };
    },
  };
}

export function sitesRepo(sql: Sql) {
  return {
    async list(userId: string): Promise<SiteSetting[]> {
      const rows = await sql`SELECT hostname, mode FROM site_settings WHERE user_id = ${userId} ORDER BY hostname`;
      return rows.map((r) => ({ hostname: r.hostname as string, mode: r.mode as SiteMode }));
    },
    async set(userId: string, hostname: string, mode: SiteMode): Promise<void> {
      await sql`
        INSERT INTO site_settings (user_id, hostname, mode) VALUES (${userId}, ${hostname.toLowerCase()}, ${mode})
        ON CONFLICT (user_id, hostname) DO UPDATE SET mode = EXCLUDED.mode, updated_at = now()`;
    },
    async remove(userId: string, hostname: string): Promise<void> {
      await sql`DELETE FROM site_settings WHERE user_id = ${userId} AND hostname = ${hostname.toLowerCase()}`;
    },
  };
}

const layoutFrom = (r: Row): Layout => ({
  id: r.id as string,
  hostname: r.hostname as string,
  pathPattern: r.path_pattern as string,
  fingerprint: r.fingerprint as string,
  namePosition: r.name_position,
  type: r.type as string,
  citySource: r.city_source ?? null,
  confidence: r.confidence as number,
  learnedAt: toIso(r.learned_at as Date)!,
});

export function layoutsRepo(sql: Sql) {
  return {
    async find(hostname: string, pathPattern: string, fingerprint: string): Promise<Layout | null> {
      const [row] = await sql`
        SELECT * FROM layouts WHERE hostname = ${hostname} AND path_pattern = ${pathPattern} AND fingerprint = ${fingerprint}`;
      return row ? layoutFrom(row) : null;
    },
    async forHost(hostname: string): Promise<Layout[]> {
      const rows = await sql`SELECT * FROM layouts WHERE hostname = ${hostname} ORDER BY learned_at DESC`;
      return rows.map(layoutFrom);
    },
    /** Saves a learned layout; a re-learn replaces it only with equal or higher confidence. */
    async save(l: Omit<Layout, "id" | "learnedAt">): Promise<Layout> {
      const [row] = await sql`
        INSERT INTO layouts (hostname, path_pattern, fingerprint, name_position, type, city_source, confidence)
        VALUES (${l.hostname}, ${l.pathPattern}, ${l.fingerprint}, ${json(sql, l.namePosition)}, ${l.type},
                ${l.citySource == null ? null : json(sql, l.citySource)}, ${l.confidence})
        ON CONFLICT (hostname, path_pattern, fingerprint) DO UPDATE SET
          name_position = EXCLUDED.name_position, type = EXCLUDED.type, city_source = EXCLUDED.city_source,
          confidence = EXCLUDED.confidence, learned_at = now()
        WHERE layouts.confidence <= EXCLUDED.confidence
        RETURNING *`;
      return row ? layoutFrom(row) : (await this.find(l.hostname, l.pathPattern, l.fingerprint))!;
    },
  };
}

const resolutionFrom = (r: Row): Resolution => ({
  normalizedName: r.normalized_name as string,
  type: r.type as string,
  city: r.city as string,
  entityId: (r.entity_id as string | null) ?? null,
  status: r.status as string,
  entity: r.entity ?? null,
  updatedAt: toIso(r.updated_at as Date)!,
});

export function resolutionsRepo(sql: Sql) {
  return {
    /** Batch lookup; callers normalize names the same way the core resolver does. */
    async getMany(keys: ResolutionKey[], maxAgeMs?: number): Promise<Resolution[]> {
      if (keys.length === 0) return [];
      const names = keys.map((k) => k.normalizedName);
      const types = keys.map((k) => k.type);
      const cities = keys.map((k) => k.city ?? "");
      const since = maxAgeMs === undefined ? null : new Date(Date.now() - maxAgeMs).toISOString();
      const rows = await sql`
        SELECT c.* FROM resolution_cache c
        JOIN unnest(${names}::text[], ${types}::text[], ${cities}::text[]) AS k(n, t, ci)
          ON c.normalized_name = k.n AND c.type = k.t AND c.city = k.ci
        WHERE ${since}::timestamptz IS NULL OR c.updated_at >= ${since}::timestamptz`;
      return rows.map(resolutionFrom);
    },
    async put(entries: (ResolutionKey & { entityId: string | null; status: string; entity?: unknown })[]): Promise<void> {
      if (entries.length === 0) return;
      await sql.begin(async (tx) => {
        for (const e of entries) {
          await tx`
            INSERT INTO resolution_cache (normalized_name, type, city, entity_id, status, entity)
            VALUES (${e.normalizedName}, ${e.type}, ${e.city ?? ""}, ${e.entityId}, ${e.status},
                    ${e.entity == null ? null : json(tx as unknown as Sql, e.entity)})
            ON CONFLICT (normalized_name, type, city) DO UPDATE SET
              entity_id = EXCLUDED.entity_id, status = EXCLUDED.status, entity = EXCLUDED.entity, updated_at = now()`;
        }
      });
    },
  };
}

export const PAGE_RESULT_TTL_MS = 24 * 60 * 60 * 1000;

const pageResultFrom = (r: Row): PageResultRecord => ({
  id: r.id as string,
  userId: r.user_id as string,
  hostname: r.hostname as string,
  status: r.status as string,
  items: r.items,
  plan: r.plan ?? null,
  meta: r.meta ?? null,
  createdAt: toIso(r.created_at as Date)!,
  expiresAt: toIso(r.expires_at as Date)!,
});

export function pageResultsRepo(sql: Sql) {
  return {
    async save(
      r: Pick<PageResultRecord, "id" | "userId" | "hostname" | "status" | "items" | "plan" | "meta">,
      ttlMs = PAGE_RESULT_TTL_MS,
    ): Promise<PageResultRecord> {
      const expires = new Date(Date.now() + ttlMs).toISOString();
      const [row] = await sql`
        INSERT INTO page_results (id, user_id, hostname, status, items, plan, meta, expires_at)
        VALUES (${r.id}, ${r.userId}, ${r.hostname}, ${r.status}, ${json(sql, r.items)},
                ${r.plan == null ? null : json(sql, r.plan)}, ${r.meta == null ? null : json(sql, r.meta)}, ${expires})
        RETURNING *`;
      return pageResultFrom(row!);
    },
    /** Only the owner can read a page result, and only until it expires. */
    async get(id: string, userId: string): Promise<PageResultRecord | null> {
      const [row] = await sql`
        SELECT * FROM page_results WHERE id = ${id} AND user_id = ${userId} AND expires_at > now()`;
      return row ? pageResultFrom(row) : null;
    },
    async purgeExpired(): Promise<number> {
      const rows = await sql`DELETE FROM page_results WHERE expires_at <= now() RETURNING id`;
      return rows.length;
    },
  };
}

/**
 * Free-tier counters. Only incremented when a request used the project's own
 * key: a caller who brought their own is not metered, since it costs us
 * nothing.
 */
export function usageRepo(sql: Sql) {
  return {
    async get(userId: string, kind: UsageKind): Promise<number> {
      const [row] = await sql`SELECT used FROM usage_counters WHERE user_id = ${userId} AND kind = ${kind}`;
      return row ? (row.used as number) : 0;
    },
    /** Counts one use and returns the new total, atomically. */
    async bump(userId: string, kind: UsageKind): Promise<number> {
      const [row] = await sql`
        INSERT INTO usage_counters (user_id, kind, used) VALUES (${userId}, ${kind}, 1)
        ON CONFLICT (user_id, kind) DO UPDATE SET used = usage_counters.used + 1, updated_at = now()
        RETURNING used`;
      return (row?.used as number) ?? 0;
    },
    async all(userId: string): Promise<Record<UsageKind, number>> {
      const rows = await sql`SELECT kind, used FROM usage_counters WHERE user_id = ${userId}`;
      const out: Record<UsageKind, number> = { rank: 0, chat: 0 };
      for (const r of rows) out[r.kind as UsageKind] = r.used as number;
      return out;
    },
  };
}
