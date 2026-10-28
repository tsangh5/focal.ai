/**
 * Render-plan compiler and validator.
 *
 * planRender emits ops in a fixed order: reorder (ALL clientIds, nothing is
 * lost), sponsored collapse, hidden-by-rules collapse, annotations, then
 * emphasizes. The plan id is a fresh UUID and createdAt an ISO timestamp, so
 * the structure — not the identity — is deterministic.
 *
 * validatePlan collects EVERY violation (it never stops at the first) and
 * enforces: non-empty ops with known op values, containerIds matching
 * /^focal:[a-z0-9-]+$/i, non-empty reorder.order / collapse.clientIds, annotate
 * text as plain text of at most 140 characters with no "<" (XSS guard),
 * emphasize level "high", and referential integrity (when the plan contains a
 * reorder op defining a candidate universe, every clientId referenced by an op
 * must exist in it).
 */
import type { RankedCandidate, RenderOp, RenderPlan } from "./types";

const CONTAINER_ID_RE = /^focal:[a-z0-9-]+$/i;
const KNOWN_OPS = new Set(["reorder", "collapse", "annotate", "emphasize", "hide"]);
const MAX_ANNOTATION_LENGTH = 140;

export function planRender(args: {
  pageId: string;
  ranked: RankedCandidate[];
  options?: {
    annotate?: boolean;
    emphasizeThreshold?: number;
    collapseSponsored?: boolean;
    containerId?: string;
  };
}): RenderPlan {
  const { pageId, ranked } = args;
  const options = args.options ?? {};
  const containerId = options.containerId ?? "focal:results";

  const ops: RenderOp[] = [];
  ops.push({ op: "reorder", containerId, order: ranked.map((r) => r.clientId) });

  const collapsed = new Set<string>();

  if (options.collapseSponsored !== false) {
    const sponsored = ranked
      .filter((r) => r.sponsored === true && !collapsed.has(r.clientId))
      .map((r) => r.clientId);
    if (sponsored.length > 0) {
      ops.push({
        op: "collapse",
        containerId,
        clientIds: sponsored,
        label: `${sponsored.length} sponsored results collapsed`,
      });
      for (const id of sponsored) collapsed.add(id);
    }
  }

  const hidden = ranked
    .filter(
      (r) =>
        !collapsed.has(r.clientId) &&
        (r.ruleEffects ?? []).some((e) => e.kind === "exclude" || e.kind === "collapse"),
    )
    .map((r) => r.clientId);
  if (hidden.length > 0) {
    ops.push({
      op: "collapse",
      containerId,
      clientIds: hidden,
      label: `${hidden.length} hidden by your rules`,
    });
    for (const id of hidden) collapsed.add(id);
  }

  if (options.annotate !== false) {
    for (const r of ranked) {
      if (r.status === "resolved" && r.affinityPct !== undefined) {
        ops.push({
          op: "annotate",
          containerId,
          clientId: r.clientId,
          text: `${r.affinityPct}% match`,
        });
      }
    }
  }

  const emphasizeThreshold = options.emphasizeThreshold ?? 85;
  for (const r of ranked) {
    if (r.status === "resolved" && r.affinityPct !== undefined && r.affinityPct >= emphasizeThreshold) {
      ops.push({ op: "emphasize", containerId, clientId: r.clientId, level: "high" });
    }
  }

  const moved = ranked.filter((r) => r.position !== r.originalIndex).length;
  const unresolved = ranked.filter((r) => r.status === "unresolved").length;
  const avgMovement =
    ranked.length === 0
      ? 0
      : Math.round(
          (ranked.reduce((sum, r) => sum + Math.abs(r.position - r.originalIndex), 0) /
            ranked.length) *
            10,
        ) / 10;

  return {
    id: crypto.randomUUID(),
    pageId,
    createdAt: new Date().toISOString(),
    ops,
    summary: { moved, collapsed: collapsed.size, unresolved, avgMovement },
  };
}

