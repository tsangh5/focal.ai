import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setTrustCheckForTests } from "../src/apply/apply";
import { createFirstRunGate, createRerunGate } from "../src/apply/gate";

let container: HTMLElement;
const chips = () => document.querySelectorAll('[data-focal="chip"]');

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom's .click() is untrusted; tests that need the real check reset this.
  __setTrustCheckForTests(() => true);
  document.body.innerHTML = '<div id="list"><div>a</div><div>b</div></div>';
  container = document.getElementById("list")!;
});
afterEach(() => {
  vi.useRealTimers();
  __setTrustCheckForTests(undefined);
});

describe("first-run gate", () => {
  it("hides the list, applies before reveal when the plan is in time", () => {
    const gate = createFirstRunGate(container);
    expect(container.style.visibility).toBe("hidden");
    const apply = vi.fn(() => expect(container.style.visibility).toBe("hidden"));
    expect(gate.ready(apply)).toBe("before-reveal");
    expect(apply).toHaveBeenCalledOnce();
    expect(container.style.visibility).toBe("");
  });

  it("reveals after 300 ms with a ranking chip, then applies if untouched", () => {
    const gate = createFirstRunGate(container);
    vi.advanceTimersByTime(300);
    expect(container.style.visibility).toBe("");
    expect(document.querySelector('[data-focal="chip"]')!.textContent).toBe("focal is ranking…");
    const apply = vi.fn();
    expect(gate.ready(apply)).toBe("late-applied");
    expect(apply).toHaveBeenCalledOnce();
    expect(chips()).toHaveLength(0);
  });

  it("offers Apply instead of moving things after the user interacted", () => {
    const gate = createFirstRunGate(container);
    vi.advanceTimersByTime(300);
    container.dispatchEvent(new Event("click"));
    const apply = vi.fn();
    expect(gate.ready(apply)).toBe("late-offered");
    expect(apply).not.toHaveBeenCalled();
    expect(chips()).toHaveLength(1);
    expect(chips()[0]!.textContent).toBe("focal found matchesApply");
    document.querySelector<HTMLButtonElement>('[data-focal="apply"]')!.click();
    expect(apply).toHaveBeenCalledOnce();
    expect(chips()).toHaveLength(0);
  });

  it("Apply ignores synthetic clicks and checks real ones against its chip", () => {
    const gate = createFirstRunGate(container);
    vi.advanceTimersByTime(300);
    container.dispatchEvent(new Event("click"));
    const apply = vi.fn();
    expect(gate.ready(apply)).toBe("late-offered");
    const chip = document.querySelector('[data-focal="chip"]')!;
    const button = document.querySelector<HTMLButtonElement>('[data-focal="apply"]')!;

    __setTrustCheckForTests(undefined);
    button.click();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 5, clientY: 5 }));
    expect(apply).not.toHaveBeenCalled();
    expect(chip.isConnected).toBe(true);

    const hosts: Element[] = [];
    __setTrustCheckForTests((_ev, host) => {
      hosts.push(host);
      return true;
    });
    button.click();
    expect(hosts).toEqual([chip]);
    expect(apply).toHaveBeenCalledOnce();
  });

  it("cancel reveals immediately and restores a prior visibility", () => {
    container.style.visibility = "visible";
    const gate = createFirstRunGate(container);
    gate.cancel();
    expect(container.style.visibility).toBe("visible");
    vi.advanceTimersByTime(500);
    expect(chips()).toHaveLength(0);
    expect(gate.ready(vi.fn())).toBe("cancelled");
  });

  it("cancel retires a late-offered chip, and its Apply can no longer run", () => {
    const gate = createFirstRunGate(container);
    vi.advanceTimersByTime(300);
    container.dispatchEvent(new Event("pointerdown"));
    const apply = vi.fn();
    expect(gate.ready(apply)).toBe("late-offered");
    const button = document.querySelector<HTMLButtonElement>('[data-focal="apply"]')!;
    gate.cancel();
    expect(chips()).toHaveLength(0);
    button.click();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("rerun gate", () => {
  it("never hides the list, sets no timer, mounts no chip and listens for nothing", () => {
    const add = vi.spyOn(container, "addEventListener");
    const winAdd = vi.spyOn(window, "addEventListener");
    const gate = createRerunGate(container);
    expect(container.style.getPropertyValue("visibility")).toBe("");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(chips()).toHaveLength(0);
    expect(add).not.toHaveBeenCalled();
    expect(winAdd).not.toHaveBeenCalled();
    const apply = vi.fn();
    expect(gate.ready(apply, false)).toBe("late-applied");
    expect(apply).toHaveBeenCalledOnce();
    expect(chips()).toHaveLength(0);
  });

  it("a site's own inline visibility survives ready and cancel", () => {
    container.style.setProperty("visibility", "hidden");
    createRerunGate(container).ready(vi.fn(), false);
    expect(container.style.getPropertyValue("visibility")).toBe("hidden");
    createRerunGate(container).cancel();
    expect(container.style.getPropertyValue("visibility")).toBe("hidden");
  });

  it("scrolling or clicking during the rank does not force an offer", () => {
    const gate = createRerunGate(container);
    window.dispatchEvent(new Event("scroll"));
    container.dispatchEvent(new Event("click"));
    const apply = vi.fn();
    expect(gate.ready(apply, false)).toBe("late-applied");
    expect(apply).toHaveBeenCalledOnce();
  });

  it("offer mounts the Apply chip; Apply runs the plan after the trust check; cancel retires it", () => {
    const gate = createRerunGate(container);
    const apply = vi.fn();
    expect(gate.ready(apply, true)).toBe("late-offered");
    expect(apply).not.toHaveBeenCalled();
    expect(chips()).toHaveLength(1);
    const hosts: Element[] = [];
    __setTrustCheckForTests((_ev, host) => {
      hosts.push(host);
      return true;
    });
    const chip = chips()[0]!;
    document.querySelector<HTMLButtonElement>('[data-focal="apply"]')!.click();
    expect(hosts).toEqual([chip]);
    expect(apply).toHaveBeenCalledOnce();
    expect(chips()).toHaveLength(0);

    const next = createRerunGate(container);
    const stale = vi.fn();
    next.ready(stale, true);
    const button = document.querySelector<HTMLButtonElement>('[data-focal="apply"]')!;
    next.cancel();
    expect(chips()).toHaveLength(0);
    button.click();
    expect(stale).not.toHaveBeenCalled();
    expect(next.ready(vi.fn(), false)).toBe("cancelled");
  });
});
