/**
 * Page rank pipeline v2 (spec §5.4–5.6), used by POST /api/page/rank and the
 * /try playground.
 *
 * identified items -> resolve (page type, city) -> signal selection -> ONE
 * insights call -> lift decision -> labels -> declarative plan.
 *
 * Unlike the Studio pipeline (pipeline.ts) the plan only lifts clear matches;
 * everything else keeps the site's order. A profile with no liked things or
 * vibes makes no Qloo calls and returns no plan. Search and insights are
 * injected so the package stays free of @focal-ai/qloo.
 */
import { buildLiftLabel, type LiftLabel } from "./labels";
import { decideLift, type LiftDecision, type LiftOptions, type LiftOutcome } from "./lift";
import { validatePlan } from "./plan";
import { resolveCandidates } from "./resolve";
import { selectSignals, type Signal, type SignalConfig, type SignalSelection } from "./signals";
import type { InsightType, ProfileV2 } from "./taste";
import type { CandidateScore, CoreSearchFn, RenderOp, RenderPlan, ResolutionStatus } from "./types";

const MIN_TAKE = 20;
const MAX_TAKE = 50;

export interface PageItem {
  clientId: string;
  name: string;
  originalIndex: number;
  /** Type identified for this card; items of another type than the page's are left alone. */
  type?: InsightType;
  city?: string;
}

export interface PageInsightsFn {
  (args: {
    resultType: InsightType;
    entitySignals: Signal[];
    tagSignals: Signal[];
    resultEntityIds: string[];
    locationQuery?: string;
    explainability: true;
    take: number;
  }): Promise<{
    scores: CandidateScore[];
    request?: { path: string; params: Record<string, string> };
  }>;
}

export interface PageRankArgs {
  pageId: string;
  pageType: InsightType;
  items: PageItem[];
  profile: ProfileV2;
  deps: { search: CoreSearchFn; insights: PageInsightsFn };
  locationQuery?: string;
  /** default "focal:results" */
  containerId?: string;
  signalConfig?: SignalConfig;
  liftOptions?: LiftOptions;
}

export interface PageResultItem {
  clientId: string;
  name: string;
  originalIndex: number;
  status: ResolutionStatus | "skipped";
  entityId?: string;
  entityName?: string;
  disambiguation?: string;
  affinity?: number;
  z?: number;
  outcome: LiftOutcome | "skipped";
  label?: LiftLabel;
  boosts?: string[];
  foldedBy?: string[];
}

export interface PageRankResult {
  status: "ranked" | "no_signals" | "nothing_scored";
  items: PageResultItem[];
  plan: RenderPlan | null;
  signals: SignalSelection;
  stats: LiftDecision["stats"];
  meta: {
    resolved: number;
    unresolved: number;
    insightsCalls: number;
    qlooRequest?: { path: string; params: Record<string, string> };
  };
}

export class PagePipelineError extends Error {
  code: "PLAN_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "PagePipelineError";
    this.code = "PLAN_INVALID";
  }
}

function foldLabel(count: number, ruleNames: string[]): string {
  const names = ruleNames.join(", ").replace(/[<>]/g, "");
  const label = `${count} hidden by your rules (${names})`;
  return label.length <= 140 ? label : `${count} hidden by your rules`;
}

/** Build the declarative plan for a lift decision, or null when nothing changes. */
export function planLift(args: {
  pageId: string;
  containerId?: string;
  decision: LiftDecision;
  labels: Map<string, LiftLabel>;
  unresolved?: number;
}): RenderPlan | null {
  const { pageId, decision, labels } = args;
  const containerId = args.containerId ?? "focal:results";
  const ops: RenderOp[] = [];

  if (decision.lifted.length > 0) ops.push({ op: "reorder", containerId, order: decision.order });
  for (const fold of decision.folds) {
    ops.push({
      op: "collapse",
      containerId,
      clientIds: fold.clientIds,
      label: foldLabel(fold.clientIds.length, fold.ruleNames),
    });
  }
  for (const clientId of decision.lifted) {
    const label = labels.get(clientId);
    if (label) ops.push({ op: "annotate", containerId, clientId, text: label.text, badge: label.badge });
  }
  for (const clientId of decision.lifted) {
    if (labels.get(clientId)?.badge === "top-pick") {
      ops.push({ op: "emphasize", containerId, clientId, level: "high" });
    }
  }
  if (ops.length === 0) return null;

  const position = new Map(decision.order.map((id, i) => [id, i]));
  const movement = decision.items.map((d) => Math.abs((position.get(d.clientId) ?? d.originalIndex) - d.originalIndex));
  const moved = movement.filter((m) => m > 0).length;
  const avgMovement =
    movement.length === 0 ? 0 : Math.round((movement.reduce((s, m) => s + m, 0) / movement.length) * 10) / 10;

  return {
    id: crypto.randomUUID(),
    pageId,
    createdAt: new Date().toISOString(),
    ops,
    summary: {
      moved,
      collapsed: decision.folds.reduce((s, f) => s + f.clientIds.length, 0),
      unresolved: args.unresolved ?? 0,
      avgMovement,
      lifted: decision.lifted.length,
    },
  };
}

