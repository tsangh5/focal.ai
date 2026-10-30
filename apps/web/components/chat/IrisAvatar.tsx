"use client";

/**
 * Iris — the focal chat agent.
 *
 * Named for the iris: the part of an eye that opens and closes to set the
 * focal point. It is what decides what you see sharply, which is the product
 * in one word.
 *
 * A small pixel creature rather than a logo. The sprite lives in
 * `irisSprite.ts`; this file is the behaviour — blinking, glancing, reacting
 * to a click. Two rules keep her from looking cheap:
 *
 *   1. Render at a whole multiple of the 24px grid. At 1.83x a pixel is not a
 *      pixel any more and the whole sprite turns to mush, so `size` is a hint
 *      that gets snapped.
 *   2. Animate by swapping frames and translating whole grid units. Never
 *      tween a transform.
 *
 * All ambient motion is off under prefers-reduced-motion; a click still
 * changes her expression, since that is a response rather than an animation.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GRID, posePaths, type EyeFrame, type MouthFrame, type Pose } from "./irisSprite";

export const AGENT_NAME = "Iris";

export type IrisState = "idle" | "thinking" | "happy";

interface IrisAvatarProps {
  /** A hint: snapped to the nearest whole multiple of 24 so pixels stay square. */
  size?: number;
  className?: string;
  state?: IrisState;
  /** Decorative instances sit next to text that already says "Iris". */
  decorative?: boolean;
}

export interface Step {
  eye?: EyeFrame;
  mouth?: MouthFrame;
  /** Whole grid units, negative is up. */
  dy?: number;
  ms: number;
}

/**
 * A real blink is three frames in about 180ms, and the half-lid frame on the
 * way down is what sells it — straight open-to-shut looks like a glitch.
 */
const BLINK: Step[] = [
  { eye: "half", ms: 50 },
  { eye: "shut", ms: 80 },
  { eye: "half", ms: 50 },
];

/** Clicked: blink, duck a pixel, pop back, then grin for a moment. */
const POKE: Step[] = [
  { eye: "half", dy: 1, ms: 60 },
  { eye: "shut", dy: 1, ms: 90 },
  { eye: "happy", dy: -1, ms: 140 },
  { eye: "happy", mouth: "smile", dy: 0, ms: 420 },
];

const POKE_STILL: Step[] = [
  { eye: "shut", ms: 120 },
  { eye: "happy", mouth: "smile", ms: 420 },
];

const REST: Record<IrisState, Pose> = {
  idle: { eye: "open", mouth: "neutral" },
  thinking: { eye: "open", mouth: "neutral" },
  happy: { eye: "happy", mouth: "smile", blush: true },
};

/**
 * Which frame wins. A running sequence outranks everything, then the thinking
 * dart, then hover, then the state's resting pose. Pure so the precedence is
 * testable without a DOM.
 */
export function resolvePose(
  state: IrisState,
  step: Step | null,
  gaze: EyeFrame | null,
  hovered: boolean,
): Pose {
  const rest = REST[state];
  return {
    eye: step?.eye ?? gaze ?? (hovered && state === "idle" ? "wide" : rest.eye),
    mouth: step?.mouth ?? rest.mouth,
    blush: rest.blush === true || step?.mouth === "smile",
  };
}

/**
 * Round the requested size to a whole number of grid pixels. At a fractional
 * scale the browser spreads one sprite pixel over 1.83 device pixels and the
 * sprite turns to mush, so callers get the nearest honest size instead.
 */
export function snapSize(size: number): number {
  return Math.max(1, Math.round(size / GRID)) * GRID;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToMotionPref(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMotionPref,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false, // server render: assume motion is fine, then correct on hydrate
  );
}

export function IrisAvatar({ size = 48, className, state = "idle", decorative = false }: IrisAvatarProps) {
  const reduced = useReducedMotion();
  const [step, setStep] = useState<Step | null>(null);
  const [gaze, setGaze] = useState<EyeFrame | null>(null);
  const [hovered, setHovered] = useState(false);

  // Transient frame sequences (blink, poke) get their own timer list so the
  // ambient scheduler below is never cancelled by a click.
  const seqTimers = useRef<number[]>([]);
  useEffect(() => () => seqTimers.current.forEach(clearTimeout), []);

  const play = useCallback((steps: Step[]) => {
    seqTimers.current.forEach(clearTimeout);
    seqTimers.current = [];
    let at = 0;
    for (const s of steps) {
      const delay = at;
      seqTimers.current.push(window.setTimeout(() => setStep(s), delay));
      at += s.ms;
    }
    seqTimers.current.push(window.setTimeout(() => setStep(null), at));
  }, []);

  // Ambient blinking, on the primary instance only: forty message avatars all
  // blinking at once is noise, and synchronised blinking looks mechanical.
  // The interval is randomised per instance so they drift apart.
  useEffect(() => {
    if (decorative || reduced) return;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          play(Math.random() < 0.25 ? [...BLINK, { eye: "open", ms: 110 }, ...BLINK] : BLINK);
          schedule();
        },
        2600 + Math.random() * 4200,
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [decorative, reduced, play]);

  // Thinking: eyes dart, which reads as searching for something. Leaving the
  // state clears `gaze` through this effect's cleanup, so there is nothing to
  // reset on the way in.
  useEffect(() => {
    if (state !== "thinking" || reduced) return;
    let right = false;
    const timer = window.setInterval(() => {
      right = !right;
      setGaze(right ? "right" : "open");
    }, 620);
    return () => {
      clearInterval(timer);
      setGaze(null);
    };
  }, [state, reduced]);

  const pose = resolvePose(state, step, gaze, hovered);

  const px = snapSize(size);
  const dy = step?.dy ?? 0;
  const bobs = !decorative;

  return (
    <svg
      width={px}
      height={px}
      viewBox={`0 0 ${GRID} ${GRID}`}
      className={className}
      shapeRendering="crispEdges"
      onPointerDown={() => play(reduced ? POKE_STILL : POKE)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      {...(decorative
        ? { "aria-hidden": true as const }
        : { role: "img" as const, "aria-label": `${AGENT_NAME}, the focal assistant` })}
    >
      {/*
        step-end holds each keyframe, so she hops a whole grid unit rather
        than sliding through fractions of a pixel.
      */}
      {bobs ? (
        <style>{`
          @keyframes iris-bob { 0% { transform: translateY(0) } 50% { transform: translateY(-1px) } }
          .iris-bob { animation: iris-bob 3.2s step-end infinite }
          @media (prefers-reduced-motion: reduce) { .iris-bob { animation: none } }
        `}</style>
      ) : null}

      {/* Bob and poke ride separate groups so their transforms never fight. */}
      <g className={bobs ? "iris-bob" : undefined}>
        <g transform={dy ? `translate(0 ${dy})` : undefined}>
          {posePaths(pose).map((p) => (
            <path key={p.fill} d={p.d} fill={p.fill} />
          ))}
        </g>
      </g>
    </svg>
  );
}
