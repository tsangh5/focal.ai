/**
 * Iris — the focal chat agent.
 *
 * Named for the iris: the part of an eye that opens and closes to set the
 * focal point. It is what decides what you see sharply, which is the product
 * in one word.
 *
 * A small creature rather than a logo: a soft body with one big aperture eye
 * that blinks, drifts and reacts while thinking. Inline SVG with CSS
 * animation, so it stays crisp at any size, themes with the UI, and ships no
 * raster assets. Every animation is off under prefers-reduced-motion.
 */
export const AGENT_NAME = "Iris";

export type IrisState = "idle" | "thinking" | "happy";

interface IrisAvatarProps {
  size?: number;
  className?: string;
  state?: IrisState;
  /** Decorative instances sit next to text that already says "Iris". */
  decorative?: boolean;
}

export function IrisAvatar({ size = 28, className, state = "idle", decorative = false }: IrisAvatarProps) {
  // Scoped per state+size so several Irises animate independently and the
  // gradient ids never collide between instances.
  const uid = `iris-${size}-${state}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={className}
      data-state={state}
      {...(decorative
        ? { "aria-hidden": true as const }
        : { role: "img" as const, "aria-label": `${AGENT_NAME}, the focal assistant` })}
    >
      <defs>
        <radialGradient id={`${uid}-body`} cx="38%" cy="28%" r="78%">
          <stop offset="0%" stopColor="#a594ff" />
          <stop offset="55%" stopColor="#6E56CF" />
          <stop offset="100%" stopColor="#3b2d80" />
        </radialGradient>
        <radialGradient id={`${uid}-eye`} cx="42%" cy="34%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="38%" stopColor="#e9e4ff" />
          <stop offset="100%" stopColor="#bcacff" />
        </radialGradient>
      </defs>

      <style>{`
        @keyframes ${uid}-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-1.3px) } }
        @keyframes ${uid}-blink { 0%,92%,100% { transform: scaleY(1) } 95%,97% { transform: scaleY(.08) } }
        @keyframes ${uid}-scan  { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-2.2px) } 75% { transform: translateX(2.2px) } }
        @keyframes ${uid}-spin  { to { transform: rotate(360deg) } }
        .${uid}-body  { animation: ${uid}-float 3.6s ease-in-out infinite; transform-origin: 20px 20px }
        .${uid}-lid   { animation: ${uid}-blink 5.2s ease-in-out infinite; transform-origin: 20px 19px }
        .${uid}-pupil { transform-origin: 20px 19px }
        .${uid}-blades{ transform-origin: 20px 19px }
        [data-state="thinking"] .${uid}-pupil  { animation: ${uid}-scan 1.5s ease-in-out infinite }
        [data-state="thinking"] .${uid}-blades { animation: ${uid}-spin 4s linear infinite }
        [data-state="thinking"] .${uid}-lid    { animation: none }
        @media (prefers-reduced-motion: reduce) {
          .${uid}-body, .${uid}-lid, .${uid}-pupil, .${uid}-blades { animation: none !important }
        }
      `}</style>

      <g className={`${uid}-body`}>
        {/* Body: slightly wider than tall, so it reads as a creature not a dot. */}
        <ellipse cx="20" cy="21" rx="16" ry="15" fill={`url(#${uid}-body)`} />
        <ellipse cx="20" cy="21" rx="16" ry="15" fill="none" stroke="#2a1f5c" strokeOpacity="0.35" strokeWidth="1" />

        {/* Two small ears — the difference between a pet and a ball. */}
        <path d="M8.5 9.5 C9 5.5 12 4.5 13.8 7.4" fill="none" stroke="#8b74ff" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M31.5 9.5 C31 5.5 28 4.5 26.2 7.4" fill="none" stroke="#8b74ff" strokeWidth="2.4" strokeLinecap="round" />

        <g className={`${uid}-lid`}>
          {/* The eye is the aperture: blades around a bright pupil. */}
          <circle cx="20" cy="19" r="10" fill="#16122e" />
          <g
            className={`${uid}-blades`}
            stroke="#a594ff"
            strokeOpacity="0.5"
            strokeWidth="1.3"
            strokeLinecap="round"
            fill="none"
          >
            {[0, 60, 120, 180, 240, 300].map((deg) => (
              <path key={deg} d="M20 10.4 A8.6 8.6 0 0 1 27.4 14.7" transform={`rotate(${deg} 20 19)`} />
            ))}
          </g>
          <circle className={`${uid}-pupil`} cx="20" cy="19" r="5.6" fill={`url(#${uid}-eye)`} />
          <circle className={`${uid}-pupil`} cx="20" cy="19" r="2.6" fill="#241a52" />
          <circle className={`${uid}-pupil`} cx="18.2" cy="17.2" r="1.5" fill="#ffffff" fillOpacity="0.95" />
        </g>

        {/* A smile only when pleased — idle stays calm rather than grinning. */}
        {state === "happy" ? (
          <path d="M16.5 30 Q20 32.6 23.5 30" fill="none" stroke="#dcd4ff" strokeWidth="1.6" strokeLinecap="round" />
        ) : null}
      </g>
    </svg>
  );
}
