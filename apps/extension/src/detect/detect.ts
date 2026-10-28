import type { CardSnapshot, LinkRef } from "../types";

export const MIN_CARDS = 3;
export const MAX_SNIPPETS = 6;
export const MAX_SNIPPET_LENGTH = 80;
export const MAX_LINKS = 4;
/** Server cap per identify call; cards past it keep their site order. */
export const MAX_CARDS = 60;

export interface DetectedList {
  container: Element;
  /** Cards in the site's original order, keyed by clientId (`c0`, `c1`, …). */
  cards: Map<string, Element>;
  /** Structure signature shared by the cards; used to match learned layouts. */
  signature: string;
  score: number;
}

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD", "IFRAME", "CANVAS", "SELECT", "OPTION",
]);
const CHROME_TAGS = new Set(["NAV", "HEADER", "FOOTER", "ASIDE", "FORM", "MENU"]);
const CHROME_ROLES = /^(navigation|menu|menubar|tablist|banner|contentinfo|toolbar|dialog|alertdialog|complementary)$/;

/** Really rendered, by layout rather than by markup. Mirrors guards/fields.ts. */
function rendered(el: Element): boolean {
  const node = el as HTMLElement;
  if (typeof node.checkVisibility === "function") return node.checkVisibility({ visibilityProperty: true });
  const view = el.ownerDocument?.defaultView;
  const style = view?.getComputedStyle(node);
  return !style || (style.display !== "none" && style.visibility !== "hidden");
}

function isHidden(el: Element): boolean {
  if (el.hasAttribute("hidden")) return true;
  const style = (el as HTMLElement).style;
  if (style?.display === "none" || style?.visibility === "hidden") return true;
  /**
   * `aria-hidden` is an accessibility hint, not a visibility property, and real
   * sites leave it behind: Everlane ships `aria-hidden="true"` on
   * `<main role="main">`, so trusting it skipped the entire page and focal
   * found no list at all. It is only believed when the element really is not
   * rendered. The check is the expensive one, but `aria-hidden` is rare, so
   * the walk still costs nothing on the overwhelming majority of elements.
   */
  if (el.getAttribute("aria-hidden") === "true") return !rendered(el);
  return false;
}

function inChrome(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (CHROME_TAGS.has(n.tagName)) return true;
    const role = n.getAttribute("role");
    if (role && CHROME_ROLES.test(role)) return true;
  }
  return false;
}

function stableClasses(el: Element): string {
  return [...el.classList]
    .filter((c) => !/\d{2,}/.test(c) && !/^(is-|has-)?(active|selected|first|last|odd|even|hover|focus)/.test(c))
    .sort()
    .slice(0, 3)
    .join(".");
}

/** Shape of an element: its own tag + classes plus its children's tags. */
function shape(el: Element): string {
  const kids = [...el.children].map((c) => c.tagName).join(",");
  return `${el.tagName}.${stableClasses(el)}[${kids}]`;
}

function groupKey(el: Element): string {
  const cls = stableClasses(el);
  return cls ? `${el.tagName}.${cls}` : shape(el);
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string): string {
  return text.length <= MAX_SNIPPET_LENGTH ? text : `${text.slice(0, MAX_SNIPPET_LENGTH - 1).trimEnd()}…`;
}

/**
 * Text snippets in document order: title, subtitle, address line, badge…
 * Each snippet is the direct text of one element, so nested labels stay
 * separate. At most 6, each at most 80 characters, duplicates dropped.
 */
export function extractSnippets(card: Element): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (el: Element) => {
    if (out.length >= MAX_SNIPPETS || SKIP_TAGS.has(el.tagName) || isHidden(el)) return;
    if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") return;
    let own = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 3) own += node.textContent ?? "";
      else if (node.nodeType === 1 && /^(B|I|EM|STRONG|SMALL|MARK|SUP|SUB|BR|WBR)$/.test((node as Element).tagName)) {
        own += ` ${(node as Element).textContent ?? ""} `;
      }
    }
    const text = clean(own);
    if (text.length >= 2 && /[\p{L}\p{N}]/u.test(text) && !seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase());
      out.push(truncate(text));
    }
    for (const child of el.children) {
      if (/^(B|I|EM|STRONG|SMALL|MARK|SUP|SUB)$/.test(child.tagName)) continue;
      visit(child);
    }
  };
  visit(card);
  if (out.length === 0) {
    const label =
      card.getAttribute("aria-label") ??
      card.querySelector("[aria-label]")?.getAttribute("aria-label") ??
      card.querySelector("img[alt]:not([alt=''])")?.getAttribute("alt") ??
      card.querySelector("[title]")?.getAttribute("title");
    if (label && clean(label)) out.push(truncate(clean(label)));
  }
  return out;
}

