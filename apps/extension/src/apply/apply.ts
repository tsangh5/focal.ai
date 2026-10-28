import type { RenderOp, RenderPlan } from "../types";
import { blockAnchor, decorate, flip, popIn, sparkleSvg, VIOLET } from "./ui";

export const FOCAL_ATTR = "data-focal";

export interface ApplyTarget {
  container: Element;
  cards: Map<string, Element>;
}

export type Verdict = "more" | "less";

export interface ApplyOptions {
  onWhy?: () => void;
  onUndo?: () => void;
  /** "More like this" / "Not for me" on a label; resolves whether it was saved. */
  onFeedback?: (clientId: string, verdict: Verdict) => Promise<boolean>;
  /** Force a mode; by default flex / grid containers use CSS order. */
  mode?: "css-order" | "move";
}

export interface ApplyHandle {
  mode: "css-order" | "move";
  lifted: number;
  undo(): void;
  /** Labels, highlights and folds for cards that arrived later; never reorders (§5.7). */
  extend(ops: RenderOp[], more: Map<string, Element>): void;
  readonly active: boolean;
}

type TrustCheck = (ev: Event, host: Element) => boolean;

/** The element `el` is drawn inside: its slot when slotted, else its parent, stepping out of shadow roots to their host. */
function renderedParent(el: Element): Element | null {
  return el.assignedSlot ?? el.parentElement ?? (el.parentNode as ShadowRoot | null)?.host ?? null;
}

/**
 * True for a real click on a button focal put on the page; false for a
 * synthetic one (page script calling .click() or dispatchEvent) or a hijacked
 * one. Keyboard and assistive-tech activation (detail 0) only needs isTrusted.
 * A pointer click also needs the button topmost at the click point, no hidden
 * or near-transparent ancestor, and the button inside `host`, the focal
 * element that visually contains it (±4 px).
 */
