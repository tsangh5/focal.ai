import { connect, type ConnectOptions, type Sql } from "./client";
import { extensionSessionsRepo } from "./sessions";
import { layoutsRepo, pageResultsRepo, profileRepo, resolutionsRepo, sitesRepo, usageRepo, usersRepo } from "./repos";

export * from "./types";
export { connect, type Sql, type ConnectOptions } from "./client";
export { migrate, loadMigrations, MIGRATIONS_DIR, type Migration } from "./migrate";
export { PAGE_RESULT_TTL_MS } from "./repos";
export { EXTENSION_SESSION_TTL_MS, hashToken, type ExtensionSession } from "./sessions";

export function createDb(sql: Sql) {
  return {
    sql,
    users: usersRepo(sql),
    profile: profileRepo(sql),
    sites: sitesRepo(sql),
    layouts: layoutsRepo(sql),
    usage: usageRepo(sql),
    resolutions: resolutionsRepo(sql),
    pageResults: pageResultsRepo(sql),
    extensionSessions: extensionSessionsRepo(sql),
    close: () => sql.end(),
  };
}

export type Db = ReturnType<typeof createDb>;

export function openDb(url: string, opts?: ConnectOptions): Db {
  return createDb(connect(url, opts));
}
