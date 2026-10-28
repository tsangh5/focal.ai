"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface TasteTag {
  name: string;
  affinity?: number;
}
interface TasteNode {
  id: string;
  name: string;
  type: string;
  strength: string;
  imageUrl?: string;
}
interface TasteEdge {
  from: string;
  to: string;
  affinity: number;
}
interface ContextResponse {
  tags: TasteTag[];
  nodes: TasteNode[];
  edges: TasteEdge[];
  summary: string | null;
  truncated?: boolean;
  reason?: string;
}

const SIZE = 320;
const R = 108;
const NODE_R = 22;

/**
 * Nodes on a circle, edges as chords. Deliberately deterministic rather than
 * force-directed: with a handful of nodes a stable ring is easier to read than
 * a layout that reshuffles on every load.
 *
 * One hue throughout — entity type is carried by the label, not colour. Taste
 * profiles span up to ten types, far past the point where categorical hues stay
 * distinguishable when any two nodes can sit adjacent.
 */
function GraphView({ nodes, edges }: { nodes: TasteNode[]; edges: TasteEdge[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const cx = SIZE / 2;
  const cy = SIZE / 2;

  const points = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    // Start at 12 o'clock so a two-node graph reads top/bottom.
    const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    points.set(n.id, { x: cx + Math.cos(angle) * R, y: cy + Math.sin(angle) * R });
  });

  const strongest = edges.length > 0 ? Math.max(...edges.map((e) => e.affinity)) : 1;

  return (
    <figure className="flex flex-col items-center gap-2">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-auto w-full max-w-[320px]"
        role="img"
        aria-label={`Affinity between ${nodes.map((n) => n.name).join(", ")}`}
      >
        <g>
          {edges.map((e) => {
            const a = points.get(e.from);
            const b = points.get(e.to);
            if (!a || !b) return null;
            const active = hover === null || hover === e.from || hover === e.to;
            // Normalise against the strongest edge so differences stay visible
            // even when every affinity sits in a narrow high band.
            const weight = e.affinity / strongest;
            return (
              <line
                key={`${e.from}-${e.to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--color-accent, #6E56CF)"
                strokeWidth={1 + weight * 3}
                strokeOpacity={active ? 0.25 + weight * 0.45 : 0.08}
                strokeLinecap="round"
              />
            );
          })}
        </g>
        <g>
          {nodes.map((n) => {
            const p = points.get(n.id);
            if (!p) return null;
            const dim = hover !== null && hover !== n.id && !edges.some(
              (e) => (e.from === n.id && e.to === hover) || (e.to === n.id && e.from === hover),
            );
            return (
              <g
                key={n.id}
                opacity={dim ? 0.35 : 1}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: "default" }}
              >
                {n.imageUrl ? (
                  <>
                    <defs>
                      <clipPath id={`clip-${n.id}`}>
                        <circle cx={p.x} cy={p.y} r={NODE_R} />
                      </clipPath>
                    </defs>
                    <image
                      href={n.imageUrl}
                      x={p.x - NODE_R}
                      y={p.y - NODE_R}
                      width={NODE_R * 2}
                      height={NODE_R * 2}
                      clipPath={`url(#clip-${n.id})`}
                      // Top-biased so a circular crop keeps faces, not chins.
                      preserveAspectRatio="xMidYMin slice"
                    />
                  </>
                ) : (
                  <circle cx={p.x} cy={p.y} r={NODE_R} fill="var(--color-surface-2, #27272a)" />
                )}
                {/* 2px surface ring keeps overlapping marks separable. */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={NODE_R}
                  fill="none"
                  stroke="var(--color-canvas, #09090b)"
                  strokeWidth={2}
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={NODE_R + 1}
                  fill="none"
                  stroke="var(--color-accent, #6E56CF)"
                  strokeOpacity={n.strength === "love" ? 0.9 : 0.35}
                  strokeWidth={n.strength === "love" ? 2 : 1}
                />
                <text
                  x={p.x}
                  y={p.y + NODE_R + 13}
                  textAnchor="middle"
                  className="fill-ink"
                  style={{ fontSize: 10, fontWeight: 500 }}
                >
                  {n.name.length > 16 ? `${n.name.slice(0, 15)}…` : n.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <figcaption className="text-center text-xs text-muted">
        Thicker lines are stronger Qloo affinity. A bold ring means you love it.
      </figcaption>
    </figure>
  );
}

export function TasteContext() {
  const [data, setData] = useState<ContextResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/taste-context", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not read your taste context.");
        return (await res.json()) as ContextResponse;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not read your taste context.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-destructive">{error}</p>;

  if (!data) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-6 w-2/3 rounded-md" />
      </div>
    );
  }

  if (data.nodes.length === 0) return null;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-ink">Taste context</h2>
        <p className="text-xs text-muted">How Qloo reads your tastes together.</p>
      </div>

      {data.summary ? <p className="text-sm leading-relaxed text-ink">{data.summary}</p> : null}

      {data.nodes.length > 1 && data.edges.length > 0 ? (
        <GraphView nodes={data.nodes} edges={data.edges} />
      ) : null}

      {data.tags.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Qloo tags</h3>
          <ul className="flex flex-wrap gap-1.5">
            {data.tags.map((tag) => (
              <li
                key={tag.name}
                className={cn(
                  "rounded-full border border-line px-2 py-0.5 text-xs",
                  (tag.affinity ?? 0) > 0.99 ? "bg-accent/10 text-accent" : "text-muted",
                )}
              >
                {tag.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.truncated ? (
        <p className="text-xs text-muted">Graph shows your first 6 things; tags use all of them.</p>
      ) : null}
    </section>
  );
}
