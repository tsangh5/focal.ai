/**
 * Product page rank pipeline (spec §5.11), used by POST /api/page/rank when
 * the page type is `product`.
 *
 * described products + taste tags -> score -> lift decision -> labels -> plan
 *
 * The difference from `runPageRank` is the middle: there is no resolve step
 * and no insights call, because Qloo has no product entities to resolve to.
 * The taste tags arrive already weighted (one `tagAffinities` call per
 * profile, made by the caller and cacheable across pages), and scoring is
 * local and pure. Everything after the score — lift, folds, labels, plan — is
 * the same code the entity pipeline uses, so products behave like every other
 * list once they have a number.
 *
 * Matched facets carry real Qloo tag URNs, so hard rules fold products and
 * disliked vibes suppress them with no product-specific machinery.
 */
import { buildProductLiftLabel, type LiftLabel } from "./labels";
import { decideLift, type LiftItem, type LiftOptions } from "./lift";
import { PagePipelineError, planLift, type PageRankResult, type PageResultItem } from "./pagePipeline";
import { validatePlan } from "./plan";
import { scoreProducts, type DescribedProduct, type ProductScore, type TasteTag } from "./productScore";
import { activeRules, favouriteThings, type ProfileV2 } from "./taste";

export interface ProductRankArgs {
  pageId: string;
  items: DescribedProduct[];
  /** Weighted tag vocabulary for this profile, from Qloo `tagAffinities`. */
  tasteTags: TasteTag[];
  profile: ProfileV2;
  /** default "focal:results" */
  containerId?: string;
  liftOptions?: LiftOptions;
}

/** Items keep the page's order and nothing is planned. */
function emptyResult(
  status: PageRankResult["status"],
  items: DescribedProduct[],
  scores?: Map<string, ProductScore>,
): PageRankResult {
  return {
    status,
    items: items
      .map((p): PageResultItem => {
        const score = scores?.get(p.clientId);
        return {
          clientId: p.clientId,
          name: p.name,
          originalIndex: p.originalIndex,
          status: "unresolved",
          outcome: "unscored",
          ...(score ? { affinity: score.score } : {}),
        };
      })
      .sort((a, b) => a.originalIndex - b.originalIndex),
    plan: null,
    signals: { entities: [], tags: [], localBoosts: [] },
    stats: { scored: 0 },
    meta: { resolved: 0, unresolved: items.length, insightsCalls: 0 },
  };
}

export function runProductRank(args: ProductRankArgs): PageRankResult {
  const { pageId, profile, tasteTags, containerId } = args;
  const items = [...args.items].sort((a, b) => a.originalIndex - b.originalIndex);

  // A profile with nothing liked yields no taste tags, and rules alone can
  // still fold, so they are checked the same way the entity pipeline does.
  const hasRules = activeRules(profile).length > 0;
  if (favouriteThings(profile).length === 0 && !hasRules) return emptyResult("no_signals", items);

  const scores = scoreProducts(items, tasteTags);
  const scoreById = new Map(scores.map((s) => [s.clientId, s]));

  // Nothing on the page meant anything to this profile: the taste vocabulary
  // and the product vocabulary simply did not overlap. Say so rather than
  // reporting a ranked page with an empty plan.
  if (!hasRules && scores.every((s) => s.matches.length === 0)) {
    return emptyResult("nothing_scored", items, scoreById);
  }

  const liftItems: LiftItem[] = items.map((p) => {
    const score = scoreById.get(p.clientId);
    return {
      clientId: p.clientId,
      originalIndex: p.originalIndex,
      ...(score ? { affinity: score.score, tagIds: score.tagIds } : {}),
    };
  });

  const decision = decideLift({ items: liftItems, profile, options: args.liftOptions });
  const decisionById = new Map(decision.items.map((d) => [d.clientId, d]));

  const labels = new Map<string, LiftLabel>();
  for (const clientId of decision.lifted) {
    const badge = decisionById.get(clientId)?.badge;
    const matches = scoreById.get(clientId)?.matches;
    if (!badge || !matches) continue;
    labels.set(clientId, buildProductLiftLabel(badge, matches));
  }

  const unmatched = scores.filter((s) => s.matches.length === 0).length;
  const plan = planLift({ pageId, containerId, decision, labels, unresolved: unmatched });
  if (plan) {
    const validation = validatePlan(plan);
    if (!validation.ok) {
      throw new PagePipelineError(`plan validation failed (${validation.errors.length} errors)`);
    }
  }

  const resultItems: PageResultItem[] = items.map((p) => {
    const d = decisionById.get(p.clientId);
    const score = scoreById.get(p.clientId);
    const label = labels.get(p.clientId);
    return {
      clientId: p.clientId,
      name: p.name,
      originalIndex: p.originalIndex,
      status: score && score.matches.length > 0 ? "resolved" : "unresolved",
      ...(score ? { affinity: score.score } : {}),
      ...(d?.z !== undefined ? { z: d.z } : {}),
      outcome: d?.outcome ?? "kept",
      ...(label ? { label } : {}),
      ...(d?.foldedBy ? { foldedBy: d.foldedBy } : {}),
      ...(score && score.matches.length > 0
        ? {
            facets: score.matches.map((m) => ({
              tagId: m.tagId,
              tagName: m.tagName,
              valueName: m.valueName,
              affinity: m.affinity,
            })),
          }
        : {}),
    };
  });

  return {
    status: decision.stats.scored > 0 ? "ranked" : "nothing_scored",
    items: resultItems.sort((a, b) => a.originalIndex - b.originalIndex),
    plan,
    signals: { entities: [], tags: [], localBoosts: [] },
    stats: decision.stats,
    meta: { resolved: items.length - unmatched, unresolved: unmatched, insightsCalls: 0 },
  };
}
