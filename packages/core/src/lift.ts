/**
 * Lift-only decision (spec §5.6, decisions 11, 24, 25).
 *
 * Scores are compared within the page, because Qloo's affinity levels differ
 * by type. With at least `minScored` scored items, an item is lifted when its
 * z-score (affinity vs the page mean, in standard deviations, plus local vibe
 * boosts) is at least `sigma`; at most `maxLift` items, best first. Everything
 * else keeps the site's order.
 *
 * Never lifted: disliked things, items carrying a disliked vibe, and items
 * folded by an active hard rule. A hard rule folds an item only when Qloo has
 * the item tagged with the rule's tag. Pending rules do nothing.
 *
 * Things the user already loves or likes are lifted above the scored matches:
 * Qloo leaves signal entities out of its own results, so they come back with
 * no affinity and would otherwise sit unscored in the site's order.
 */
import type { Signal } from "./signals";
import { activeRules, type ProfileV2, type Strength, type VibeEntry } from "./taste";

export interface LiftItem {
  clientId: string;
  originalIndex: number;
  entityId?: string;
  affinity?: number;
  tagIds?: string[];
}

export interface LiftOptions {
  minScored?: number;
  sigma?: number;
  maxLift?: number;
  maxTopPicks?: number;
  /** Second and later items are top picks only at or above this z-score. */
  topPickSigma?: number;
  /** z-score added per matching local-boost vibe. */
  boost?: { love: number; like: number };
}

export const DEFAULT_LIFT_OPTIONS: Required<LiftOptions> = {
  minScored: 3,
  sigma: 1,
  maxLift: 5,
  maxTopPicks: 2,
  topPickSigma: 1.5,
  boost: { love: 0.5, like: 0.25 },
};

export type LiftOutcome = "lifted" | "kept" | "folded" | "disliked" | "unscored";
export type LiftBadge = "top-pick" | "good-match" | "favourite";

export interface LiftItemDecision {
  clientId: string;
  originalIndex: number;
  outcome: LiftOutcome;
  z?: number;
  effectiveZ?: number;
  badge?: LiftBadge;
  /** Set when the item is something the profile already loves or likes. */
  favourite?: Strength;
  /** Names of local-boost vibes that matched. */
  boosts?: string[];
  /** Names of the active rules that folded this item. */
  foldedBy?: string[];
}

export interface LiftFold {
  ruleNames: string[];
  clientIds: string[];
}

export interface LiftDecision {
  stats: { scored: number; mean?: number; sd?: number };
  items: LiftItemDecision[];
  /** Final order: lifted (best first) then everyone else in the site's order. */
  order: string[];
  lifted: string[];
  folds: LiftFold[];
}

/** Below this the page has no spread worth ranking on (guards float noise). */
const MIN_SD = 1e-9;

function meanAndSd(values: number[]): { mean: number; sd: number } {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
}

