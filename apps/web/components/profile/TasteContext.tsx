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
export interface TasteNode {
  id: string;
  name: string;
  /** Short type name, which is also the cluster the node sits in. */
  type: string;
  strength: string;
  /** How well the rest of the profile predicts this entry, 0..1. */
  affinity?: number;
}
export interface TasteEdge {
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
/** A dot, not a disc: Obsidian's nodes are small against the canvas. */
const NODE_R = 7;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 6;

interface Placed extends TasteNode {
  x: number;
  y: number;
  /** How many edges touch this node; drives its size, as in Obsidian. */
  degree: number;
}

const ITERATIONS = 420;
/** Golden angle: a spiral seed spreads the first positions evenly without randomness. */
const GOLDEN = 2.399963229728653;

/**
 * Force-directed layout, run to completion before the first paint.
 *
 * Three forces, which is what gives the organic look: every pair of nodes
 * repels, each edge pulls like a spring whose rest length shortens as affinity
 * rises, and same-type nodes attract weakly so groups emerge instead of being
 * drawn as rings. A ring layout made every relationship look identical — the
 * geometry said nothing — whereas here distance carries the affinity.
 *
 * Deterministic despite being a simulation: positions are seeded on a golden
 * spiral rather than at random and the tick count is fixed, so the same taste
 * settles into the same picture every time. Nothing animates into place, so
 * there is no reshuffling under the reader.
 */
export function layout(nodes: TasteNode[], edges: TasteEdge[]): Placed[] {
  const n = nodes.length;
  const c = SIZE / 2;
  if (n === 1) return [{ ...nodes[0]!, x: c, y: c, degree: 0 }];

  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const degree = new Int32Array(n);

  for (let i = 0; i < n; i++) {
    const a = i * GOLDEN;
    const r = 26 * Math.sqrt(i + 1);
    x[i] = c + Math.cos(a) * r;
    y[i] = c + Math.sin(a) * r;
  }

  const links: { a: number; b: number; rest: number; k: number }[] = [];
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    degree[a]!++;
    degree[b]!++;
    // Strong affinity sits closer. Clamped so a weak link still has a length.
    const w = Math.max(0, Math.min(1, e.affinity));
    links.push({ a, b, rest: 150 - w * 95, k: 0.035 + w * 0.05 });
  }

  // Same-type pairs, so groups gather without being positioned by hand.
  const kin: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (nodes[i]!.type === nodes[j]!.type) kin.push([i, j]);
    }
  }

  const repulsion = 2600;
  for (let step = 0; step < ITERATIONS; step++) {
    // Cooling: big moves early, fine settling late.
    const alpha = Math.max(0.02, 1 - step / ITERATIONS) ** 1.6;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = x[i]! - x[j]!;
        let dy = y[i]! - y[j]!;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          // Coincident nodes get a deterministic nudge, never a random one.
          dx = (i % 2 === 0 ? 1 : -1) * 0.5;
          dy = (j % 2 === 0 ? 1 : -1) * 0.5;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const f = (repulsion / d2) * alpha;
        const ux = (dx / d) * f;
        const uy = (dy / d) * f;
        vx[i]! += ux;
        vy[i]! += uy;
        vx[j]! -= ux;
        vy[j]! -= uy;
      }
    }

    for (const { a, b, rest, k } of links) {
      const dx = x[b]! - x[a]!;
      const dy = y[b]! - y[a]!;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - rest) * k * alpha;
      const ux = (dx / d) * f;
      const uy = (dy / d) * f;
      vx[a]! += ux;
      vy[a]! += uy;
      vx[b]! -= ux;
      vy[b]! -= uy;
    }

    for (const [a, b] of kin) {
      const dx = x[b]! - x[a]!;
      const dy = y[b]! - y[a]!;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - 90) * 0.012 * alpha;
      const ux = (dx / d) * f;
      const uy = (dy / d) * f;
      vx[a]! += ux;
      vy[a]! += uy;
      vx[b]! -= ux;
      vy[b]! -= uy;
    }

    for (let i = 0; i < n; i++) {
      // Gentle pull to centre keeps disconnected nodes from drifting off.
      vx[i]! += (c - x[i]!) * 0.012 * alpha;
      vy[i]! += (c - y[i]!) * 0.012 * alpha;
      vx[i]! *= 0.82;
      vy[i]! *= 0.82;
      x[i]! += vx[i]!;
      y[i]! += vy[i]!;
    }
  }

  // Fit the settled graph to the viewBox, so a sparse one is not a dot in the
  // middle and a dense one is not clipped.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, x[i]!);
    maxX = Math.max(maxX, x[i]!);
    minY = Math.min(minY, y[i]!);
    maxY = Math.max(maxY, y[i]!);
  }
  const pad = 70;
  const scale = Math.min((SIZE - pad * 2) / Math.max(1, maxX - minX), (SIZE - pad * 2) / Math.max(1, maxY - minY), 1.6);
  const offX = c - ((minX + maxX) / 2) * scale;
  const offY = c - ((minY + maxY) / 2) * scale;

  return nodes.map((node, i) => ({
    ...node,
    x: x[i]! * scale + offX,
    y: y[i]! * scale + offY,
    degree: degree[i]!,
  }));
}

