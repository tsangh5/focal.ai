import { focalTrusted } from "./apply";
import { blockAnchor, decorate } from "./ui";

export const GATE_MS = 300;

export type GateOutcome = "before-reveal" | "late-applied" | "late-offered" | "cancelled";

export interface RenderGate {
  /**
   * Call when the plan is ready. `apply` runs now or behind an "Apply" chip.
   * `offer` is for reruns: true when the plan would change what is on screen.
   */
  ready(apply: () => void, offer?: boolean): GateOutcome;
  /** No plan (no list, nothing to lift, error) or a newer one: reveal, retire any chip, clean up. */
  cancel(): void;
}

/**
 * The "focal found matches · Apply" chip above the list, shared by both gates.
 * Apply runs only on a trusted click while the chip is still on the page, so a
 * chip a newer run or a stand-down retired can never apply its stale plan.
 */
export function mountApplyChip(container: HTMLElement, apply: () => void): HTMLElement {
  const doc = container.ownerDocument;
  const chip = decorate(doc.createElement("div"), "chip");
  chip.setAttribute("data-focal", "chip");
  chip.setAttribute("role", "status");
  chip.textContent = "focal found matches";
  const button = doc.createElement("button");
  button.type = "button";
  button.setAttribute("data-focal", "apply");
  button.textContent = "Apply";
  button.addEventListener("click", (event) => {
    if (!chip.isConnected || !focalTrusted(event, chip)) return;
    chip.remove();
    apply();
  });
  chip.append(button);
  blockAnchor(container).before(chip);
  return chip;
}

/**
 * First-run gate (§5.7): hide the list for at most GATE_MS. A plan that arrives
 * in time is applied before the list is shown. A late plan re-orders only if the
 * user has not scrolled or clicked in the list; otherwise a chip offers Apply.
 */
export function createFirstRunGate(container: HTMLElement): RenderGate {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const prevVisibility = container.style.getPropertyValue("visibility");
  let revealed = false;
  let interacted = false;
  let settled = false;
  let chip: HTMLElement | null = null;

  container.style.setProperty("visibility", "hidden");

  const onInteract = () => {
    if (revealed) interacted = true;
  };
  const events = ["pointerdown", "click", "keydown", "wheel", "touchstart"] as const;
  for (const e of events) container.addEventListener(e, onInteract, { passive: true });
  win?.addEventListener("scroll", onInteract, { passive: true });

  const reveal = () => {
    if (revealed) return;
    revealed = true;
    if (prevVisibility) container.style.setProperty("visibility", prevVisibility);
    else container.style.removeProperty("visibility");
  };

  const detach = () => {
    for (const e of events) container.removeEventListener(e, onInteract);
    win?.removeEventListener("scroll", onInteract);
  };

  const timer = setTimeout(() => {
    reveal();
    if (settled) return;
    chip = decorate(doc.createElement("div"), "chip");
    chip.setAttribute("data-focal", "chip");
    chip.setAttribute("role", "status");
    chip.textContent = "focal is ranking…";
    blockAnchor(container).before(chip);
  }, GATE_MS);

  return {
    ready(apply) {
      if (settled) return "cancelled";
      settled = true;
      clearTimeout(timer);
      detach();
      if (!revealed) {
        apply();
        reveal();
        return "before-reveal";
      }
      chip?.remove();
      chip = null;
      if (!interacted) {
        apply();
        return "late-applied";
      }
      // Kept, so cancel() retires it when the list goes or a newer run starts.
      chip = mountApplyChip(container, apply);
      return "late-offered";
    },
    cancel() {
      settled = true;
      clearTimeout(timer);
      chip?.remove();
      chip = null;
      reveal();
      detach();
    },
  };
}

/**
 * Rerun gate (§5.7): the list has been shown once, so a rerun never hides it,
 * sets no timer, shows no "ranking…" chip and listens for nothing. The plan is
 * applied in place, unless `offer` says it would change what is on screen;
 * then the Apply chip offers it instead.
 */
export function createRerunGate(container: HTMLElement): RenderGate {
  let settled = false;
  let chip: HTMLElement | null = null;
  return {
    ready(apply, offer = false) {
      if (settled) return "cancelled";
      settled = true;
      if (!offer) {
        apply();
        return "late-applied";
      }
      chip = mountApplyChip(container, apply);
      return "late-offered";
    },
    cancel() {
      settled = true;
      chip?.remove();
      chip = null;
    },
  };
}
