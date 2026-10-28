import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { __setTrustCheckForTests, applyPlan, focalClickTrusted } from "../src/apply/apply";
import { detectList, snapshotCards } from "../src/detect/detect";
import type { RenderPlan, RenderOp } from "../src/types";
import { BOOK_LIST, RESTAURANT_GRID } from "./fixtures";

const page = (html: string) => new JSDOM(`<body>${html}</body>`, { url: "https://www.example.com/" }).window.document;

const plan = (ops: RenderOp[], lifted = 1): RenderPlan => ({
  id: "p1",
  pageId: "page1",
  createdAt: "2026-10-20T00:00:00Z",
  ops,
  summary: { moved: lifted, collapsed: 0, unresolved: 0, avgMovement: 0, lifted },
});

const titles = (els: Iterable<Element>) => [...els].map((el) => el.querySelector("h3, b")?.textContent ?? el.className);

describe("applyPlan", () => {
  // jsdom's .click() is untrusted, so these tests bypass the trust check.
  beforeEach(() => __setTrustCheckForTests(() => true));
  afterEach(() => __setTrustCheckForTests(undefined));

  it("uses CSS order for grid containers without moving nodes", () => {
    const d = page(RESTAURANT_GRID);
    const list = detectList(d)!;
    const before = [...list.container.children];
    const handle = applyPlan(list, plan([{ op: "reorder", containerId: "x", order: ["c2", "c0", "c1", "c3"] }]));
    expect(handle.mode).toBe("css-order");
    expect([...list.container.children]).toEqual(before);
    const byOrder = before.slice().sort((a, b) => Number((a as HTMLElement).style.order) - Number((b as HTMLElement).style.order));
    expect(titles(byOrder)).toEqual(["Chuko", "Rintaro", "ad-slot", "Ippudo", "Okonomi"]);
  });

  it("moves nodes for block lists and keeps non-card siblings in their slots", () => {
    const d = page(BOOK_LIST.replace("<li><a href=\"/book/3\">", '<li class="sep">—</li><li><a href="/book/3">'));
    const list = detectList(d)!;
    const handle = applyPlan(list, plan([{ op: "reorder", containerId: "x", order: ["c4", "c3"] }], 2));
    expect(handle.mode).toBe("move");
    expect(titles(list.container.children)).toEqual(["Pachinko", "Circe", "sep", "The Overstory", "Piranesi", "Klara and the Sun"]);
  });

  it("keeps cards the plan doesn't know in their place among the others", () => {
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    applyPlan(list, plan([{ op: "reorder", containerId: "x", order: ["c3", "c0", "c4"] }], 1));
    expect(titles(list.container.children)).toEqual(["Circe", "The Overstory", "Piranesi", "Klara and the Sun", "Pachinko"]);
  });

  it("puts labels in the text column of side-by-side cards", () => {
    const cards = ["Dune", "Emma", "Ulysses"].map((t, i) => `<li><div style="display:flex"><div><a href="/t/${i}"><img alt="${t} poster"></a></div><div><a href="/t/${i}"><h3>${t}</h3></a><span>2021</span></div></div></li>`).join("");
    const d = page(`<ul>${cards}</ul>`);
    const list = detectList(d)!;
    applyPlan(list, plan([{ op: "annotate", containerId: "x", clientId: "c1", text: "Top pick for you", badge: "top-pick" }], 0));
    const label = d.querySelector('[data-focal="label"]')!;
    expect(label.nextElementSibling!.querySelector("h3")!.textContent).toBe("Emma");
  });

  it("puts labels inside a cell for table rows", () => {
    const rows = ["Dune", "Emma", "Ulysses", "Beloved"].map((t, i) => `<tr><td>${i + 1}</td><td><a href="/book/${i}"><b>${t}</b></a><span>Author ${i}</span></td><td>4.${i}</td></tr>`).join("");
    const d = page(`<table><tbody>${rows}</tbody></table>`);
    const list = detectList(d)!;
    expect(list.container.tagName).toBe("TBODY");
    const handle = applyPlan(
      list,
      plan([
        { op: "reorder", containerId: "x", order: ["c2", "c0", "c1", "c3"] },
        { op: "annotate", containerId: "x", clientId: "c2", text: "Top pick for you", badge: "top-pick" },
        { op: "collapse", containerId: "x", clientIds: ["c3"], label: "1 hidden by your rules" },
      ]),
    );
    expect(d.querySelector('[data-focal="fold"]')!.closest("tr")!.parentElement!.tagName).toBe("TBODY");
    const label = d.querySelector('[data-focal="label"]')!;
    expect(label.parentElement!.tagName).toBe("TD");
    expect(d.querySelector('[data-focal="strip"]')!.nextElementSibling!.tagName).toBe("TABLE");
    expect([...d.querySelectorAll("tr")].every((tr) => [...tr.children].every((c) => c.tagName === "TD"))).toBe(true);
    handle.undo();
    expect(d.querySelector('[data-focal="label"]')).toBeNull();
  });

  it("Undo restores the original DOM order and removes everything focal added", () => {
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    const container = list.container;
    const originalHtml = container.outerHTML;
    const onUndo = vi.fn();
    const handle = applyPlan(
      list,
      plan([
        { op: "reorder", containerId: "x", order: ["c3", "c0", "c1", "c2", "c4"] },
        { op: "annotate", containerId: "x", clientId: "c3", text: "Top pick for you", badge: "top-pick" },
        { op: "emphasize", containerId: "x", clientId: "c3", level: "high" },
        { op: "collapse", containerId: "x", clientIds: ["c4"], label: "1 hidden by your rules (chain)" },
      ]),
      { onUndo },
    );
    expect(d.querySelector('[data-focal="strip"]')).not.toBeNull();
    d.querySelector<HTMLButtonElement>('[data-focal="undo"]')!.click();
    expect(handle.active).toBe(false);
    expect(onUndo).toHaveBeenCalledOnce();
    expect(container.outerHTML).toBe(originalHtml);
    expect(d.querySelector("[data-focal]")).toBeNull();
  });

  it("onUserUndo fires for the strip's Undo click only, never for a programmatic undo", () => {
    const ops: RenderOp[] = [{ op: "reorder", containerId: "x", order: ["c3", "c0"] }];
    const programmatic = vi.fn();
    applyPlan(detectList(page(BOOK_LIST))!, plan(ops), { onUserUndo: programmatic }).undo();
    expect(programmatic).not.toHaveBeenCalled();

    const d = page(BOOK_LIST);
    const onUserUndo = vi.fn();
    const handle = applyPlan(detectList(d)!, plan(ops), { onUserUndo });
    d.querySelector<HTMLButtonElement>('[data-focal="undo"]')!.click();
    expect(handle.active).toBe(false);
    expect(onUserUndo).toHaveBeenCalledOnce();
  });

  it("site click handlers still work after reordering", () => {
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    const clicked = vi.fn();
    list.cards.get("c2")!.querySelector("a")!.addEventListener("click", (e) => {
      e.preventDefault();
      clicked();
    });
    applyPlan(list, plan([{ op: "reorder", containerId: "x", order: ["c2"] }]));
    (list.container.firstElementChild!.querySelector("a") as HTMLAnchorElement).click();
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("adds labels with the badge and fold lines with Show", () => {
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    applyPlan(
      list,
      plan(
        [
          { op: "annotate", containerId: "x", clientId: "c1", text: "Good match · because you like Circe", badge: "good-match" },
          { op: "collapse", containerId: "x", clientIds: ["c3", "c4"], label: "2 hidden by your rules (chain)" },
        ],
        0,
      ),
    );
    const label = list.cards.get("c1")!.firstElementChild!;
    expect(label.getAttribute("data-badge")).toBe("good-match");
    expect(label.shadowRoot!.textContent).toBe("Good match · because you like Circe");
    const c3 = list.cards.get("c3") as HTMLElement;
    expect(c3.style.display).toBe("none");
    const fold = d.querySelector('[data-focal="fold"]')!;
    expect(fold.nextElementSibling).toBe(c3);
    expect(fold.textContent).toContain("2 hidden by your rules (chain)");
    fold.querySelector("button")!.click();
    expect(c3.style.display).toBe("");
    expect(d.querySelector('[data-focal="fold"]')).toBeNull();
  });

  const fold = (...clientIds: string[]): RenderOp => ({ op: "collapse", containerId: "x", clientIds, label: `${clientIds.length} hidden by your rules` });

  it("Show gives a folded card back its whole inline style, and no style attribute if it had none", () => {
    const d = page(BOOK_LIST.replace('<li><a href="/book/4">', '<li style="display:flex;gap:4px"><a href="/book/4">'));
    const list = detectList(d)!;
    const [circe, pachinko] = [list.cards.get("c3"), list.cards.get("c4")] as HTMLElement[];
    applyPlan(list, plan([fold("c3", "c4")], 0));
    expect(circe!.style.display).toBe("none");
    d.querySelector<HTMLButtonElement>('[data-focal="show"]')!.click();
    expect(circe!.getAttribute("style")).toBe("display:flex;gap:4px");
    expect(pachinko!.hasAttribute("style")).toBe(false);
    expect(d.querySelector("[data-focal-hidden]")).toBeNull();
  });

  it("hides a card whose site CSS sets display with !important", () => {
    const d = page(`<style>.list li { display: flex !important }</style>${BOOK_LIST}`);
    const list = detectList(d)!;
    const pachinko = list.cards.get("c4") as HTMLElement;
    const shown = () => d.defaultView!.getComputedStyle(pachinko).display;
    expect(shown()).toBe("flex");
    applyPlan(list, plan([fold("c4")], 0));
    expect(shown()).toBe("none");
    d.querySelector<HTMLButtonElement>('[data-focal="show"]')!.click();
    expect(shown()).toBe("flex");
  });

  it("Show in a CSS-order grid keeps the card where the reorder put it", () => {
    const d = page(RESTAURANT_GRID.replace('<div class="card card-1004">', '<div class="card card-1004" style="display:flex">'));
    const list = detectList(d)!;
    const okonomi = list.cards.get("c3") as HTMLElement;
    const handle = applyPlan(list, plan([{ op: "reorder", containerId: "x", order: ["c2", "c0", "c1", "c3"] }, fold("c3")]));
    expect(handle.mode).toBe("css-order");
    const order = okonomi.style.order;
    expect(order).toBe("4");
    d.querySelector<HTMLButtonElement>('[data-focal="show"]')!.click();
    expect([okonomi.style.display, okonomi.style.order]).toEqual(["flex", order]);
    handle.undo();
    expect(okonomi.getAttribute("style")).toBe("display:flex");
  });

  it("a folded card is still a card to the next detection, so later mutations don't look like removals", () => {
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    const handle = applyPlan(list, plan([fold("c3", "c4")], 0));
    expect((list.cards.get("c3") as HTMLElement).style.display).toBe("none");
    const again = detectList(d)!;
    expect(again.container).toBe(list.container);
    expect([...again.cards.values()]).toEqual([...list.cards.values()]);
    expect(snapshotCards(again).map((c) => c.snippets[0])).toEqual(["The Overstory", "Piranesi", "Klara and the Sun", "Circe", "Pachinko"]);
    handle.undo();
    expect(d.querySelector("[data-focal-hidden]")).toBeNull();
  });

  it("focal's own nodes are invisible to detection: a labelled class-less card keeps its shape, group and snippets", () => {
    const d = page(BOOK_LIST);
    const before = detectList(d)!;
    applyPlan(before, plan([{ op: "annotate", containerId: "x", clientId: "c1", text: "Top pick for you", badge: "top-pick" }], 0));
    // focal UI that keeps its text in light DOM, like the fold line and the strip.
    before.cards.get("c3")!.insertAdjacentHTML("afterbegin", '<focal-label data-focal="label"><span>Good match · because you like Circe</span></focal-label>');
    const after = detectList(d)!;
    expect(after.container).toBe(before.container);
    expect([...after.cards.values()]).toEqual([...before.cards.values()]);
    expect(after.signature).toBe(before.signature);
    expect(JSON.stringify(snapshotCards(after))).not.toMatch(/Top pick|Good match/);
  });

  it("move-mode Undo puts the originals back first, in their order, then what the site appended since", () => {
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    const container = list.container;
    const originalHtml = container.innerHTML;
    const handle = applyPlan(list, plan([{ op: "reorder", containerId: "x", order: ["c4", "c3", "c0", "c1", "c2"] }], 2));
    expect(handle.mode).toBe("move");
    // Infinite scroll loads two more after the reorder.
    const more =
      '<li><a href="/book/6"><b>Middlemarch</b></a><div>George Eliot</div><div>1871</div></li>' +
      '<li><a href="/book/7"><b>Beloved</b></a><div>Toni Morrison</div><div>1987</div></li>';
    container.insertAdjacentHTML("beforeend", more);
    handle.undo();
    expect(titles(container.children)).toEqual(["The Overstory", "Piranesi", "Klara and the Sun", "Circe", "Pachinko", "Middlemarch", "Beloved"]);
    expect(container.innerHTML).toBe(originalHtml + more);
  });

  it("Why this order? calls back", () => {
    const d = page(BOOK_LIST);
    const onWhy = vi.fn();
    applyPlan(detectList(d)!, plan([{ op: "reorder", containerId: "x", order: ["c1"] }]), { onWhy });
    d.querySelector<HTMLButtonElement>('[data-focal="why"]')!.click();
    expect(onWhy).toHaveBeenCalledOnce();
    expect(d.querySelector('[data-focal="strip-text"]')!.textContent).toBe("focal lifted 1 match for your taste");
  });

  it("Undo restores grid order styles", () => {
    const d = page(RESTAURANT_GRID);
    const list = detectList(d)!;
    const html = list.container.outerHTML;
    applyPlan(list, plan([{ op: "reorder", containerId: "x", order: ["c3"] }])).undo();
    expect(list.container.outerHTML).toBe(html);
  });

  it("extend labels newly loaded cards in place and keeps them after the lifted ones in CSS order", () => {
    const d = page(RESTAURANT_GRID);
    const list = detectList(d)!;
    const handle = applyPlan(list, plan([{ op: "reorder", containerId: "x", order: ["c2", "c0", "c1", "c3"] }]));
    const orderBefore = [...list.container.children].map((el) => (el as HTMLElement).style.order);
    const card = d.createElement("div");
    card.className = "card card-1005";
    card.innerHTML = '<a href="/biz/nakamura"><h3>Nakamura</h3></a><p>Ramen · $$</p><span>172 Delancey St</span>';
    list.container.append(card);
    handle.extend([{ op: "annotate", containerId: "x", clientId: "c9", text: "Good match", badge: "good-match" }], new Map([["c9", card]]));
    expect([...list.container.children].slice(0, -1).map((el) => (el as HTMLElement).style.order)).toEqual(orderBefore);
    expect(Number(card.style.order)).toBeGreaterThan(Math.max(...orderBefore.map(Number)));
    expect(card.querySelector('[data-focal="label"]')).not.toBeNull();
    handle.undo();
    expect(card.querySelector('[data-focal="label"]')).toBeNull();
    expect(card.getAttribute("style")).toBeNull();
  });

  it("labels carry More like this / Not for me that report the card and show the result", async () => {
    const d = page(BOOK_LIST);
    const onFeedback = vi.fn(async () => true);
    applyPlan(detectList(d)!, plan([{ op: "annotate", containerId: "x", clientId: "c1", text: "Top pick for you · because you like Circe", badge: "top-pick" }], 0), { onFeedback });
    const root = d.querySelector('[data-focal="label"]')!.shadowRoot!;
    const more = root.querySelector<HTMLButtonElement>('button[data-verdict="more"]')!;
    expect(more.getAttribute("aria-label")).toBe("More like this");
    expect(root.querySelector('button[data-verdict="less"]')!.getAttribute("aria-label")).toBe("Not for me");
    more.click();
    await vi.waitFor(() => expect(root.querySelector('[role="status"]')!.textContent).toBe("Saved · more like this"));
    expect(onFeedback).toHaveBeenCalledWith("c1", "more");
    expect(root.querySelector("button")).toBeNull();
  });

  it("feedback that fails to save re-enables the buttons", async () => {
    const d = page(BOOK_LIST);
    applyPlan(detectList(d)!, plan([{ op: "annotate", containerId: "x", clientId: "c0", text: "Good match", badge: "good-match" }], 0), { onFeedback: async () => false });
    const root = d.querySelector('[data-focal="label"]')!.shadowRoot!;
    root.querySelector<HTMLButtonElement>('button[data-verdict="less"]')!.click();
    await vi.waitFor(() => expect(root.querySelector('[role="status"]')!.textContent).toBe("Couldn't save, try again"));
    expect([...root.querySelectorAll("button")].every((b) => !b.disabled)).toBe(true);
  });
});

// jsdom has no layout: every rect is zero and elementsFromPoint is missing, so tests stub both.
const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
const fakeClick = (button: Element, init: { isTrusted?: boolean; detail?: number; clientX?: number; clientY?: number } = {}) =>
  ({ isTrusted: true, detail: 1, clientX: 30, clientY: 20, currentTarget: button, target: button, ...init }) as unknown as MouseEvent;
/** Hands a dispatched (untrusted) jsdom click to the real check as if the browser had made it. */
const realCheckOnTrustedCopy = (ev: Event, host: Element) => {
  const m = ev as MouseEvent;
  return focalClickTrusted(fakeClick(m.currentTarget as Element, { detail: m.detail, clientX: m.clientX, clientY: m.clientY }), host);
};

describe("focalClickTrusted", () => {
  function setup(html = '<div id="host"><button id="b">Undo</button></div>') {
    const d = page(html);
    const host = d.getElementById("host")!;
    const button = d.getElementById("b")!;
    host.getBoundingClientRect = () => rect(0, 0, 300, 40);
    button.getBoundingClientRect = () => rect(10, 8, 80, 24);
    d.elementsFromPoint = () => [button, host, d.body, d.documentElement];
    return { d, host, button };
  }

  it("rejects untrusted events however the button looks", () => {
    const { host, button } = setup();
    expect(focalClickTrusted(fakeClick(button, { isTrusted: false }), host)).toBe(false);
    expect(focalClickTrusted(fakeClick(button, { isTrusted: false, detail: 0 }), host)).toBe(false);
  });

  it("accepts trusted keyboard and assistive-tech activation (detail 0) without geometry", () => {
    const { d, host, button } = setup();
    d.elementsFromPoint = () => [];
    host.getBoundingClientRect = () => rect(500, 500, 10, 10);
    expect(focalClickTrusted(fakeClick(button, { detail: 0, clientX: 0, clientY: 0 }), host)).toBe(true);
  });

  it("accepts a trusted pointer click on the topmost, visible button inside its host", () => {
    const { host, button } = setup();
    expect(focalClickTrusted(fakeClick(button), host)).toBe(true);
  });

  it("rejects a pointer click when something else is topmost at the point", () => {
    const { d, host, button } = setup();
    const overlay = d.createElement("div");
    d.body.append(overlay);
    d.elementsFromPoint = () => [overlay, button, host];
    expect(focalClickTrusted(fakeClick(button), host)).toBe(false);
    d.elementsFromPoint = () => [];
    expect(focalClickTrusted(fakeClick(button), host)).toBe(false);
  });

  it("accepts a click whose topmost element is inside the button", () => {
    const { d, host, button } = setup('<div id="host"><button id="b"><span>Undo</span></button></div>');
    d.elementsFromPoint = () => [button.firstElementChild!, button, host];
    expect(focalClickTrusted(fakeClick(button), host)).toBe(true);
  });

  it("rejects a button under a visibility:hidden ancestor", () => {
    const { host, button } = setup('<section style="visibility:hidden"><div id="host"><button id="b">Undo</button></div></section>');
    expect(focalClickTrusted(fakeClick(button), host)).toBe(false);
  });

  it("rejects a button whose ancestors multiply out to opacity 0.1 or less", () => {
    const faint = setup('<div style="opacity:0.3"><div id="host" style="opacity:0.3"><button id="b">Undo</button></div></div>');
    expect(focalClickTrusted(fakeClick(faint.button), faint.host)).toBe(false);
    const clear = setup('<div style="opacity:0.5"><div id="host"><button id="b">Undo</button></div></div>');
    expect(focalClickTrusted(fakeClick(clear.button), clear.host)).toBe(true);
    const hidden = setup('<div id="host"><button id="b" style="opacity:0">Undo</button></div>');
    expect(focalClickTrusted(fakeClick(hidden.button), hidden.host)).toBe(false);
  });

  it("rejects a button moved outside its host, allowing 4 px of slack", () => {
    const { host, button } = setup();
    button.getBoundingClientRect = () => rect(296, -4, 8, 8); // right edge at host.right + 4
    expect(focalClickTrusted(fakeClick(button), host)).toBe(true);
    button.getBoundingClientRect = () => rect(297, 8, 8, 8); // right edge at host.right + 5
    expect(focalClickTrusted(fakeClick(button), host)).toBe(false);
    button.getBoundingClientRect = () => rect(10, 400, 80, 24);
    expect(focalClickTrusted(fakeClick(button), host)).toBe(false);
  });

  it("hit-tests a shadow-root button in its own tree and checks ancestors past the shadow host", () => {
    const d = page('<div id="card"><focal-label id="host"></focal-label></div>');
    const host = d.getElementById("host")!;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<span><button id="b">More like this</button></span>';
    const button = root.getElementById("b")!;
    host.getBoundingClientRect = () => rect(0, 0, 300, 40);
    button.getBoundingClientRect = () => rect(10, 8, 100, 22);
    // What Chrome reports: the document sees only the shadow host, the shadow root sees the button.
    d.elementsFromPoint = () => [host, d.getElementById("card")!, d.body];
    root.elementsFromPoint = () => [button, root.firstElementChild!, host];
    expect(focalClickTrusted(fakeClick(button), host)).toBe(true);
    d.getElementById("card")!.style.opacity = "0";
    expect(focalClickTrusted(fakeClick(button), host)).toBe(false);
  });
});

describe("injected buttons ignore fake and hijacked clicks", () => {
  afterEach(() => __setTrustCheckForTests(undefined));

  const fullPlan = () =>
    plan([
      { op: "reorder", containerId: "x", order: ["c3", "c0", "c1", "c2", "c4"] },
      { op: "annotate", containerId: "x", clientId: "c3", text: "Top pick for you", badge: "top-pick" },
      { op: "collapse", containerId: "x", clientIds: ["c4"], label: "1 hidden by your rules" },
    ]);

  function render() {
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    const onWhy = vi.fn();
    const onUndo = vi.fn();
    const onFeedback = vi.fn(async () => true);
    const handle = applyPlan(list, fullPlan(), { onWhy, onUndo, onFeedback });
    const label = d.querySelector<HTMLElement>('[data-focal="label"]')!;
    const fold = d.querySelector<HTMLElement>('[data-focal="fold"]')!;
    const strip = d.querySelector<HTMLElement>('[data-focal="strip"]')!;
    const button = (sel: string) => (label.shadowRoot!.querySelector<HTMLButtonElement>(sel) ?? d.querySelector<HTMLButtonElement>(sel))!;
    return { d, list, handle, onWhy, onUndo, onFeedback, label, fold, strip, button };
  }

  it("synthetic clicks do nothing on More like this, Not for me, Show, Why and Undo", async () => {
    const r = render();
    for (const sel of ['button[data-verdict="more"]', 'button[data-verdict="less"]', '[data-focal="show"]', '[data-focal="why"]', '[data-focal="undo"]']) {
      r.button(sel).click();
      r.button(sel).dispatchEvent(new r.d.defaultView!.MouseEvent("click", { bubbles: true, detail: 1, clientX: 20, clientY: 20 }));
    }
    await Promise.resolve();
    expect(r.onFeedback).not.toHaveBeenCalled();
    expect(r.onWhy).not.toHaveBeenCalled();
    expect(r.onUndo).not.toHaveBeenCalled();
    expect(r.handle.active).toBe(true);
    expect(r.d.querySelector('[data-focal="fold"]')).not.toBeNull();
    expect((r.list.cards.get("c4") as HTMLElement).style.display).toBe("none");
  });

  it("each button checks against the focal element that visually contains it", () => {
    const r = render();
    const named = new Map<Element, string>([
      [r.label, "label"],
      [r.fold, "fold"],
      [r.strip, "strip"],
    ]);
    const hosts: string[] = [];
    __setTrustCheckForTests((ev, host) => {
      const button = ev.currentTarget as Element;
      hosts.push(`${button.getAttribute("data-verdict") ?? button.getAttribute("data-focal")} → ${named.get(host) ?? host.tagName}`);
      return false;
    });
    for (const sel of ['button[data-verdict="more"]', 'button[data-verdict="less"]', '[data-focal="show"]', '[data-focal="why"]', '[data-focal="undo"]']) r.button(sel).click();
    expect(hosts).toEqual(["more → label", "less → label", "show → fold", "why → strip", "undo → strip"]);
  });

  it("a real-looking click on a label button inside its label goes through; one outside it does not", async () => {
    const r = render();
    __setTrustCheckForTests(realCheckOnTrustedCopy);
    const more = r.button('button[data-verdict="more"]');
    r.label.getBoundingClientRect = () => rect(0, 0, 300, 60);
    more.getBoundingClientRect = () => rect(10, 30, 100, 22);
    r.label.shadowRoot!.elementsFromPoint = () => [more];
    const click = () => more.dispatchEvent(new r.d.defaultView!.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: 30, clientY: 40 }));

    more.getBoundingClientRect = () => rect(10, 300, 100, 22); // dragged out of the label
    click();
    expect(r.onFeedback).not.toHaveBeenCalled();

    more.getBoundingClientRect = () => rect(10, 30, 100, 22);
    click();
    expect(r.onFeedback).toHaveBeenCalledWith("c3", "more");
  });

  it("a real-looking click on the strip's Undo goes through unless an overlay covers it", () => {
    const r = render();
    __setTrustCheckForTests(realCheckOnTrustedCopy);
    const undo = r.button('[data-focal="undo"]');
    r.strip.getBoundingClientRect = () => rect(0, 0, 600, 44);
    undo.getBoundingClientRect = () => rect(500, 8, 60, 28);
    const click = () => undo.dispatchEvent(new r.d.defaultView!.MouseEvent("click", { bubbles: true, detail: 1, clientX: 520, clientY: 20 }));

    r.d.elementsFromPoint = () => [r.d.body];
    click();
    expect(r.handle.active).toBe(true);

    r.d.elementsFromPoint = () => [undo, r.strip];
    click();
    expect(r.handle.active).toBe(false);
    expect(r.onUndo).toHaveBeenCalledOnce();
  });
});
