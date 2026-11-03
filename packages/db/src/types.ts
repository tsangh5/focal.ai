/**
 * Stored shapes. Profile entries and activity events are the core v2 types
 * (`ProfileEntry`, `ActivityEvent` in @focal-ai/core); this package only
 * relies on the fields it indexes so it stays independent of core.
 */
export interface StoredEntry {
  id: string;
  kind: "thing" | "vibe" | "rule";
  qlooId: string;
  name: string;
  strength: "love" | "like" | "dislike" | "never";
  source: string;
  createdAt: string;
  status?: "pending" | "active";
  [key: string]: unknown;
}

export interface StoredEvent<E extends StoredEntry = StoredEntry> {
  id: string;
  actor: string;
  action: "add" | "remove" | "change" | "approve" | "undo";
  entryId: string;
  before?: E;
  after?: E;
  undoes?: string;
  at: string;
}

export interface ActivityRecord<E extends StoredEntry = StoredEntry> extends StoredEvent<E> {
  undoneBy: string | null;
}

export interface User {
  id: string;
  email: string;
  authIds: Record<string, string>;
  profileVersion: number;
  createdAt: string;
}

export type SiteMode = "skip" | "off" | "on";

export interface SiteSetting {
  hostname: string;
  mode: SiteMode;
}

export interface Layout {
  id: string;
  hostname: string;
  pathPattern: string;
  fingerprint: string;
  namePosition: unknown;
  type: string;
  citySource: unknown;
  confidence: number;
  learnedAt: string;
}

export interface ResolutionKey {
  normalizedName: string;
  type: string;
  city?: string;
}

export interface Resolution extends ResolutionKey {
  city: string;
  entityId: string | null;
  status: string;
  entity: unknown;
  updatedAt: string;
}

export interface PageResultRecord {
  id: string;
  userId: string;
  hostname: string;
  status: string;
  items: unknown;
  plan: unknown;
  meta: unknown;
  createdAt: string;
  expiresAt: string;
}

export class DbError extends Error {
  constructor(
    readonly code: "CONFLICT" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "DbError";
  }
}

/** What a free-tier counter meters: a ranked page, or a chat message. */
export type UsageKind = "rank" | "chat";
