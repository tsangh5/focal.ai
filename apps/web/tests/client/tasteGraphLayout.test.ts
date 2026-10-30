import { describe, expect, it } from "vitest";
import { layout, type TasteEdge, type TasteNode } from "@/components/profile/TasteContext";

const node = (id: string, type: string, strength = "like"): TasteNode => ({ id, name: id, type, strength });
const edge = (from: string, to: string, affinity: number): TasteEdge => ({ from, to, affinity });

/** Distance between two placed nodes, by id. */
function gap(placed: ReturnType<typeof layout>, a: string, b: string): number {
  const p = placed.find((n) => n.id === a)!;
  const q = placed.find((n) => n.id === b)!;
  return Math.hypot(p.x - q.x, p.y - q.y);
}

describe("taste graph layout", () => {
  it("places a single node in the middle", () => {
    const [only] = layout([node("a", "artist")], []);
    expect(only).toMatchObject({ x: 320, y: 320, degree: 0 });
  });

  it("is deterministic: the same taste settles into the same picture", () => {
    const nodes = ["a", "b", "c", "d", "e"].map((id, i) => node(id, i % 2 ? "artist" : "place"));
    const edges = [edge("a", "b", 0.9), edge("c", "d", 0.4), edge("a", "e", 0.6)];
    const first = layout(nodes, edges);
    const second = layout(nodes, edges);
    expect(first.map((n) => [n.x.toFixed(4), n.y.toFixed(4)])).toEqual(second.map((n) => [n.x.toFixed(4), n.y.toFixed(4)]));
  });

  it("pulls strongly linked things closer than weakly linked ones", () => {
    // Two pairs, identical but for their affinity: geometry has to carry it,
    // which a ring layout could not do.
    const nodes = [node("s1", "artist"), node("s2", "place"), node("w1", "book"), node("w2", "movie")];
    const placed = layout(nodes, [edge("s1", "s2", 0.95), edge("w1", "w2", 0.05)]);
    expect(gap(placed, "s1", "s2")).toBeLessThan(gap(placed, "w1", "w2"));
  });

  it("counts links as degree, so size can follow it", () => {
    const nodes = ["hub", "a", "b", "c"].map((id) => node(id, "artist"));
    const placed = layout(nodes, [edge("hub", "a", 0.5), edge("hub", "b", 0.5), edge("hub", "c", 0.5)]);
    expect(placed.find((n) => n.id === "hub")!.degree).toBe(3);
    expect(placed.find((n) => n.id === "a")!.degree).toBe(1);
  });

  it("keeps every node inside the viewBox, dense or sparse", () => {
    for (const count of [2, 7, 24, 60]) {
      const nodes = Array.from({ length: count }, (_, i) => node(`n${i}`, ["artist", "place", "movie"][i % 3]!));
      const edges = nodes.slice(1).map((n, i) => edge(nodes[i]!.id, n.id, 0.3 + (i % 7) / 10));
      for (const p of layout(nodes, edges)) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y), `${count} nodes`).toBe(true);
        expect(p.x, `${count} nodes`).toBeGreaterThanOrEqual(0);
        expect(p.x, `${count} nodes`).toBeLessThanOrEqual(640);
        expect(p.y, `${count} nodes`).toBeGreaterThanOrEqual(0);
        expect(p.y, `${count} nodes`).toBeLessThanOrEqual(640);
      }
    }
  });

  it("does not collapse nodes onto each other", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => node(`n${i}`, "artist"));
    const placed = layout(nodes, []);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(gap(placed, `n${i}`, `n${j}`)).toBeGreaterThan(8);
      }
    }
  });
});