export function focalClickTrusted(ev: Event, host: Element): boolean {
  if (ev.isTrusted !== true) return false;
  const { detail, clientX, clientY } = ev as MouseEvent;
  if (detail === 0) return true;
  const button = (ev.currentTarget ?? ev.target) as Element | null;
  const view = button?.ownerDocument?.defaultView;
  if (!button || button.nodeType !== 1 || !view || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
  // Hit-test in the button's own tree: for a button in a shadow root (label
  // feedback) the document only reports the shadow host.
  const scope = button.getRootNode() as Document | ShadowRoot;
  const top = typeof scope.elementsFromPoint === "function" ? scope.elementsFromPoint(clientX, clientY)[0] : undefined;
  if (!top || !button.contains(top)) return false;
  let opacity = 1;
  for (let el: Element | null = button; el; el = renderedParent(el)) {
    const style = view.getComputedStyle(el);
    if (style.visibility === "hidden") return false;
    const own = parseFloat(style.opacity);
    if (!Number.isNaN(own)) opacity *= own;
  }
  if (opacity <= 0.1) return false;
  const b = button.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  return b.left >= h.left - 4 && b.top >= h.top - 4 && b.right <= h.right + 4 && b.bottom <= h.bottom + 4;
}

let trustCheck: TrustCheck = focalClickTrusted;

/** Every injected button's click handler asks this first and does nothing when it says no. */
export function focalTrusted(ev: Event, host: Element): boolean {
  return trustCheck(ev, host);
}

/** Tests only: jsdom can't make trusted clicks, so swap the check; undefined restores the real one. */
export function __setTrustCheckForTests(fn: TrustCheck | undefined): void {
  trustCheck = fn ?? focalClickTrusted;
}

function isFlexOrGrid(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  const display = view?.getComputedStyle(el).display ?? (el as HTMLElement).style.display;
  return /(^|-)(flex|grid)$/.test(display);
}

/** Records an element's original style attribute once, for Undo. */
function saveStyle(el: HTMLElement, saved: Map<HTMLElement, string | null>): void {
  if (!saved.has(el)) saved.set(el, el.getAttribute("style"));
}

function make(doc: Document, tag: string, kind: string, text?: string): HTMLElement {
  const el = doc.createElement(tag);
  el.setAttribute(FOCAL_ATTR, kind);
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * New child sequence for the container: lifted cards first, then every other
 * card. Cards the plan doesn't know (unidentified, past the 60-card cap) keep
 * their place among the others. Anything that is not a card keeps its slot.
 */
function sequenceFor(container: Element, cards: Map<string, Element>, order: string[], lifted: number): Element[] {
  const inContainer = [...cards.values()].filter((el) => el.parentElement === container);
  const cardSet = new Set(inContainer);
  const pick = (ids: string[]) => ids.map((id) => cards.get(id)).filter((el): el is Element => !!el && cardSet.has(el));
  const top = pick(order.slice(0, lifted));
  const planned = pick(order.slice(lifted));
  const known = new Set([...top, ...planned]);
  const pending = inContainer.filter((el) => !known.has(el));
  const pos = new Map(inContainer.map((el, i) => [el, i]));
  const queue = [...top];
  for (const el of planned) {
    while (pending.length > 0 && pos.get(pending[0]!)! < pos.get(el)!) queue.push(pending.shift()!);
    queue.push(el);
  }
  queue.push(...pending);
  return [...container.children].map((child) => (cardSet.has(child) ? (queue.shift() ?? child) : child));
}

const hasTitleLink = (el: Element) => !!el.querySelector("a[href]") && (el.textContent ?? "").trim().length > 1;

/**
 * Where a label goes: the main cell for table rows, the text column for
 * side-by-side cards (poster left, text right), else the card itself.
 */
function labelSlot(card: HTMLElement): HTMLElement {
  if (card.tagName === "TR") {
    const cells = [...card.children].filter((c): c is HTMLElement => c.tagName === "TD" || c.tagName === "TH");
    return cells.find(hasTitleLink) ?? cells.find((c) => (c.textContent ?? "").trim().length > 1) ?? cells[0] ?? card;
  }
  return textColumnByLayout(card) ?? textColumnByStyle(card);
}

function titleOf(card: HTMLElement): HTMLElement | null {
  const heading = card.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"]');
  if (heading) return heading;
  return [...card.querySelectorAll<HTMLElement>("a[href]")].find((a) => (a.textContent ?? "").trim().length > 1) ?? null;
}

/** Highest ancestor of the title that sits clearly right of the card's left edge. */
function textColumnByLayout(card: HTMLElement): HTMLElement | null {
  const box = card.getBoundingClientRect();
  const title = titleOf(card);
  if (box.width === 0 || !title || title.getBoundingClientRect().left - box.left < 24) return null;
  let col = title;
  while (col.parentElement && col.parentElement !== card && col.parentElement.getBoundingClientRect().left - box.left >= 24) col = col.parentElement;
  return /^(A|BUTTON)$/.test(col.tagName) && col.parentElement ? col.parentElement : col;
}

function textColumnByStyle(card: HTMLElement): HTMLElement {
  let slot = card;
  let el: HTMLElement = card;
  for (let depth = 0; depth < 4 && !/^(A|BUTTON)$/.test(el.tagName); depth++) {
    const kids = [...el.children].filter((c): c is HTMLElement => !c.hasAttribute(FOCAL_ATTR));
    if (kids.length === 1) {
      el = kids[0]!;
      continue;
    }
    const title = titleOf(el);
    const text = kids.length > 1 && isFlexOrGrid(el) && title ? kids.find((k) => k.tagName !== "A" && k.contains(title)) : undefined;
    if (!text) break;
    slot = el = text;
  }
  return slot;
}

const LABEL_STYLE: Record<string, string> = {
  "top-pick": `background:linear-gradient(135deg,#8b74ff,${VIOLET});color:#fff;border:1px solid rgba(255,255,255,.12)`,
  "good-match": "background:#18181b;color:#fafafa;border:1px solid #3f3f46",
  // Something the user already saved: outlined rather than filled, so a known
  // favourite does not shout louder than a genuine new match.
  favourite: `background:#18181b;color:#c4b8ff;border:1px solid ${VIOLET}`,
};

const FEEDBACK_STYLE =
  "all:unset;box-sizing:border-box;display:inline-flex;align-items:center;height:22px;padding:0 8px;margin:0 0 0 4px;" +
  'border-radius:999px;cursor:pointer;font:500 11.5px/1 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
  "color:#fafafa;background:#18181b;border:1px solid #3f3f46;white-space:nowrap";

const FEEDBACK_TEXT: Record<Verdict, { label: string; done: string }> = {
  more: { label: "More like this", done: "Saved · more like this" },
  less: { label: "Not for me", done: "Saved · not for you" },
};

/** `host` is the label the buttons sit in, the box a real click has to land inside. */
function feedbackButtons(doc: Document, host: HTMLElement, onFeedback: (verdict: Verdict) => Promise<boolean>, compact: boolean): HTMLElement {
  const row = doc.createElement("span");
  row.setAttribute("style", "display:inline-flex;align-items:center;flex-wrap:wrap;gap:0;vertical-align:middle");
  const status = doc.createElement("span");
  status.setAttribute("role", "status");
  status.setAttribute("style", 'margin-left:6px;font:500 11.5px/1 ui-sans-serif,system-ui,sans-serif;color:#a1a1aa');
  const buttons = (["more", "less"] as const).map((verdict) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.setAttribute("data-verdict", verdict);
    b.setAttribute("aria-label", FEEDBACK_TEXT[verdict].label);
    b.title = FEEDBACK_TEXT[verdict].label;
    b.textContent = compact ? (verdict === "more" ? "+" : "−") : FEEDBACK_TEXT[verdict].label;
    b.setAttribute("style", FEEDBACK_STYLE);
    b.addEventListener("click", (event) => {
      // The label sits inside the site's card, which is often a link.
      event.preventDefault();
      event.stopPropagation();
      if (!focalTrusted(event, host)) return;
      for (const other of buttons) other.disabled = true;
      void onFeedback(verdict).then((saved) => {
        if (saved) {
          for (const other of buttons) other.remove();
          status.textContent = FEEDBACK_TEXT[verdict].done;
        } else {
          for (const other of buttons) other.disabled = false;
          status.textContent = "Couldn't save, try again";
        }
      });
    });
    return b;
  });
  row.append(...buttons, status);
  return row;
}

function labelElement(
  doc: Document,
  text: string,
  badge: string | undefined,
  compact = false,
  onFeedback?: (verdict: Verdict) => Promise<boolean>,
): HTMLElement {
  const kind = badge && badge in LABEL_STYLE ? badge : "good-match";
  const host = make(doc, "focal-label", "label");
  host.setAttribute("data-badge", badge ?? "good-match");
  const root = host.attachShadow({ mode: "open" });
  const span = doc.createElement("span");
  span.setAttribute(
    "style",
    "display:inline-flex;align-items:center;gap:5px;max-width:100%;margin:6px 0;padding:3px 9px 3px 7px;border-radius:999px;" +
      'font:500 12px/16px ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:0;' +
      "box-shadow:0 1px 2px rgba(0,0,0,.12);white-space:normal;text-align:left;" +
      LABEL_STYLE[kind],
  );
  if (kind === "top-pick") span.insertAdjacentHTML("afterbegin", sparkleSvg());
  // Narrow tiles (poster grids) get the short form; the full reason stays in the tooltip.
  span.append(doc.createTextNode(compact ? (text.split(" · ")[0] ?? text) : text));
  if (compact) span.title = text;
  root.append(span);
  if (onFeedback) root.append(feedbackButtons(doc, host, onFeedback, compact));
  // width:0 + min-width:100% fills the card without letting the label's text widen it.
  host.setAttribute("style", "all:initial;display:block;width:0;min-width:100%");
  popIn(span);
  return host;
}

/**
 * Applies a declarative plan to the site's own cards. Nodes are never
 * recreated, so the site's click handlers keep working; Undo restores the
 * original order, styles and removes everything focal inserted.
 */
export function applyPlan(target: ApplyTarget, plan: RenderPlan, opts: ApplyOptions = {}): ApplyHandle {
  const { container, cards } = target;
  const doc = container.ownerDocument;
  const mode = opts.mode ?? (isFlexOrGrid(container) ? "css-order" : "move");
  const savedStyles = new Map<HTMLElement, string | null>();
  const inserted: Element[] = [];
  const originalChildren = [...container.children];
  const originalNodes = [...container.childNodes];
  let active = true;

  const reorder = plan.ops.find((o): o is Extract<RenderOp, { op: "reorder" }> => o.op === "reorder");
  const lifted = plan.summary.lifted ?? plan.summary.moved;
  const sequence = reorder ? sequenceFor(container, cards, reorder.order, lifted) : originalChildren;
  const position = (el: Element) => (el as HTMLElement).style.getPropertyValue("order");

  /** Labels, highlights and folds; shared by the first apply and later top-ups. */
  function applyOp(op: RenderOp): void {
    if (op.op === "annotate") {
      const card = cards.get(op.clientId) as HTMLElement | undefined;
      if (!card) return;
      const slot = labelSlot(card);
      const width = slot.getBoundingClientRect().width;
      const onFeedback = opts.onFeedback;
      const label = labelElement(doc, op.text, op.badge, width > 0 && width < 160, onFeedback && ((v) => onFeedback(op.clientId, v)));
      slot.prepend(label);
      inserted.push(label);
    } else if (op.op === "emphasize") {
      const card = cards.get(op.clientId) as HTMLElement | undefined;
      if (!card) return;
      saveStyle(card, savedStyles);
      card.style.setProperty("outline", "2px solid rgba(110, 86, 207, 0.7)");
      card.style.setProperty("outline-offset", "3px");
    } else if (op.op === "collapse" || op.op === "hide") {
      const els = op.clientIds.map((id) => cards.get(id)).filter((el): el is HTMLElement => !!el);
      const first = els.slice().sort((a, b) => sequence.indexOf(a) - sequence.indexOf(b))[0];
      if (!first) return;
      for (const el of els) {
        saveStyle(el, savedStyles);
        el.style.setProperty("display", "none");
      }
      const fold = decorate(make(doc, "div", "fold"), "fold");
      fold.append(doc.createTextNode(op.label));
      let holder: HTMLElement = fold;
      if (first.tagName === "TR") {
        holder = make(doc, "tr", "fold-row");
        const cell = doc.createElement("td");
        cell.colSpan = Math.max(1, first.children.length);
        cell.append(fold);
        holder.append(cell);
      }
      if (op.op === "collapse") {
        const show = make(doc, "button", "show", "Show");
        show.setAttribute("type", "button");
        show.addEventListener("click", (event) => {
          if (!focalTrusted(event, fold)) return;
          for (const el of els) el.style.removeProperty("display");
          holder.remove();
        });
        fold.append(show);
      }
      if (mode === "css-order" && position(first)) holder.style.setProperty("order", position(first));
      first.before(holder);
      inserted.push(holder);
    }
  }

  const handle: ApplyHandle = {
    mode,
    lifted,
    get active() {
      return active;
    },
    undo() {
      if (!active) return;
      active = false;
      flip([...cards.values()], () => {
        for (const el of inserted) el.remove();
        for (const [el, style] of savedStyles) {
          if (style === null) el.removeAttribute("style");
          else el.setAttribute("style", style);
        }
        if (reorder && mode === "move") {
          for (const node of originalNodes) if (node.parentNode === container) container.appendChild(node);
        }
      });
      opts.onUndo?.();
    },
    extend(ops, more) {
      if (!active) return;
      const fresh = [...more].filter(([, el]) => ![...cards.values()].includes(el));
      for (const [id, el] of fresh) cards.set(id, el);
      flip(
        fresh.map(([, el]) => el),
        () => {
          // Cards appended after a CSS-order apply default to order 0, which would
          // slot them in next to the lifted ones; keep them at the end instead.
          if (mode === "css-order") {
            let next = container.children.length;
            for (const [, el] of fresh) {
              const h = el as HTMLElement;
              if (h.style.getPropertyValue("order")) continue;
              saveStyle(h, savedStyles);
              h.style.setProperty("order", String(next++));
            }
          }
          for (const op of ops) if (op.op !== "reorder") applyOp(op);
        },
      );
    },
  };

  const cardEls = [...cards.values()];
  const glow = reorder ? reorder.order.slice(0, lifted).map((id) => cards.get(id)).filter((el): el is Element => !!el) : [];
  flip(cardEls, () => {
    if (reorder) {
      if (mode === "css-order") {
        sequence.forEach((el, i) => {
          const h = el as HTMLElement;
          saveStyle(h, savedStyles);
          h.style.setProperty("order", String(i));
        });
      } else {
        for (const el of sequence) container.appendChild(el);
      }
    }

    for (const op of plan.ops) applyOp(op);
    if (reorder || plan.ops.some((o) => o.op === "collapse" || o.op === "hide")) blockAnchor(container).before(strip());
  }, glow);

  function strip(): HTMLElement {
    const el = decorate(make(doc, "div", "strip"), "strip");
    el.setAttribute("role", "status");
    el.append(
      make(doc, "span", "strip-text", lifted > 0 ? `focal lifted ${lifted} ${lifted === 1 ? "match" : "matches"} for your taste` : "focal applied your rules"),
    );
    if (opts.onWhy) {
      const why = make(doc, "button", "why", "Why this order?");
      why.setAttribute("type", "button");
      why.addEventListener("click", (event) => {
        if (!focalTrusted(event, el)) return;
        opts.onWhy?.();
      });
      el.append(why);
    }
    const undo = make(doc, "button", "undo", "Undo");
    undo.setAttribute("type", "button");
    undo.addEventListener("click", (event) => {
      if (!focalTrusted(event, el)) return;
      handle.undo();
    });
    el.append(undo);
    inserted.push(el);
    return el;
  }

  return handle;
}
