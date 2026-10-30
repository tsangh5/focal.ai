/**
 * Iris's sprite data.
 *
 * She is drawn as pixel art on a fixed 24x24 grid: one char per pixel, a hand
 * limited palette, a one pixel outline, and no gradients or anti-aliasing.
 * That is the whole discipline — the moment a feature lands off the grid or a
 * tone gets interpolated she stops reading as pixel art and starts reading as
 * a blurry vector blob.
 *
 * The body is one static layer. Expressions are small overlay blocks stamped
 * on top of it, so blinking and glancing swap discrete frames rather than
 * tweening anything. Pixel characters animate by frame, never by sub-pixel
 * transform.
 */

/** Logical pixels per side. Render sizes must be whole multiples of this. */
export const GRID = 24;

/**
 * Three body tones plus an outline is all a 24px sprite can carry. Shadows
 * shift toward blue rather than only darkening, which is what keeps the ramp
 * from going muddy. The outline is deep violet rather than black so she sits
 * on the near-black canvas without punching a hole in it.
 */
const PALETTE = {
  K: "#1B1038", // outline, and the mouth
  D: "#4A35A0", // shadow, lower right
  B: "#6E56CF", // base — the product accent
  H: "#B7A6FF", // rim light, upper left
  P: "#160D2E", // pupil
  E: "#38286E", // light bouncing up into the bottom of the eye
  G: "#FFFFFF", // specular glint — the pixel that makes it an eye
  C: "#FF7FA8", // blush
} as const;

type Ink = keyof typeof PALETTE;

/**
 * Body, with the ears cut into the head outline rather than stuck on top of
 * it. Ears drawn as appendages end up two pixels wide, which leaves nothing
 * inside once the outline is drawn and reads as an antenna.
 *
 * Rows 0-1 stay empty so the idle bob has somewhere to go.
 */
const BODY = [
  "........................", // 00
  "........................", // 01
  "....KK............KK....", // 02
  "....KHK..........KHK....", // 03
  "...KHBHK........KHBHK...", // 04
  "...KHBBHK......KHBBDK...", // 05
  "...KHBBBHK....KHBBBDK...", // 06
  "...KHBBBBHKKKKHBBBBDK...", // 07
  "..KHBBBBBBHHHHBBBBBBHK..", // 08
  "..KHBBBBBBBBBBBBBBBBDK..", // 09
  "..KHBBBBBBBBBBBBBBBBDK..", // 10
  "..KHBBBBBBBBBBBBBBBBDK..", // 11
  "..KHBBBBBBBBBBBBBBBBDK..", // 12
  "..KHBBBBBBBBBBBBBBBBDK..", // 13
  "..KHBBBBBBBBBBBBBBBBDK..", // 14
  "...KHBBBBBBBBBBBBBBDK...", // 15
  "...KHBBBBBBBBBBBBBBDK...", // 16
  "....KHDBBBBBBBBBBDDK....", // 17
  ".....KKHDBBBBBBDDKK.....", // 18
  ".......KKHDDDDDKK.......", // 19
  ".........KKKKKK.........", // 20
  "........................", // 21
  "........................", // 22
  "........................", // 23
];

/**
 * Eyes, 6x7. Big and dark with a two pixel specular block: at this scale the
 * glint is what separates "eye" from "hole". An amber iris ring was the
 * obvious nod to her name, but a 4x5 interior has no room for a pupil *and* a
 * ring — it rendered as an orange crumb, so the warmth lives in the blush and
 * the bounce tone instead.
 *
 * `.` is transparent, so the shut and happy frames let the body show through.
 */
