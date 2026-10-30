"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface TasteTag {
  name: string;
  affinity?: number;
}
interface TasteNode {
  id: string;
  name: string;
  /** Short type name, which is also the cluster the node sits in. */
  type: string;
  strength: string;
  imageUrl?: string;
  /** How well the rest of the profile predicts this entry, 0..1. */
  affinity?: number;
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
  reason?: string;
}

const SIZE = 640;
const NODE_R = 15;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 6;

/** Cluster rings scale with how many nodes they hold, so big clusters do not overlap. */
function clusterRadius(count: number): number {
  return count <= 1 ? 0 : Math.max(34, 13 * Math.sqrt(count) + count * 1.6);
}

interface Placed extends TasteNode {
  x: number;
  y: number;
}

/**
 * Clusters by entity type, laid out deterministically: one ring of clusters,
 * each a ring of its own nodes.
 *
 * Not force-directed on purpose. A simulation reshuffles on every load, so the
 * same taste never looks the same twice and nothing is learnable; a fixed
 * layout means a node stays where the reader last saw it.
 */
function layout(nodes: TasteNode[]): { placed: Placed[]; clusters: { type: string; x: number; y: number; r: number }[] } {
  const byType = new Map<string, TasteNode[]>();
  for (const n of nodes) byType.set(n.type, [...(byType.get(n.type) ?? []), n]);
  const types = [...byType.keys()].sort();
  const c = SIZE / 2;
  // One cluster sits in the middle; more spread around a ring wide enough for
  // the largest of them.
  const spread = types.length === 1 ? 0 : Math.max(...types.map((t) => clusterRadius(byType.get(t)!.length))) + 92;

  const placed: Placed[] = [];
  const clusters: { type: string; x: number; y: number; r: number }[] = [];
  types.forEach((type, i) => {
    const angle = (i / types.length) * Math.PI * 2 - Math.PI / 2;
    const cx = c + Math.cos(angle) * spread;
    const cy = c + Math.sin(angle) * spread;
    const members = byType.get(type)!;
    const r = clusterRadius(members.length);
    clusters.push({ type, x: cx, y: cy, r: r + NODE_R + 10 });
    members.forEach((n, j) => {
      if (members.length === 1) {
        placed.push({ ...n, x: cx, y: cy });
        return;
      }
      // Two rings once a cluster outgrows one, so nodes keep their spacing.
      const perRing = Math.ceil(members.length / (members.length > 8 ? 2 : 1));
      const ring = Math.floor(j / perRing);
      const idxInRing = j % perRing;
      const countInRing = Math.min(perRing, members.length - ring * perRing);
      const a = (idxInRing / countInRing) * Math.PI * 2 - Math.PI / 2;
      const rr = r * (ring === 0 ? 1 : 0.52);
      placed.push({ ...n, x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
    });
  });
  return { placed, clusters };
}

function GraphView({ nodes, edges }: { nodes: TasteNode[]; edges: TasteEdge[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { placed, clusters } = useMemo(() => layout(nodes), [nodes]);
  const at = useMemo(() => new Map(placed.map((n) => [n.id, n])), [placed]);
  const strongest = edges.length > 0 ? Math.max(...edges.map((e) => e.affinity)) : 1;

  // Which nodes the hovered one is linked to, so the rest can recede.
  const linked = useMemo(() => {
    if (!hover) return null;
    const set = new Set<string>([hover]);
    for (const e of edges) {
      if (e.from === hover) set.add(e.to);
      if (e.to === hover) set.add(e.from);
    }
    return set;
  }, [hover, edges]);

  function zoomBy(factor: number, originX = SIZE / 2, originY = SIZE / 2) {
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
      if (k === v.k) return v;
      // Keep the point under the cursor fixed while the scale changes.
      return { k, x: originX - ((originX - v.x) * k) / v.k, y: originY - ((originY - v.y) * k) / v.k };
    });
  }

  /** Pointer position in the SVG's own coordinates, not the page's. */
  function localPoint(e: React.PointerEvent | React.WheelEvent): { x: number; y: number } {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return { x: SIZE / 2, y: SIZE / 2 };
    return { x: ((e.clientX - box.left) / box.width) * SIZE, y: ((e.clientY - box.top) / box.height) * SIZE };
  }

  return (
    <figure className="flex flex-col items-center gap-2">
      <div className="relative w-full overflow-hidden rounded-xl border border-line bg-canvas">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          // CSS handles the grabbing cursor: reading the drag ref during
          // render is both a lint error and a frame behind the pointer.
          className="h-auto w-full cursor-grab touch-none select-none active:cursor-grabbing"
          role="img"
          aria-label={`Your taste as a graph: ${nodes.length} things in ${clusters.length} groups, linked by Qloo affinity`}
          onWheel={(e) => {
            const p = localPoint(e);
            zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y);
          }}
          onPointerDown={(e) => {
            const p = localPoint(e);
            drag.current = { x: p.x, y: p.y, vx: view.x, vy: view.y };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const p = localPoint(e);
            setView((v) => ({ ...v, x: drag.current!.vx + (p.x - drag.current!.x), y: drag.current!.vy + (p.y - drag.current!.y) }));
          }}
          onPointerUp={(e) => {
            drag.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {/* Cluster hulls first, so they read as background. */}
            {clusters.map((c) => (
              <g key={c.type}>
                <circle cx={c.x} cy={c.y} r={c.r} fill="var(--color-surface, #18181b)" fillOpacity={0.5} />
                <circle cx={c.x} cy={c.y} r={c.r} fill="none" stroke="var(--color-line, #27272a)" strokeDasharray="3 4" />
                <text
                  x={c.x}
                  y={c.y - c.r - 6}
                  textAnchor="middle"
                  className="fill-muted"
                  style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 }}
                >
                  {c.type}
                </text>
              </g>
            ))}

            {edges.map((e) => {
              const a = at.get(e.from);
              const b = at.get(e.to);
              if (!a || !b) return null;
              const active = !linked || (linked.has(e.from) && linked.has(e.to));
              const weight = e.affinity / strongest;
              return (
                <line
                  key={`${e.from}-${e.to}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="var(--color-accent, #6E56CF)"
                  strokeWidth={(0.8 + weight * 2.6) / view.k}
                  strokeOpacity={active ? 0.2 + weight * 0.5 : 0.06}
                  strokeLinecap="round"
                />
              );
            })}

            {placed.map((n) => {
              const dim = linked !== null && !linked.has(n.id);
              // Scale the node by how well the rest of the profile predicts it.
              const r = NODE_R * (0.8 + (n.affinity ?? 0.5) * 0.45);
              return (
                <g
                  key={n.id}
                  opacity={dim ? 0.3 : 1}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover(null)}
                >
                  {n.imageUrl ? (
                    <>
                      <clipPath id={`clip-${n.id}`}>
                        <circle cx={n.x} cy={n.y} r={r} />
                      </clipPath>
                      <image
                        href={n.imageUrl}
                        x={n.x - r}
                        y={n.y - r}
                        width={r * 2}
                        height={r * 2}
                        clipPath={`url(#clip-${n.id})`}
                        preserveAspectRatio="xMidYMin slice"
                      />
                    </>
                  ) : (
                    <circle cx={n.x} cy={n.y} r={r} fill="var(--color-surface-2, #27272a)" />
                  )}
                  <circle cx={n.x} cy={n.y} r={r} fill="none" stroke="var(--color-canvas, #09090b)" strokeWidth={2 / view.k} />
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={r + 1}
                    fill="none"
                    stroke="var(--color-accent, #6E56CF)"
                    strokeOpacity={n.strength === "love" ? 0.9 : 0.35}
                    strokeWidth={(n.strength === "love" ? 2 : 1) / view.k}
                  />
                  {/* Labels only when zoomed in or hovered: at 1x with many
                      nodes they overlap into noise. */}
                  {view.k > 1.4 || hover === n.id ? (
                    <text
                      x={n.x}
                      y={n.y + r + 10 / view.k}
                      textAnchor="middle"
                      className="fill-ink"
                      style={{ fontSize: 10 / view.k, fontWeight: 500, paintOrder: "stroke" }}
                      stroke="var(--color-canvas, #09090b)"
                      strokeWidth={3 / view.k}
                    >
                      {n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>

        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <Button size="sm" variant="outline" aria-label="Zoom in" onClick={() => zoomBy(1.3)}>
            <Plus className="size-3.5" />
          </Button>
          <Button size="sm" variant="outline" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.3)}>
            <Minus className="size-3.5" />
          </Button>
          <Button size="sm" variant="outline" aria-label="Reset view" onClick={() => setView({ x: 0, y: 0, k: 1 })}>
            <Maximize className="size-3.5" />
          </Button>
        </div>
      </div>
      <figcaption className="text-center text-xs text-muted">
        {nodes.length} things in {clusters.length} {clusters.length === 1 ? "group" : "groups"}. Drag to pan, scroll to
        zoom. Bigger nodes fit the rest of your taste more closely; thicker lines are stronger Qloo affinity.
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

      {data.nodes.length > 1 ? (
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

    </section>
  );
}
