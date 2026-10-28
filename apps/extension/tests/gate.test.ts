import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setTrustCheckForTests } from "../src/apply/apply";
import { createGate } from "../src/apply/gate";

let container: HTMLElement;

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

describe("render gate", () => {
  it("hides the list, applies before reveal when the plan is in time", () => {
    const gate = createGate(container, 300);
    expect(container.style.visibility).toBe("hidden");
    const apply = vi.fn(() => expect(container.style.visibility).toBe("hidden"));
    expect(gate.ready(apply)).toBe("before-reveal");
    expect(apply).toHaveBeenCalledOnce();
    expect(container.style.visibility).toBe("");
  });

  it("reveals after 300 ms with a ranking chip, then applies if untouched", () => {
    const gate = createGate(container, 300);
    vi.advanceTimersByTime(300);
    expect(gate.revealed).toBe(true);
    expect(document.querySelector('[data-focal="chip"]')!.textContent).toBe("focal is ranking…");
    const apply = vi.fn();
    expect(gate.ready(apply)).toBe("late-applied");
    expect(apply).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-focal="chip"]')).toBeNull();
  });

  it("offers Apply instead of moving things after the user interacted", () => {
    const gate = createGate(container, 300);
    vi.advanceTimersByTime(300);
    container.dispatchEvent(new Event("click"));
    const apply = vi.fn();
    expect(gate.ready(apply)).toBe("late-offered");
    expect(apply).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('[data-focal="apply"]')!.click();
    expect(apply).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-focal="chip"]')).toBeNull();
  });

  it("Apply ignores synthetic clicks and checks real ones against its chip", () => {
    const gate = createGate(container, 300);
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
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toBe(chip);
    expect(apply).toHaveBeenCalledOnce();
  });

  it("cancel reveals immediately and restores a prior visibility", () => {
    container.style.visibility = "visible";
    const gate = createGate(container, 300);
    gate.cancel();
    expect(container.style.visibility).toBe("visible");
    vi.advanceTimersByTime(500);
    expect(document.querySelector('[data-focal="chip"]')).toBeNull();
    expect(gate.ready(vi.fn())).toBe("cancelled");
  });
});
