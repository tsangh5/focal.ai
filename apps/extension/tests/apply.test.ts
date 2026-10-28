import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { applyPlan } from "../src/apply/apply";
import { detectList } from "../src/detect/detect";
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
