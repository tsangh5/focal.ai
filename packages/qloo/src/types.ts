export type QlooEntityType =
  | "urn:entity:artist" | "urn:entity:book" | "urn:entity:brand"
  | "urn:entity:destination" | "urn:entity:movie" | "urn:entity:person"
  | "urn:entity:place" | "urn:entity:podcast" | "urn:entity:tv_show" | "urn:entity:videogame";

export interface QlooEntity {
  entityId: string;
  name: string;
  subtype: string;
  disambiguation?: string;
  popularity?: number;
  tagIds: string[];
  tagNames: string[];
  properties?: Record<string, unknown>;
  raw: unknown;
}

export interface SearchParams { query: string; types?: QlooEntityType[]; location?: string; take?: number; page?: number; }
export interface SearchResult { entities: QlooEntity[]; durationMs: number; raw: unknown; }

export interface InsightsParams {
  resultType: QlooEntityType;
  signalEntityIds: string[];
  /** Tag URNs sent as `signal.interests.tags` (verified to move scores, 2026-10-20). */
  signalTagIds?: string[];
  resultEntityIds?: string[];
  locationQuery?: string;
  explainability?: boolean;
  take?: number;
  /** `bias.trends`: nudges results toward what is trending. Live-verified
   *  2026-10-23 — only "low" | "medium" | "high"; numbers and booleans 400. */
  biasTrends?: "low" | "medium" | "high";
}
export interface ScoreContribution { entityId: string; score: number; }
export interface ScoredEntity {
  entity: QlooEntity;
  affinity?: number;
  affinityFoundAt?: string;
  rankIndex: number;
  contributions?: ScoreContribution[];
  explainabilityRaw?: unknown;
}
export interface InsightsResult { entities: ScoredEntity[]; aggregateExplainability?: unknown; durationMs: number; raw: unknown; }
export interface TagSearchResult { tags: { id: string; name: string; subtype?: string }[]; raw: unknown; }
export type DataSource = "live" | "mock";

export interface QlooClient {
  search(params: SearchParams): Promise<SearchResult>;
  insights(params: InsightsParams): Promise<InsightsResult>;
  tagAffinities(params: { signalEntityIds: string[]; take?: number }): Promise<TagAffinityResult>;
  searchTags(params: { query: string; take?: number }): Promise<TagSearchResult>;
  getEntities(entityIds: string[]): Promise<{ entities: QlooEntity[]; raw: unknown }>;
}

export interface TagAffinity {
  id: string;
  name: string;
  affinity?: number;
}
export interface TagAffinityResult { tags: TagAffinity[]; durationMs: number; raw: unknown; }

export type QlooErrorCode = "AUTH" | "RATE_LIMIT" | "BAD_REQUEST" | "NOT_FOUND" | "UPSTREAM" | "TIMEOUT" | "PARSE";
