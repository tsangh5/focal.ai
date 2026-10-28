import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { FOCAL_HIDDEN_ATTR, MAX_CARDS, cityHints, detectList, extractLinks, extractSnippets, snapshotCards } from "../src/detect/detect";
import { pathPattern } from "../src/api";
import { ARTICLE, BOOK_LIST, RESTAURANT_GRID } from "./fixtures";

const page = (html: string, url = "https://www.example.com/search") => new JSDOM(`<body>${html}</body>`, { url }).window.document;

describe("detectList", () => {
  it("finds the restaurant cards, not the nav or footer", () => {
    const d = page(RESTAURANT_GRID);
    const list = detectList(d);
    expect(list).not.toBeNull();
    expect(list!.container.className).toBe("results");
    expect([...list!.cards.keys()]).toEqual(["c0", "c1", "c2", "c3"]);
    expect([...list!.cards.values()].every((el) => el.classList.contains("card"))).toBe(true);
    expect(list!.signature).toBe("DIV.card");
  });

  it("finds a classless ul list", () => {
    const list = detectList(page(BOOK_LIST));
    expect(list?.container.tagName).toBe("UL");
    expect(list?.cards.size).toBe(5);
  });

  it("detects nothing on an article page", () => {
    expect(detectList(page(ARTICLE))).toBeNull();
  });

  it("needs at least 3 cards", () => {
    expect(detectList(page('<div><div class="c"><h3>One</h3><p>a b</p></div><div class="c"><h3>Two</h3><p>c d</p></div></div>'))).toBeNull();
  });

  it("ignores hidden groups", () => {
    const html = `<div hidden>${BOOK_LIST}</div>`;
    expect(detectList(page(html))).toBeNull();
  });

  it("ignores groups hidden by inline style", () => {
    const html = `<div style="display:none">${BOOK_LIST}</div>`;
    expect(detectList(page(html))).toBeNull();
  });

  /**
   * Live finding (2026-10-28): everlane.com ships `aria-hidden="true"` on
   * `<main role="main">`, so believing it skipped the whole page and focal
   * found no list at all. It is an accessibility hint, not a visibility
   * property — sites leave it behind after a modal closes.
   */
  it("still finds a list under a stale aria-hidden wrapper", () => {
    const html = `<main role="main" aria-hidden="true">${BOOK_LIST}</main>`;
    const list = detectList(page(html));
    expect(list).not.toBeNull();
    expect(list!.cards.size).toBe(5);
  });

  it("still believes aria-hidden when the element really is not rendered", () => {
    const html = `<div aria-hidden="true" style="display:none">${BOOK_LIST}</div>`;
    expect(detectList(page(html))).toBeNull();
  });

  it("still counts a card focal folded away, but not one the site hid itself", () => {
    const d = page(BOOK_LIST);
    const [folded, siteHidden, offscreen] = [...detectList(d)!.cards.values()] as HTMLElement[];
    // A carousel's offscreen slide: aria-hidden, but rendered until focal folds it.
    offscreen!.setAttribute("aria-hidden", "true");
    for (const el of [folded!, offscreen!]) {
      el.style.setProperty("display", "none", "important");
      el.setAttribute(FOCAL_HIDDEN_ATTR, "");
    }
    siteHidden!.style.display = "none";
    const cards = [...detectList(d)!.cards.values()];
    expect(cards).toHaveLength(4);
    expect(cards).toContain(folded);
    expect(cards).toContain(offscreen);
    expect(cards).not.toContain(siteHidden);
  });
});

describe("what the user typed", () => {
  it("never becomes a snippet: textarea and input contents stay on the page", () => {
    const gifts = ["Peonies", "Tulips", "Ranunculus"]
      .map((t, i) => `<li><a href="/gift/${i}"><b>${t}</b></a><div>Bouquet · $${40 + i}</div><textarea name="message"></textarea><input name="note"></li>`)
      .join("");
    const d = page(`<ul>${gifts}</ul>`);
    for (const field of d.querySelectorAll("textarea")) {
      field.value = "Happy birthday Sam, love Mum";
      // React keeps a controlled textarea's text content in step with what was typed.
      field.defaultValue = field.value;
    }
    for (const field of d.querySelectorAll("input")) {
      field.value = "Leave it by the back door";
      field.setAttribute("value", field.value);
    }
    const snap = snapshotCards(detectList(d)!);
    expect(snap.map((c) => c.snippets)).toEqual([
      ["Peonies", "Bouquet · $40"],
      ["Tulips", "Bouquet · $41"],
      ["Ranunculus", "Bouquet · $42"],
    ]);
    expect(JSON.stringify(snap)).not.toMatch(/birthday|back door/);
  });
});