export async function runPageRank(args: PageRankArgs): Promise<PageRankResult> {
  const { pageId, pageType, profile, deps, locationQuery, containerId } = args;
  const items = [...args.items].sort((a, b) => a.originalIndex - b.originalIndex);
  const signals = selectSignals(profile, pageType, args.signalConfig);

  const eligible = items.filter((i) => i.type === undefined || i.type === pageType);
  const skipped: PageResultItem[] = items
    .filter((i) => i.type !== undefined && i.type !== pageType)
    .map((i) => ({ clientId: i.clientId, name: i.name, originalIndex: i.originalIndex, status: "skipped", outcome: "skipped" }));

  const hasRules = profile.entries.some((e) => e.kind === "rule" && e.status === "active");
  if (signals.entities.length === 0 && signals.tags.length === 0 && !hasRules) {
    return {
      status: "no_signals",
      items: [
        ...eligible.map((i): PageResultItem => ({
          clientId: i.clientId,
          name: i.name,
          originalIndex: i.originalIndex,
          status: "unresolved",
          outcome: "unscored",
        })),
        ...skipped,
      ].sort((a, b) => a.originalIndex - b.originalIndex),
      plan: null,
      signals,
      stats: { scored: 0 },
      meta: { resolved: 0, unresolved: 0, insightsCalls: 0 },
    };
  }

  const resolved = await resolveCandidates(
    eligible.map((i) => ({
      clientId: i.clientId,
      name: i.name,
      originalIndex: i.originalIndex,
      ...(i.city !== undefined ? { locationText: i.city } : {}),
    })),
    deps.search,
    pageType,
    { location: locationQuery },
  );

  const resolvedIds = [
    ...new Set(
      resolved.flatMap((c) => (c.status === "resolved" && c.entity ? [c.entity.entityId] : [])),
    ),
  ];

  let scores: CandidateScore[] = [];
  let request: { path: string; params: Record<string, string> } | undefined;
  let insightsCalls = 0;
  if (resolvedIds.length > 0 && (signals.entities.length > 0 || signals.tags.length > 0)) {
    const response = await deps.insights({
      resultType: pageType,
      entitySignals: signals.entities,
      tagSignals: signals.tags,
      resultEntityIds: resolvedIds,
      ...(locationQuery !== undefined ? { locationQuery } : {}),
      explainability: true,
      take: Math.min(MAX_TAKE, Math.max(MIN_TAKE, resolvedIds.length)),
    });
    scores = response.scores;
    request = response.request;
    insightsCalls = 1;
  }
  const scoreById = new Map<string, CandidateScore>();
  for (const s of scores) if (!scoreById.has(s.entityId)) scoreById.set(s.entityId, s);

  const decision = decideLift({
    items: resolved.map((c) => {
      const isResolved = c.status === "resolved" && c.entity !== undefined;
      const score = isResolved ? scoreById.get(c.entity!.entityId) : undefined;
      return {
        clientId: c.clientId,
        originalIndex: c.originalIndex,
        ...(isResolved ? { entityId: c.entity!.entityId, tagIds: c.entity!.tagIds ?? [] } : {}),
        ...(score?.affinity !== undefined ? { affinity: score.affinity } : {}),
      };
    }),
    profile,
    localBoosts: signals.localBoosts,
    options: args.liftOptions,
  });

  const labels = new Map<string, LiftLabel>();
  const decisionById = new Map(decision.items.map((d) => [d.clientId, d]));
  for (const clientId of decision.lifted) {
    const d = decisionById.get(clientId);
    const c = resolved.find((r) => r.clientId === clientId);
    if (!d?.badge || !c?.entity) continue;
    labels.set(
      clientId,
      buildLiftLabel(
        d.badge,
        scoreById.get(c.entity.entityId)?.contributions,
        profile,
        d.favourite === "dislike" ? undefined : d.favourite,
      ),
    );
  }

  const unresolved = resolved.filter((c) => c.status === "unresolved").length;
  const plan = planLift({ pageId, containerId, decision, labels, unresolved });
  if (plan) {
    const validation = validatePlan(plan);
    if (!validation.ok) {
      throw new PagePipelineError(`plan validation failed (${validation.errors.length} errors)`);
    }
  }

  const resultItems: PageResultItem[] = resolved.map((c) => {
    const d = decisionById.get(c.clientId);
    const isResolved = c.status === "resolved" && c.entity !== undefined;
    const affinity = isResolved ? scoreById.get(c.entity!.entityId)?.affinity : undefined;
    const label = labels.get(c.clientId);
    return {
      clientId: c.clientId,
      name: c.name,
      originalIndex: c.originalIndex,
      status: c.status,
      ...(c.entity ? { entityId: c.entity.entityId, entityName: c.entity.name } : {}),
      ...(c.entity?.disambiguation ? { disambiguation: c.entity.disambiguation } : {}),
      ...(affinity !== undefined ? { affinity } : {}),
      ...(d?.z !== undefined ? { z: d.z } : {}),
      outcome: d?.outcome ?? "kept",
      ...(label ? { label } : {}),
      ...(d?.boosts ? { boosts: d.boosts } : {}),
      ...(d?.foldedBy ? { foldedBy: d.foldedBy } : {}),
    };
  });

  return {
    status: decision.stats.scored > 0 ? "ranked" : "nothing_scored",
    items: [...resultItems, ...skipped].sort((a, b) => a.originalIndex - b.originalIndex),
    plan,
    signals,
    stats: decision.stats,
    meta: {
      resolved: resolvedIds.length,
      unresolved,
      insightsCalls,
      ...(request !== undefined ? { qlooRequest: request } : {}),
    },
  };
}
