import type { LiftLabel, PageResultItem, RenderPlan, SignalSelection } from "@focal-ai/core";
import type { StoredPageResult } from "@/lib/server/page/store";

export interface WhyItem {
  clientId: string;
  name: string;
  originalPosition: number;
  finalPosition: number;
  /** Positions gained; positive means it moved up. */
  moved: number;
  status: PageResultItem["status"];
  outcome: PageResultItem["outcome"];
  entityName?: string;
  disambiguation?: string;
  affinity?: number;
  z?: number;
  label?: LiftLabel;
  boosts: string[];
  foldedBy: string[];
  /**
   * For products, the facets the score was summed from (§5.11). A product has
   * no entity to credit, so this is the whole explanation of its number.
   */
  facets: { tagId: string; tagName: string; valueName: string; affinity: number }[];
}

export interface WhyView {
  id: string;
  hostname: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  /** Page type as ranked; `product` pages are explained by facet, not entity. */
  pageType?: string;
  items: WhyItem[];
  signals: SignalSelection;
  stats: { scored: number; mean?: number; sd?: number };
  counts: { lifted: number; folded: number; disliked: number; resolved: number; unresolved: number };
  qlooRequest?: { path: string; params: Record<string, string> };
  durationMs?: number;
}

type Meta = Partial<{
  signals: SignalSelection;
  stats: WhyView["stats"];
  resolved: number;
  unresolved: number;
  pageType: string;
  qlooRequest: WhyView["qlooRequest"];
  durationMs: number;
}>;

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function finalOrder(items: PageResultItem[], plan: RenderPlan | null): string[] {
  const reorder = plan?.ops.find((op) => op.op === "reorder");
  const order = reorder?.op === "reorder" ? reorder.order : [];
  const known = new Set(items.map((i) => i.clientId));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of order) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const item of [...items].sort((a, b) => a.originalIndex - b.originalIndex)) {
    if (!seen.has(item.clientId)) out.push(item.clientId);
  }
  return out;
}

/** Shapes a stored page result for the "Why this order?" page, in the order the user saw. */
export function buildWhyView(row: StoredPageResult): WhyView {
  const items = Array.isArray(row.items) ? (row.items as PageResultItem[]) : [];
  const plan = row.plan && Array.isArray(asObject(row.plan).ops) ? (row.plan as RenderPlan) : null;
  const meta = asObject(row.meta) as Meta;
  const byId = new Map(items.map((i) => [i.clientId, i]));
  const order = finalOrder(items, plan);
  const liftedIdx = plan ? order.map((id) => byId.get(id)!).filter((i) => i.outcome === "lifted").map((i) => i.originalIndex) : [];
  // Positions on the page: lifted items go to the top, everything else shifts down past them.
  const pagePosition = (item: PageResultItem): number => {
    const rank = item.outcome === "lifted" ? liftedIdx.indexOf(item.originalIndex) : -1;
    return rank >= 0 ? rank + 1 : item.originalIndex + 1 + liftedIdx.filter((i) => i > item.originalIndex).length;
  };
  const view: WhyItem[] = order.map((id) => {
    const item = byId.get(id)!;
    const originalPosition = item.originalIndex + 1;
    const finalPosition = pagePosition(item);
    return {
      clientId: item.clientId,
      name: item.name,
      originalPosition,
      finalPosition,
      moved: originalPosition - finalPosition,
      status: item.status,
      outcome: item.outcome,
      ...(item.entityName ? { entityName: item.entityName } : {}),
      ...(item.disambiguation ? { disambiguation: item.disambiguation } : {}),
      ...(typeof item.affinity === "number" ? { affinity: item.affinity } : {}),
      ...(typeof item.z === "number" ? { z: item.z } : {}),
      ...(item.label ? { label: item.label } : {}),
      boosts: item.boosts ?? [],
      foldedBy: item.foldedBy ?? [],
      facets: item.facets ?? [],
    };
  });
  const count = (outcome: PageResultItem["outcome"]) => items.filter((i) => i.outcome === outcome).length;
  const signals = asObject(meta.signals);
  return {
    id: row.id,
    hostname: row.hostname,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    ...(typeof meta.pageType === "string" ? { pageType: meta.pageType } : {}),
    items: view,
    signals: {
      entities: Array.isArray(signals.entities) ? (signals.entities as SignalSelection["entities"]) : [],
      tags: Array.isArray(signals.tags) ? (signals.tags as SignalSelection["tags"]) : [],
      localBoosts: Array.isArray(signals.localBoosts) ? (signals.localBoosts as SignalSelection["localBoosts"]) : [],
    },
    stats: meta.stats ?? { scored: items.filter((i) => typeof i.affinity === "number").length },
    counts: {
      lifted: count("lifted"),
      folded: count("folded"),
      disliked: count("disliked"),
      resolved: meta.resolved ?? items.filter((i) => i.status === "resolved").length,
      unresolved: meta.unresolved ?? items.filter((i) => i.status === "unresolved").length,
    },
    ...(meta.qlooRequest ? { qlooRequest: meta.qlooRequest } : {}),
    ...(typeof meta.durationMs === "number" ? { durationMs: meta.durationMs } : {}),
  };
}