function GraphView({ nodes, edges }: { nodes: TasteNode[]; edges: TasteEdge[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const placed = useMemo(() => layout(nodes, edges), [nodes, edges]);
  const groups = useMemo(() => [...new Set(nodes.map((n) => n.type))].sort(), [nodes]);
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
          aria-label={`Your taste as a graph: ${nodes.length} things in ${groups.length} groups, linked by Qloo affinity`}
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
                  // Thin and neutral, like Obsidian: the links are structure,
                  // not the subject. Affinity is already in the distance, so
                  // weight only nudges the opacity.
                  stroke="var(--color-ink, #fafafa)"
                  strokeWidth={1 / view.k}
                  strokeOpacity={active ? 0.1 + weight * 0.22 : 0.04}
                  strokeLinecap="round"
                />
              );
            })}

            {placed.map((n) => {
              const dim = linked !== null && !linked.has(n.id);
              const isHover = hover === n.id;
              // Size by number of links, as Obsidian does.
              const r = NODE_R * (0.72 + Math.min(1, n.degree / 6) * 0.5);
              return (
                <g
                  key={n.id}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover(null)}
                >
                  {/* A plain filled dot. Artwork in the nodes made a dense
                      graph unreadable — ten competing photographs rather than
                      a shape you can follow. */}
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={r}
                    fill={isHover ? "var(--color-accent, #6E56CF)" : "var(--color-ink, #fafafa)"}
                    fillOpacity={dim ? 0.25 : n.strength === "love" ? 1 : 0.78}
                  />
                  {/* Labels follow the dot, and only show when there is room:
                      zoomed past 1.4x, hovered, or a well-connected node. */}
                  {view.k > 1.4 || isHover || (linked?.has(n.id) ?? false) || n.degree >= 4 ? (
                    <text
                      x={n.x}
                      y={n.y + r + 11 / view.k}
                      textAnchor="middle"
                      fill="var(--color-ink, #fafafa)"
                      fillOpacity={dim ? 0.3 : isHover ? 1 : 0.68}
                      style={{ fontSize: 11 / view.k, paintOrder: "stroke" }}
                      stroke="var(--color-canvas, #09090b)"
                      strokeWidth={3 / view.k}
                      strokeLinejoin="round"
                    >
                      {n.name.length > 24 ? `${n.name.slice(0, 23)}…` : n.name}
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
        {nodes.length} things, {edges.length} {edges.length === 1 ? "link" : "links"}. Drag to pan, scroll to zoom.
        Things Qloo sees as related sit closer together; bigger nodes have more links.
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