const EYES = {
  open: [".KKKK.", "KPPPPK", "KGGPPK", "KGGPPK", "KPPPPK", "KPEEPK", ".KKKK."],
  // The pupil has no room to move, but shifting the glint two pixels reads as
  // a glance on its own.
  right: [".KKKK.", "KPPPPK", "KPPGGK", "KPPGGK", "KPPPPK", "KPEEPK", ".KKKK."],
  half: [".KKKK.", "KKKKKK", "KKKKKK", "KGGPPK", "KPPPPK", "KPEEPK", ".KKKK."],
  shut: ["......", "......", "......", "KKKKKK", ".KKKK.", "......", "......"],
  happy: ["......", "......", "..KK..", ".K..K.", "K....K", "......", "......"],
  // Extra catchlights, for when she is being looked at.
  wide: [".KKKK.", "KPPPPK", "KGGPPK", "KGPPPK", "KPPGPK", "KPEEPK", ".KKKK."],
} satisfies Record<string, string[]>;

const MOUTHS = {
  neutral: ["..KK..", "......"],
  smile: [".K..K.", "..KK.."],
  open: [".KKKK.", "..KK.."],
} satisfies Record<string, string[]>;

const BLUSH = ["CC", "CC"];

export type EyeFrame = keyof typeof EYES;
export type MouthFrame = keyof typeof MOUTHS;

/**
 * Overlay origins as [col, row]. The eyes occupy rows 8-14, so the blush sits
 * at row 15, just under them. It has to land on flat base tone: painted over
 * the rim light it touches the silhouette edge and reads as a pink blob stuck
 * to her cheek rather than colour in it.
 */
const OVERLAY_AT = {
  leftEye: [5, 8],
  rightEye: [13, 8],
  mouth: [9, 16],
  leftBlush: [5, 15],
  rightBlush: [17, 15],
} as const;

export interface SpritePath {
  fill: string;
  d: string;
}

export interface Pose {
  eye: EyeFrame;
  mouth: MouthFrame;
  blush?: boolean;
}

function stamp(grid: string[][], block: string[], [ox, oy]: readonly [number, number]): void {
  block.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== ".") grid[oy + y][ox + x] = ch;
    });
  });
}

/**
 * Compose a pose and flatten it to one path per colour. Run-length encoding
 * each row keeps a sprite at roughly ten DOM nodes rather than ~150 rects,
 * which matters when a long chat renders one Iris per message.
 */
function buildPaths({ eye, mouth, blush }: Pose): SpritePath[] {
  const grid = BODY.map((row) => [...row]);
  stamp(grid, EYES[eye], OVERLAY_AT.leftEye);
  stamp(grid, EYES[eye], OVERLAY_AT.rightEye);
  stamp(grid, MOUTHS[mouth], OVERLAY_AT.mouth);
  if (blush) {
    stamp(grid, BLUSH, OVERLAY_AT.leftBlush);
    stamp(grid, BLUSH, OVERLAY_AT.rightBlush);
  }

  const runs = new Map<Ink, string[]>();
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x] as Ink | ".";
      if (ch === ".") {
        x += 1;
        continue;
      }
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w += 1;
      const parts = runs.get(ch) ?? [];
      parts.push(`M${x} ${y}h${w}v1h-${w}z`);
      runs.set(ch, parts);
      x += w;
    }
  });

  // Walk the palette rather than the map so path order is stable across
  // poses and React reuses the same nodes between frames.
  return (Object.keys(PALETTE) as Ink[])
    .filter((ch) => runs.has(ch))
    .map((ch) => ({ fill: PALETTE[ch], d: runs.get(ch)!.join("") }));
}

const cache = new Map<string, SpritePath[]>();

/** Cached per pose; there are only a couple of dozen combinations. */
export function posePaths(pose: Pose): SpritePath[] {
  const key = `${pose.eye}|${pose.mouth}|${pose.blush ? "c" : ""}`;
  let paths = cache.get(key);
  if (!paths) {
    paths = buildPaths(pose);
    cache.set(key, paths);
  }
  return paths;
}

/** Raw frames, exported so the grid integrity test can check them. */
export const SPRITE = { PALETTE, BODY, EYES, MOUTHS, BLUSH, OVERLAY_AT } as const;