export function validatePlan(
  plan: RenderPlan,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const ops: unknown = (plan as { ops?: unknown } | null | undefined)?.ops;

  if (!Array.isArray(ops) || ops.length === 0) {
    errors.push("plan.ops must be a non-empty array");
    return { ok: false, errors };
  }

  const isString = (value: unknown): value is string => typeof value === "string";

  ops.forEach((rawOp, index) => {
    if (rawOp === null || typeof rawOp !== "object") {
      errors.push(`ops[${index}] must be an object`);
      return;
    }
    const op = rawOp as Record<string, unknown>;
    const kind = op.op;
    if (!isString(kind) || !KNOWN_OPS.has(kind)) {
      errors.push(`ops[${index}] has unknown op ${JSON.stringify(kind)}`);
    }
    if (!isString(op.containerId) || !CONTAINER_ID_RE.test(op.containerId)) {
      errors.push(
        `ops[${index}] containerId must match /^focal:[a-z0-9-]+$/i (got ${JSON.stringify(op.containerId)})`,
      );
    }
    switch (kind) {
      case "reorder":
        if (!Array.isArray(op.order) || op.order.length === 0 || !op.order.every(isString)) {
          errors.push(`ops[${index}] reorder.order must be a non-empty array of strings`);
        }
        break;
      case "collapse":
      case "hide":
        if (
          !Array.isArray(op.clientIds) ||
          op.clientIds.length === 0 ||
          !op.clientIds.every(isString)
        ) {
          errors.push(`ops[${index}] ${kind}.clientIds must be a non-empty array of strings`);
        }
        break;
      case "annotate":
        if (!isString(op.clientId)) {
          errors.push(`ops[${index}] annotate.clientId must be a string`);
        }
        if (!isString(op.text)) {
          errors.push(`ops[${index}] annotate.text must be a string`);
        } else {
          if (op.text.length > MAX_ANNOTATION_LENGTH) {
            errors.push(`ops[${index}] annotate.text exceeds ${MAX_ANNOTATION_LENGTH} characters`);
          }
          if (op.text.includes("<")) {
            errors.push(`ops[${index}] annotate.text must not contain "<"`);
          }
        }
        if (
          op.badge !== undefined &&
          op.badge !== "top-pick" &&
          op.badge !== "good-match" &&
          op.badge !== "favourite"
        ) {
          errors.push(`ops[${index}] annotate.badge must be "top-pick", "good-match" or "favourite"`);
        }
        break;
      case "emphasize":
        if (!isString(op.clientId)) {
          errors.push(`ops[${index}] emphasize.clientId must be a string`);
        }
        if (op.level !== "high") {
          errors.push(`ops[${index}] emphasize.level must be "high"`);
        }
        break;
    }
  });

  // Referential integrity (docs/contracts.md Block B): when a reorder op
  // defines the candidate universe, every clientId referenced by other ops
  // must exist in it. Plans without a reorder op have no universe to check
  // against and are limited to the op-level rules above.
  const universe = new Set<string>();
  for (const rawOp of ops) {
    const op = rawOp as Record<string, unknown> | null;
    if (op && op.op === "reorder" && Array.isArray(op.order) && op.order.length > 0) {
      for (const id of op.order) if (isString(id)) universe.add(id);
    }
  }

  const checkReferenced = (index: number, label: string, id: unknown) => {
    if (universe.size === 0) return;
    if (isString(id) && !universe.has(id)) {
      errors.push(`ops[${index}] ${label} references unknown clientId ${JSON.stringify(id)}`);
    }
  };

  ops.forEach((rawOp, index) => {
    const op = rawOp as Record<string, unknown> | null;
    if (!op || typeof op !== "object") return;
    switch (op.op) {
      case "annotate":
      case "emphasize":
        checkReferenced(index, String(op.op), op.clientId);
        break;
      case "collapse":
      case "hide":
        if (Array.isArray(op.clientIds)) {
          for (const id of op.clientIds) checkReferenced(index, String(op.op), id);
        }
        break;
    }
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