describe("extraction", () => {
  it("extracts ordered snippets, skipping buttons", () => {
    const d = page(RESTAURANT_GRID);
    const card = detectList(d)!.cards.get("c0")!;
    expect(extractSnippets(card)).toEqual(["Rintaro", "Japanese · $$", "82 Smith St"]);
  });

  it("caps snippets at 6 and 80 characters", () => {
    const long = "x".repeat(120);
    const d = page(`<div>${Array.from({ length: 9 }, (_, i) => `<p>Line ${i} ${long}</p>`).join("")}</div>`);
    const snippets = extractSnippets(d.querySelector("div")!);
    expect(snippets).toHaveLength(6);
    expect(snippets.every((s) => s.length <= 80)).toBe(true);
    expect(snippets[0]!.endsWith("…")).toBe(true);
  });

  it("keeps inline emphasis with its text", () => {
    const d = page("<div><p>The <b>Overstory</b> novel</p></div>");
    expect(extractSnippets(d.querySelector("div")!)).toEqual(["The Overstory novel"]);
  });

  it("extracts link hosts and paths without query strings", () => {
    const d = page(RESTAURANT_GRID, "https://www.yelp.com/search?find_desc=ramen");
    const list = detectList(d)!;
    expect(extractLinks(list.cards.get("c0")!)).toEqual([{ host: "resy.com", path: "/cities/ny/rintaro" }]);
    expect(extractLinks(list.cards.get("c1")!)).toEqual([{ host: "yelp.com", path: "/biz/ippudo" }]);
  });

  it("snapshots never include HTML", () => {
    const d = page(RESTAURANT_GRID);
    const snap = snapshotCards(detectList(d)!);
    expect(snap).toHaveLength(4);
    expect(JSON.stringify(snap)).not.toMatch(/<|class=/);
  });

  it("snapshots at most MAX_CARDS cards, in page order", () => {
    const rows = Array.from({ length: 100 }, (_, i) => `<li><a href="/book/${i}">Book ${i}</a><span>Author ${i}</span></li>`).join("");
    const list = detectList(page(`<ul>${rows}</ul>`))!;
    expect(list.cards.size).toBe(100);
    const snap = snapshotCards(list);
    expect(snap).toHaveLength(MAX_CARDS);
    expect(snap[0]!.clientId).toBe("c0");
    expect(snap.at(-1)!.clientId).toBe(`c${MAX_CARDS - 1}`);
  });

  it("collects city hints from params, inputs and the heading", () => {
    const d = page(RESTAURANT_GRID, "https://www.yelp.com/search?find_desc=ramen&find_loc=Brooklyn%2C+NY");
    expect(cityHints(d)).toEqual(["Brooklyn, NY", "ramen", "Best ramen in Brooklyn"]);
  });
});

describe("city hints", () => {
  it("reads the place from a Maps search path and skips generic headings", () => {
    const d = page("<h1>Results</h1>", "https://www.google.com/maps/search/restaurants+near+San+Francisco/@37.7,-122.4,13z");
    expect(cityHints(d)).toEqual(["San Francisco"]);
  });
  it("reads the place from a search query", () => {
    const d = page("<h1>Score</h1>", "https://www.example.com/search?q=ramen%20in%20Oakland");
    expect(cityHints(d)).toEqual(["Oakland"]);
  });
});

describe("poster grids", () => {
  it("detects cards that only have an image title", () => {
    const films = ["Dune", "Past Lives", "Aftersun", "Perfect Days", "Anatomy of a Fall", "Oppenheimer"];
    const d = page(`<nav><a href="/sort">Sort</a></nav><ul class="posters">${films.map((f, i) => `<li><a href="/film/${i}/"><img src="/p${i}.jpg" alt="${f}"></a></li>`).join("")}</ul>`);
    const list = detectList(d)!;
    expect(list.cards.size).toBe(6);
    expect(snapshotCards(list)[1]!.snippets).toEqual(["Past Lives"]);
  });
});

describe("pathPattern", () => {
  it("generalises ids and lowercases", () => {
    expect(pathPattern("/biz/12345/Reviews")).toBe("/biz/:id/reviews");
    expect(pathPattern("/list/3f2a9c1e-7b6d-4e1f-9a2b-1c2d3e4f5a6b")).toBe("/list/:id");
    expect(pathPattern("/Restaurants-g60763-New_York_City")).toBe("/:id");
    expect(pathPattern("/")).toBe("/");
  });
});
