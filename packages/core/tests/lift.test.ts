import { describe, expect, it } from "vitest";
import { decideLift, type LiftItem } from "../src/index";
import { profileOf, rule, thing, vibe } from "./helpers-v2";

function items(affinities: (number | undefined)[], extra: Record<number, Partial<LiftItem>> = {}): LiftItem[] {
  return affinities.map((a, i) => ({
    clientId: `c${i}`,
    originalIndex: i,
    entityId: `E${i}`,
    ...(a !== undefined ? { affinity: a } : {}),
    ...extra[i],
  }));
}

describe("decideLift", () => {
  it("lifts items at least one sd above the page mean, best first, rest in site order", () => {
    const d = decideLift({ items: items([0.70, 0.71, 0.90, 0.70, 0.95, 0.71]), profile: profileOf() });
    expect(d.lifted).toEqual(["c4", "c2"]);
    expect(d.order).toEqual(["c4", "c2", "c0", "c1", "c3", "c5"]);
    expect(d.items.find((i) => i.clientId === "c4")?.badge).toBe("top-pick");
  });

  // Qloo leaves signal entities out of its own results, so a place the user
  // already likes comes back with no affinity. It must still lift.
  it("lifts an unscored item the profile already likes", () => {
    const d = decideLift({
      items: items([0.7, 0.7, 0.7, undefined]),
      profile: profileOf(thing("E3", { name: "Rintaro", strength: "like" })),
    });
    expect(d.lifted).toEqual(["c3"]);
    expect(d.items.find((i) => i.clientId === "c3")?.badge).toBe("favourite");
    expect(d.items.find((i) => i.clientId === "c3")?.outcome).toBe("lifted");
  });

  it("puts loved things above liked things, and both above scored matches", () => {
    const d = decideLift({
      items: items([0.70, 0.71, 0.95, undefined, undefined]),
      profile: profileOf(
        thing("E3", { name: "Liked", strength: "like" }),
        thing("E4", { name: "Loved", strength: "love" }),
      ),
    });
    expect(d.lifted).toEqual(["c4", "c3", "c2"]);
  });

  it("never lifts a disliked thing even when it is also on the page", () => {
    const d = decideLift({
      items: items([0.7, 0.7, 0.7, undefined]),
      profile: profileOf(thing("E3", { name: "Nope", strength: "dislike" })),
    });
    expect(d.lifted).toEqual([]);
    expect(d.items.find((i) => i.clientId === "c3")?.outcome).toBe("disliked");
  });

  it("counts favourites against maxLift", () => {
    const d = decideLift({
      items: items([0.70, 0.71, 0.95, 0.96, undefined, undefined]),
      profile: profileOf(
        thing("E4", { name: "A", strength: "love" }),
        thing("E5", { name: "B", strength: "love" }),
      ),
      options: { maxLift: 3 },
    });
    expect(d.lifted).toHaveLength(3);
    expect(d.lifted.slice(0, 2)).toEqual(["c4", "c5"]);
  });

  it("does nothing with fewer than 3 scored items", () => {
    const d = decideLift({ items: items([0.9, 0.1, undefined, undefined]), profile: profileOf() });
    expect(d.lifted).toEqual([]);
    expect(d.order).toEqual(["c0", "c1", "c2", "c3"]);
  });

  it("does nothing when all scores are equal", () => {
    expect(decideLift({ items: items([0.7, 0.7, 0.7]), profile: profileOf() }).lifted).toEqual([]);
  });

  it("caps the lift at maxLift", () => {
    const aff = [...Array(10).fill(0.5), 0.9, 0.91, 0.92, 0.93, 0.94, 0.95, 0.96];
    const d = decideLift({ items: items(aff), profile: profileOf(), options: { maxLift: 5 } });
    expect(d.lifted).toHaveLength(5);
    expect(d.lifted[0]).toBe("c16");
  });

  it("first lifted is a top pick; the second only if clearly ahead; the rest good matches", () => {
    const d = decideLift({ items: items([...Array(12).fill(0.5), 0.9, 0.9, 0.8]), profile: profileOf() });
    const badges = Object.fromEntries(d.items.filter((i) => i.badge).map((i) => [i.clientId, i.badge]));
    expect(badges).toEqual({ c12: "top-pick", c13: "top-pick", c14: "good-match" });
  });

  it("never lifts disliked things or items with a disliked vibe", () => {
    const profile = profileOf(thing("E4", { strength: "dislike" }), vibe("urn:tag:sports_bar", { strength: "dislike" }));
    const d = decideLift({
      items: items([0.7, 0.7, 0.95, 0.7, 0.96], { 2: { tagIds: ["urn:tag:sports_bar"] } }),
      profile,
    });
    expect(d.lifted).toEqual([]);
    expect(d.items.map((i) => i.outcome)).toEqual(["kept", "kept", "disliked", "kept", "disliked"]);
  });

  it("folds items tagged with an active rule tag, in place; pending rules do nothing", () => {
    const profile = profileOf(rule("urn:tag:chain", { name: "chain" }), rule("urn:tag:fast_food", { status: "pending" }));
    const d = decideLift({
      items: items([0.7, 0.71, 0.72, 0.99], {
        1: { tagIds: ["urn:tag:chain"] },
        3: { tagIds: ["urn:tag:chain"] },
        0: { tagIds: ["urn:tag:fast_food"] },
      }),
      profile,
    });
    expect(d.folds).toEqual([{ ruleNames: ["chain"], clientIds: ["c1", "c3"] }]);
    expect(d.lifted).toEqual([]);
    expect(d.order).toEqual(["c0", "c1", "c2", "c3"]);
  });

  it("local vibe boosts can push an item over the line", () => {
    const base = items([0.70, 0.72, 0.74, 0.76, 0.78, 0.80], { 4: { tagIds: ["urn:tag:cozy"] } });
    expect(decideLift({ items: base, profile: profileOf() }).lifted).toEqual(["c5"]);
    const d = decideLift({
      items: base,
      profile: profileOf(),
      localBoosts: [{ id: "urn:tag:cozy", name: "cozy", strength: "love" }],
    });
    expect(d.lifted).toEqual(["c5", "c4"]);
    expect(d.items.find((i) => i.clientId === "c4")?.boosts).toEqual(["cozy"]);
  });

  it("keeps unscored items in place and reports stats", () => {
    const d = decideLift({ items: items([0.7, undefined, 0.7, 0.9]), profile: profileOf() });
    expect(d.items[1]?.outcome).toBe("unscored");
    expect(d.stats.scored).toBe(3);
    expect(d.stats.mean).toBeCloseTo(0.7667, 3);
  });
});
