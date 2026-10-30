/**
 * On-page look, modelled on shadcn/ui's dark theme. Styles live in shadow
 * roots; `!important` on :host and ::slotted wins over the host page's CSS,
 * while focal's text and buttons stay in light DOM (slotted) so the page's
 * own accessibility tree and our tests can reach them.
 */

const FONT = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
export const VIOLET = "#6E56CF";

const SPARKLE =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>';

const BASE = `
:host { all: initial !important; box-sizing: border-box !important; font-family: ${FONT} !important; -webkit-font-smoothing: antialiased !important; }
::slotted(*) { font-family: ${FONT} !important; }
::slotted(button) {
  all: unset !important; box-sizing: border-box !important; display: inline-flex !important; align-items: center !important;
  height: 28px !important; padding: 0 10px !important; border-radius: 8px !important; cursor: pointer !important;
  font: 500 12.5px/1 ${FONT} !important; letter-spacing: 0 !important; white-space: nowrap !important;
  transition: background-color .15s ease, border-color .15s ease, color .15s ease !important;
}
::slotted(button:focus-visible) { outline: 2px solid rgba(110,86,207,.6) !important; outline-offset: 2px !important; }
@keyframes focal-in { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: none; } }
@keyframes focal-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { :host, .spinner { animation: none !important; } }
`;

const SHEETS = {
  strip: `
:host {
  display: flex !important; align-items: center !important; gap: 8px !important; margin: 10px 0 !important;
  padding: 8px 8px 8px 10px !important; border-radius: 12px !important; background: #09090b !important;
  border: 1px solid #27272a !important; color: #fafafa !important;
  box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 12px 32px -16px rgba(0,0,0,.45) !important;
  animation: focal-in .32s cubic-bezier(.2,.8,.2,1) both !important;
}
.mark { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 22px; height: 22px;
  border-radius: 7px; color: #fff; background: linear-gradient(135deg, #8b74ff, ${VIOLET}); box-shadow: 0 0 0 1px rgba(255,255,255,.08) inset; }
::slotted([data-focal="strip-text"]) { flex: 1 !important; min-width: 0 !important; font: 500 13px/1.4 ${FONT} !important; color: #fafafa !important; }
::slotted([data-focal="why"]) { color: #c4b8ff !important; background: transparent !important; border: 1px solid transparent !important; }
::slotted([data-focal="why"]:hover) { background: #18181b !important; color: #fff !important; }
::slotted([data-focal="undo"]) { color: #fafafa !important; background: #18181b !important; border: 1px solid #3f3f46 !important; }
::slotted([data-focal="undo"]:hover) { background: #27272a !important; }
`,
  fold: `
:host {
  display: flex !important; align-items: center !important; gap: 8px !important; margin: 8px 0 !important;
  padding: 6px 6px 6px 12px !important; border-radius: 10px !important; border: 1px dashed rgba(113,113,122,.55) !important;
  background: rgba(113,113,122,.08) !important; color: #71717a !important; font: 500 12.5px/1.4 ${FONT} !important;
  animation: focal-in .28s cubic-bezier(.2,.8,.2,1) both !important;
}
.text { flex: 1; }
::slotted(button) { color: #fafafa !important; background: #18181b !important; border: 1px solid #3f3f46 !important; height: 26px !important; }
::slotted(button:hover) { background: #27272a !important; }
`,
  // Shown before anything is read or sent, so it is quieter than the strip:
  // an invitation, not a result.
  offer: `
:host {
  display: flex !important; align-items: center !important; gap: 8px !important; margin: 10px 0 !important;
  padding: 7px 7px 7px 10px !important; border-radius: 12px !important; background: #09090b !important;
  border: 1px dashed #3f3f46 !important; color: #fafafa !important;
  box-shadow: 0 8px 24px -16px rgba(0,0,0,.45) !important;
  animation: focal-in .3s cubic-bezier(.2,.8,.2,1) both !important;
}
.mark { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 20px; height: 20px;
  border-radius: 6px; color: #fff; background: linear-gradient(135deg, #8b74ff, ${VIOLET}); }
::slotted([data-focal="offer-text"]) { flex: 1 !important; min-width: 0 !important; font: 500 12.5px/1.4 ${FONT} !important; color: #d4d4d8 !important; }
::slotted([data-focal="enable"]) { color: #fff !important; background: ${VIOLET} !important; border: 1px solid transparent !important; height: 26px !important; border-radius: 999px !important; }
::slotted([data-focal="enable"]:hover) { background: #7d67e0 !important; }
::slotted([data-focal="dismiss"]) { color: #a1a1aa !important; background: transparent !important; border: 1px solid transparent !important; height: 26px !important; }
::slotted([data-focal="dismiss"]:hover) { color: #fafafa !important; background: #18181b !important; }
`,
  chip: `
:host {
  display: inline-flex !important; align-items: center !important; gap: 8px !important; margin: 10px 0 !important;
  padding: 5px 6px 5px 10px !important; border-radius: 999px !important; background: #09090b !important;
  border: 1px solid #27272a !important; color: #fafafa !important; font: 500 12.5px/1.4 ${FONT} !important;
  box-shadow: 0 8px 24px -12px rgba(0,0,0,.45) !important; animation: focal-in .24s ease both !important;
}
.spinner { width: 12px; height: 12px; border-radius: 999px; border: 2px solid rgba(110,86,207,.3); border-top-color: #a594ff; animation: focal-spin .8s linear infinite; }
::slotted(button) { color: #fff !important; background: ${VIOLET} !important; border: 1px solid transparent !important; height: 24px !important; border-radius: 999px !important; }
::slotted(button:hover) { background: #7d67e0 !important; }
`,
} as const;

