/**
 * Iris — the focal chat agent.
 *
 * Named for the iris: the part of an eye that opens and closes to set the
 * focal point. It is what decides what you see sharply, which is the product
 * in one word.
 *
 * The mark is an aperture: a ring of blades around a bright pupil, drawn in
 * the accent hue. No raster asset, so it stays crisp at any size and themes
 * with the rest of the UI.
 */
export const AGENT_NAME = "Iris";

export function IrisAvatar({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label={`${AGENT_NAME}, the focal assistant`}
    >
      <defs>
        <radialGradient id="iris-pupil" cx="50%" cy="38%" r="62%">
          <stop offset="0%" stopColor="#c4b8ff" />
          <stop offset="60%" stopColor="#6E56CF" />
          <stop offset="100%" stopColor="#3b2d80" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="#18181b" />
      <circle cx="16" cy="16" r="15" fill="none" stroke="#6E56CF" strokeOpacity="0.5" strokeWidth="1.5" />
      {/* Six aperture blades, rotated into a ring. */}
      <g stroke="#a594ff" strokeOpacity="0.55" strokeWidth="1.4" strokeLinecap="round" fill="none">
        {[0, 60, 120, 180, 240, 300].map((deg) => (
          <path key={deg} d="M16 5.5 A10.5 10.5 0 0 1 25.1 10.75" transform={`rotate(${deg} 16 16)`} />
        ))}
      </g>
      <circle cx="16" cy="16" r="6.5" fill="url(#iris-pupil)" />
      {/* Catchlight — reads as alive rather than as a logo. */}
      <circle cx="13.9" cy="13.6" r="1.6" fill="#ffffff" fillOpacity="0.9" />
    </svg>
  );
}