export function decideLift(args: {
  items: LiftItem[];
  profile: ProfileV2;
  localBoosts?: Signal[];
  options?: LiftOptions;
}): LiftDecision {
  const opts = { ...DEFAULT_LIFT_OPTIONS, ...args.options };
  const { profile } = args;
  const localBoosts = args.localBoosts ?? [];
  const byOriginal = [...args.items].sort((a, b) => a.originalIndex - b.originalIndex);

  const dislikedThings = new Set(
    profile.entries.filter((e) => e.kind === "thing" && e.strength === "dislike").map((e) => e.qlooId),
  );
  const dislikedVibes = new Set(
    profile.entries
      .filter((e): e is VibeEntry => e.kind === "vibe" && e.strength === "dislike")
      .map((e) => e.qlooId),
  );
  const favouredThings = new Map<string, Strength>(
    profile.entries
      .filter((e) => e.kind === "thing" && (e.strength === "love" || e.strength === "like"))
      .map((e) => [e.qlooId, e.strength as Strength]),
  );
  const rules = activeRules(profile);

  const scoredValues = byOriginal.flatMap((i) => (i.affinity !== undefined ? [i.affinity] : []));
  const canLift = scoredValues.length >= opts.minScored;
  const { mean, sd } = scoredValues.length > 0 ? meanAndSd(scoredValues) : { mean: undefined, sd: undefined };

  const decisions: LiftItemDecision[] = byOriginal.map((item) => {
    const tags = new Set(item.tagIds ?? []);
    const decision: LiftItemDecision = { clientId: item.clientId, originalIndex: item.originalIndex, outcome: "kept" };

    const foldedBy = rules.filter((r) => tags.has(r.qlooId)).map((r) => r.name);
    if (foldedBy.length > 0) {
      decision.outcome = "folded";
      decision.foldedBy = foldedBy;
    }

    if (item.affinity !== undefined && mean !== undefined && sd !== undefined && sd > MIN_SD) {
      decision.z = (item.affinity - mean) / sd;
      const boosts = localBoosts.filter((b) => tags.has(b.id));
      decision.effectiveZ = decision.z + boosts.reduce((s, b) => s + opts.boost[b.strength], 0);
      if (boosts.length > 0) decision.boosts = boosts.map((b) => b.name);
    }

    if (decision.outcome === "folded") return decision;
    if (
      (item.entityId !== undefined && dislikedThings.has(item.entityId)) ||
      [...tags].some((t) => dislikedVibes.has(t))
    ) {
      decision.outcome = "disliked";
      return decision;
    }
    const favourite = item.entityId !== undefined ? favouredThings.get(item.entityId) : undefined;
    if (favourite !== undefined) {
      decision.favourite = favourite;
      return decision;
    }
    if (item.affinity === undefined) decision.outcome = "unscored";
    return decision;
  });

  // Favourites need no page statistics: the user said so themselves. They lift
  // above the scored matches and take from the same `maxLift` budget.
  const favourites = decisions
    .filter((d) => d.outcome === "kept" && d.favourite !== undefined)
    .sort(
      (a, b) =>
        (a.favourite === b.favourite ? 0 : a.favourite === "love" ? -1 : 1) ||
        a.originalIndex - b.originalIndex,
    )
    .slice(0, Math.max(0, opts.maxLift));

  const scored = canLift
    ? decisions
        .filter(
          (d) =>
            d.outcome === "kept" &&
            d.favourite === undefined &&
            d.effectiveZ !== undefined &&
            d.effectiveZ >= opts.sigma,
        )
        .sort((a, b) => (b.effectiveZ ?? 0) - (a.effectiveZ ?? 0) || a.originalIndex - b.originalIndex)
        .slice(0, Math.max(0, opts.maxLift - favourites.length))
    : [];

  favourites.forEach((d) => {
    d.outcome = "lifted";
    d.badge = "favourite";
  });
  scored.forEach((d, index) => {
    d.outcome = "lifted";
    const topPick =
      index < opts.maxTopPicks && (index === 0 || (d.effectiveZ ?? 0) >= opts.topPickSigma);
    d.badge = topPick ? "top-pick" : "good-match";
  });
  const candidates = [...favourites, ...scored];

  const lifted = candidates.map((d) => d.clientId);
  const liftedSet = new Set(lifted);
  const order = [...lifted, ...decisions.filter((d) => !liftedSet.has(d.clientId)).map((d) => d.clientId)];

  const foldGroups = new Map<string, LiftFold>();
  for (const d of decisions) {
    if (d.outcome !== "folded" || !d.foldedBy) continue;
    const key = d.foldedBy.join("\u0000");
    const group = foldGroups.get(key) ?? { ruleNames: d.foldedBy, clientIds: [] };
    group.clientIds.push(d.clientId);
    foldGroups.set(key, group);
  }

  return {
    stats: {
      scored: scoredValues.length,
      ...(mean !== undefined ? { mean } : {}),
      ...(sd !== undefined ? { sd } : {}),
    },
    items: decisions,
    order,
    lifted,
    folds: [...foldGroups.values()],
  };
}
