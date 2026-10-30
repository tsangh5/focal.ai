import { describe, expect, it } from "vitest";
import { resolvePose, snapSize, type Step } from "@/components/chat/IrisAvatar";
import { GRID, posePaths } from "@/components/chat/irisSprite";

describe("snapSize", () => {
  it("keeps whole multiples of the grid untouched", () => {
    for (const px of [24, 48, 72, 120]) expect(snapSize(px)).toBe(px);
  });

  it("rounds everything else to the nearest whole scale", () => {
    expect(snapSize(44)).toBe(48);
    expect(snapSize(26)).toBe(24);
    expect(snapSize(35)).toBe(24); // 1.46x rounds down
    expect(snapSize(37)).toBe(48); // 1.54x rounds up
  });

  it("never collapses below one device pixel per sprite pixel", () => {
    for (const px of [0, 1, 8, -10]) expect(snapSize(px)).toBe(GRID);
  });

  it("only ever yields sizes that keep pixels square", () => {
    for (let px = 1; px <= 400; px += 1) expect(snapSize(px) % GRID).toBe(0);
  });
});

describe("resolvePose", () => {
  const blink: Step = { eye: "shut", ms: 80 };
  const grin: Step = { eye: "happy", mouth: "smile", ms: 420 };

  it("rests open and neutral when idle", () => {
    expect(resolvePose("idle", null, null, false)).toEqual({ eye: "open", mouth: "neutral", blush: false });
  });

  it("widens her eyes on hover, but only when idle", () => {
    expect(resolvePose("idle", null, null, true).eye).toBe("wide");
    expect(resolvePose("happy", null, null, true).eye).toBe("happy");
  });

  it("lets the thinking dart outrank hover", () => {
    expect(resolvePose("thinking", null, "right", true).eye).toBe("right");
  });

  it("lets a running sequence outrank the dart and the resting pose", () => {
    expect(resolvePose("thinking", blink, "right", false).eye).toBe("shut");
    expect(resolvePose("happy", blink, null, false).eye).toBe("shut");
  });

  it("keeps the resting mouth through frames that only change the eyes", () => {
    expect(resolvePose("happy", blink, null, false).mouth).toBe("smile");
    expect(resolvePose("idle", blink, null, false).mouth).toBe("neutral");
  });

  it("blushes when happy, and when a sequence grins", () => {
    expect(resolvePose("happy", null, null, false).blush).toBe(true);
    expect(resolvePose("idle", grin, null, false).blush).toBe(true);
    expect(resolvePose("idle", blink, null, false).blush).toBe(false);
  });

  it("always resolves to a pose the sprite can draw", () => {
    const steps: Array<Step | null> = [null, blink, grin, { eye: "half", dy: 1, ms: 60 }];
    for (const state of ["idle", "thinking", "happy"] as const)
      for (const step of steps)
        for (const gaze of [null, "open", "right"] as const)
          for (const hovered of [false, true])
            expect(posePaths(resolvePose(state, step, gaze, hovered)).length).toBeGreaterThan(0);
  });
});
