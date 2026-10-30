import { describe, expect, it } from "vitest";
import { GRID, posePaths, SPRITE, type EyeFrame, type MouthFrame } from "@/components/chat/irisSprite";

const { PALETTE, BODY, EYES, MOUTHS, BLUSH, OVERLAY_AT } = SPRITE;

const EYE_FRAMES = Object.keys(EYES) as EyeFrame[];
const MOUTH_FRAMES = Object.keys(MOUTHS) as MouthFrame[];

/** Overlay blocks paired with the origin they are stamped at. */
const OVERLAYS: Array<[string, string[], readonly [number, number]]> = [
  ...EYE_FRAMES.flatMap(
    (f): Array<[string, string[], readonly [number, number]]> => [
      [`eye:${f} left`, EYES[f], OVERLAY_AT.leftEye],
      [`eye:${f} right`, EYES[f], OVERLAY_AT.rightEye],
    ],
  ),
  ...MOUTH_FRAMES.map(
    (f): [string, string[], readonly [number, number]] => [`mouth:${f}`, MOUTHS[f], OVERLAY_AT.mouth],
  ),
  ["blush left", BLUSH, OVERLAY_AT.leftBlush],
  ["blush right", BLUSH, OVERLAY_AT.rightBlush],
];

const inks = new Set(Object.keys(PALETTE));

describe("iris sprite grid", () => {
  it("draws the body on an exact 24x24 grid", () => {
    expect(BODY).toHaveLength(GRID);
    for (const row of BODY) expect(row).toHaveLength(GRID);
  });

  it("only uses inks that exist in the palette", () => {
    const frames = [BODY, ...Object.values(EYES), ...Object.values(MOUTHS), BLUSH];
    for (const frame of frames)
      for (const row of frame) for (const ch of row) expect(ch === "." || inks.has(ch)).toBe(true);
  });

  it("keeps every overlay rectangular", () => {
    for (const [name, block] of OVERLAYS.map(([n, b]) => [n, b] as const)) {
      const width = block[0].length;
      for (const row of block) expect(`${name}:${row.length}`).toBe(`${name}:${width}`);
    }
  });

  it("stamps every overlay pixel inside the silhouette", () => {
    // Guards the mistake this test was written for: an overlay placed a row
    // or two off lands on empty grid and tears a hole in her outline.
    for (const [name, block, [ox, oy]] of OVERLAYS) {
      block.forEach((row, y) => {
        [...row].forEach((ch, x) => {
          if (ch === ".") return;
          const under = BODY[oy + y]?.[ox + x];
          expect(`${name} @${ox + x},${oy + y}: ${under}`).not.toMatch(/: (\.|undefined)$/);
        });
      });
    }
  });

  it("lands blush on flat base tone only", () => {
    // Blush is a flat pink block with no outline of its own. On the rim light
    // it touches the silhouette edge and reads as a blob stuck to her cheek,
    // and on the outline it breaks her contour outright.
    for (const at of [OVERLAY_AT.leftBlush, OVERLAY_AT.rightBlush]) {
      BLUSH.forEach((row, y) => {
        [...row].forEach((_, x) => {
          expect(BODY[at[1] + y][at[0] + x]).toBe("B");
        });
      });
    }
  });
});

/** Parse the run-length paths back into a pixel set. */
function pixelsOf(eye: EyeFrame, mouth: MouthFrame, blush: boolean): Map<string, string> {
  const seen = new Map<string, string>();
  for (const { fill, d } of posePaths({ eye, mouth, blush })) {
    for (const [, sx, sy, sw] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
      const x = Number(sx);
      const y = Number(sy);
      for (let i = 0; i < Number(sw); i += 1) {
        const key = `${x + i},${y}`;
        expect(seen.has(key)).toBe(false); // no two paths may claim a pixel
        seen.set(key, fill);
      }
    }
  }
  return seen;
}

describe("posePaths", () => {
  it("encodes exactly the pixels the pose composes, for every pose", () => {
    for (const eye of EYE_FRAMES) {
      for (const mouth of MOUTH_FRAMES) {
        for (const blush of [false, true]) {
          // Compose the pose the slow, obvious way and compare.
          const grid = BODY.map((row) => [...row]);
          const put = (block: string[], [ox, oy]: readonly [number, number]) =>
            block.forEach((row, y) =>
              [...row].forEach((ch, x) => {
                if (ch !== ".") grid[oy + y][ox + x] = ch;
              }),
            );
          put(EYES[eye], OVERLAY_AT.leftEye);
          put(EYES[eye], OVERLAY_AT.rightEye);
          put(MOUTHS[mouth], OVERLAY_AT.mouth);
          if (blush) {
            put(BLUSH, OVERLAY_AT.leftBlush);
            put(BLUSH, OVERLAY_AT.rightBlush);
          }

          const expected = new Map<string, string>();
          grid.forEach((row, y) =>
            row.forEach((ch, x) => {
              if (ch !== ".") expected.set(`${x},${y}`, PALETTE[ch as keyof typeof PALETTE]);
            }),
          );

          expect(pixelsOf(eye, mouth, blush)).toEqual(expected);
        }
      }
    }
  });

  it("stays inside the viewBox", () => {
    for (const { d } of posePaths({ eye: "open", mouth: "neutral", blush: true })) {
      for (const [, sx, sy, sw] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
        expect(Number(sx) + Number(sw)).toBeLessThanOrEqual(GRID);
        expect(Number(sy)).toBeLessThan(GRID);
      }
    }
  });

  it("returns one path per ink, in a stable order", () => {
    const order = posePaths({ eye: "open", mouth: "neutral" }).map((p) => p.fill);
    expect(new Set(order).size).toBe(order.length);
    expect(posePaths({ eye: "open", mouth: "neutral" }).map((p) => p.fill)).toEqual(order);
  });
});
