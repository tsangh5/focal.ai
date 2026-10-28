/**
 * Shared type definitions for @focal-ai/core.
 *
 * These mirror docs/contracts.md Block B exactly. This package is standalone:
 * it imports nothing from @focal-ai/qloo. The web/MCP layers adapt between the
 * two packages via the injected CoreSearchFn seam.
 */

export interface CoreEntity {
  entityId: string;
  name: string;
  subtype: string;
  disambiguation?: string;
  popularity?: number;
  tagIds?: string[];
  tagNames?: string[];
}

export type CoreSearchFn = (args: {
  query: string;
  types?: string[];
  location?: string;
}) => Promise<CoreEntity[]>;

export interface TasteSeed {
  entityId: string;
  name: string;
  subtype: string;
  disambiguation?: string;
  polarity: "like" | "dislike";
  weight: number;
  source: "typed" | "searched" | "agent";
  addedAt: string;
}

export interface ProfileRule {
  kind: "exclude" | "collapse" | "boost";
  match: { tagId?: string; brandId?: string; flag?: "sponsored" };
  weight?: number;
}

export interface TasteProfile {
  version: 1;
  updatedAt: string;
  seeds: TasteSeed[];
  rules: ProfileRule[];
}

export interface PageCandidate {
  clientId: string;
  name: string;
  locationText?: string;
  url?: string;
  originalIndex: number;
  sponsored?: boolean;
}

export type ResolutionStatus = "resolved" | "ambiguous" | "unresolved";

export interface ResolvedCandidate extends PageCandidate {
  status: ResolutionStatus;
  entity?: CoreEntity;
}

export interface CandidateScore {
  entityId: string;
  affinity?: number;
  rankIndex: number;
  contributions?: { entityId: string; score: number }[];
  tagNames?: string[];
}

export interface RankedCandidate extends ResolvedCandidate {
  position: number;
  affinity?: number;
  affinityPct?: number;
  scoreMeta?: { contributions?: { entityId: string; score: number }[]; tagNames?: string[] };
  reason?: { text: string; contributions?: { name: string; score: number }[]; tags?: string[] };
  ruleEffects?: { kind: ProfileRule["kind"]; label: string }[];
}

export type RenderOp =
  | { op: "reorder"; containerId: string; order: string[] }
  | { op: "collapse"; containerId: string; clientIds: string[]; label: string }
  | {
      op: "annotate";
      containerId: string;
      clientId: string;
      text: string;
      badge?: "top-pick" | "good-match" | "favourite";
    }
  | { op: "emphasize"; containerId: string; clientId: string; level: "high" }
  | { op: "hide"; containerId: string; clientIds: string[]; label: string };

export interface RenderPlan {
  id: string;
  pageId: string;
  createdAt: string;
  ops: RenderOp[];
  summary: { moved: number; collapsed: number; unresolved: number; avgMovement: number; lifted?: number };
}

/**
 * Return type of buildReason. `text` is `undefined` when no contribution can be
 * grounded in the profile — the UI renders its own neutral fallback. This is
 * intentionally a superset of RankedCandidate["reason"] so callers can branch
 * on `reason.text` without a cast.
 */
export interface BuiltReason {
  text: string | undefined;
  contributions?: { name: string; score: number }[];
  tags?: string[];
}