const PREFIX: Record<keyof typeof SHEETS, string> = {
  strip: `<span class="mark">${SPARKLE}</span>`,
  fold: "",
  offer: `<span class="mark">${SPARKLE}</span>`,
  chip: `<span class="spinner" aria-hidden="true"></span>`,
};

/** Gives `host` the focal look for `kind`; its light-DOM children render through a slot. */
export function decorate(host: HTMLElement, kind: keyof typeof SHEETS): HTMLElement {
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${BASE}${SHEETS[kind]}</style>${PREFIX[kind]}<slot></slot>`;
  return host;
}

/** Table parts can only hold rows and cells, so page-level UI goes before the whole table. */
export function blockAnchor(el: Element): Element {
  return /^(TABLE|TBODY|THEAD|TFOOT|TR)$/.test(el.tagName) ? (el.closest("table") ?? el) : el;
}

export function sparkleSvg(): string {
  return SPARKLE;
}

function motionAllowed(el: Element): boolean {
  const win = el.ownerDocument.defaultView;
  if (typeof (el as HTMLElement).animate !== "function") return false;
  return typeof win?.matchMedia !== "function" || !win.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const EASE = "cubic-bezier(.2,.8,.2,1)";

/**
 * FLIP: measure cards, run `mutate`, then slide each card from where it was to
 * where it is now. Cards in `glow` get a brief violet ring once they land.
 */
export function flip(els: Element[], mutate: () => void, glow: Element[] = []): void {
  const animated = els.filter(motionAllowed) as HTMLElement[];
  const before = new Map(animated.map((el) => [el, el.getBoundingClientRect()]));
  mutate();
  for (const el of animated) {
    const a = before.get(el)!;
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) continue;
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
      duration: Math.min(720, 360 + Math.hypot(dx, dy) * 0.18),
      easing: EASE,
    });
  }
  for (const el of glow) {
    if (!motionAllowed(el)) continue;
    (el as HTMLElement).animate(
      [
        { boxShadow: "0 0 0 0 rgba(110,86,207,0)" },
        { boxShadow: "0 0 0 4px rgba(110,86,207,.45)", offset: 0.35 },
        { boxShadow: "0 0 0 0 rgba(110,86,207,0)" },
      ],
      { duration: 1400, delay: 300, easing: "ease-out" },
    );
  }
}

/** Small pop-in for labels. */
export function popIn(el: Element): void {
  if (!motionAllowed(el)) return;
  (el as HTMLElement).animate(
    [
      { opacity: 0, transform: "translateY(2px) scale(.96)" },
      { opacity: 1, transform: "none" },
    ],
    { duration: 260, delay: 220, easing: EASE, fill: "backwards" },
  );
}