/** Outbound link hosts and paths. Query strings and fragments never leave. */
export function extractLinks(card: Element, base?: string): LinkRef[] {
  const out: LinkRef[] = [];
  const seen = new Set<string>();
  const anchors = card.tagName === "A" ? [card, ...card.querySelectorAll("a[href]")] : [...card.querySelectorAll("a[href]")];
  for (const a of anchors) {
    const href = a.getAttribute("href");
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, base ?? card.ownerDocument?.baseURI);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const ref = { host: url.hostname.replace(/^www\./, ""), path: url.pathname };
    const key = `${ref.host}${ref.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

function titleLike(snippets: string[]): boolean {
  return snippets.some((s) => s.length >= 2 && s.length <= MAX_SNIPPET_LENGTH && /\p{L}/u.test(s));
}

interface Candidate {
  container: Element;
  cards: Element[];
  key: string;
  score: number;
}

function scoreGroup(container: Element, cards: Element[]): number {
  let snippetTotal = 0;
  let titled = 0;
  let rich = 0;
  for (const card of cards) {
    const snippets = extractSnippets(card);
    snippetTotal += snippets.length;
    if (titleLike(snippets)) titled += 1;
    if (card.querySelector("a[href], img, picture") || card.tagName === "A") rich += 1;
  }
  if (titled < Math.max(MIN_CARDS, Math.ceil(cards.length * 0.6))) return 0;
  const avgSnippets = snippetTotal / cards.length;
  // Poster grids carry one title each (image alt); accept them when every card has an image or link.
  const minSnippets = rich === cards.length && cards.length >= 6 ? 1 : 1.5;
  if (avgSnippets < minSnippets) return 0;
  const shapes = new Set(cards.map(shape));
  const uniformity = 1 / shapes.size ** 0.5;
  const richness = 0.5 + rich / cards.length;
  return cards.length * Math.min(avgSnippets, 4) * uniformity * richness * (inChrome(container) ? 0.1 : 1);
}

/**
 * Finds the dominant group of repeated sibling cards (§5.2): at least 3
 * siblings with the same structure and short title-like text. Returns null
 * when the page has no list; nothing is sent anywhere in that case.
 */
export function detectList(root: Document | Element): DetectedList | null {
  const body = "body" in root ? root.body : root;
  if (!body) return null;
  let best: Candidate | null = null;
  const walk = (el: Element) => {
    if (SKIP_TAGS.has(el.tagName) || isHidden(el)) return;
    if (el.children.length >= MIN_CARDS) {
      const groups = new Map<string, Element[]>();
      for (const child of el.children) {
        if (SKIP_TAGS.has(child.tagName) || isHidden(child)) continue;
        const key = groupKey(child);
        const list = groups.get(key);
        if (list) list.push(child);
        else groups.set(key, [child]);
      }
      for (const [key, cards] of groups) {
        if (cards.length < MIN_CARDS) continue;
        const score = scoreGroup(el, cards);
        if (score > 0 && (!best || score > best.score)) best = { container: el, cards, key, score };
      }
    }
    for (const child of el.children) walk(child);
  };
  walk(body);
  const found = best as Candidate | null;
  if (!found) return null;
  const cards = new Map<string, Element>();
  found.cards.forEach((card, i) => cards.set(`c${i}`, card));
  return { container: found.container, cards, signature: found.key, score: found.score };
}

export function snapshotCards(list: DetectedList, base?: string): CardSnapshot[] {
  return [...list.cards].slice(0, MAX_CARDS).map(([clientId, el]) => ({
    clientId,
    snippets: extractSnippets(el),
    links: extractLinks(el, base),
  }));
}

const CITY_PARAMS = ["location", "loc", "city", "near", "where", "l", "destination", "find_loc", "geo"];
const QUERY_PARAMS = ["q", "query", "search", "find_desc", "keyword"];
const GENERIC_HINT = /^(results?|search( results)?|scores?|home|explore|top|best|lists?|filters?|sort( by)?|maps?)$/i;

/** "restaurants near San Francisco" -> "San Francisco". */
function locationPhrase(query: string | null | undefined): string | null {
  const m = /\b(?:near|in|around)\s+(.{2,})$/i.exec(clean(query ?? ""));
  return m ? m[1]! : null;
}

function searchPathQuery(pathname: string): string | null {
  const m = /\/search\/([^/@]+)/.exec(pathname);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!.replace(/\+/g, " "));
  } catch {
    return null;
  }
}

const CITY_INPUT = 'input[type="search" i], input[name="location" i], input[name="city" i], input[name="near" i], input[name="where" i], input[name="find_loc" i], input[name="destination" i], input[aria-label*="location" i], input[placeholder*="city" i], input[placeholder*="location" i]';

/**
 * City hints for places and destinations (§5.3): location-ish URL parameters,
 * search / location box values and the main heading. At most 5.
 */
export function cityHints(doc: Document, href?: string): string[] {
  const out: string[] = [];
  const add = (v: string | null | undefined) => {
    const t = clean(v ?? "");
    if (GENERIC_HINT.test(t)) return;
    if (t.length >= 2 && t.length <= MAX_SNIPPET_LENGTH && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  try {
    const url = new URL(href ?? doc.location?.href ?? "");
    for (const p of CITY_PARAMS) add(url.searchParams.get(p));
    for (const p of QUERY_PARAMS) add(locationPhrase(url.searchParams.get(p)));
    add(locationPhrase(searchPathQuery(url.pathname)));
  } catch {
    // No usable URL.
  }
  for (const input of doc.querySelectorAll<HTMLInputElement>(CITY_INPUT)) {
    if (input.type === "password") continue;
    const value = input.value || input.getAttribute("value");
    add(locationPhrase(value));
    add(value);
  }
  add(doc.querySelector("h1")?.textContent);
  return out.slice(0, 5);
}
