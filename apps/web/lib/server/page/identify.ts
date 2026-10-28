import { describeFromName, type ProductDescriptor } from "@focal-ai/core";
import { createJevDescriber, createJevIdentifier } from "../jev/client";
import type { IdentifiedItem, IdentifyBody, ShortType } from "./schemas";

/** Cards whose answers fall below this are left untouched (§5.3). */
export const CONFIDENCE_THRESHOLD = 0.8;

export interface CardAnswer {
  clientId: string;
  name: string | null;
  type: ShortType | null;
  city: string | null;
  confidence: number;
}

export interface PageAnswer {
  isList: boolean;
  cards: CardAnswer[];
}

/** Jev (TypeSafe System One) behind an interface; one call per page. */
export interface Identifier {
  identify(body: IdentifyBody): Promise<PageAnswer>;
}

/**
 * Reads the three style facets off product names (§5.11). Separate from
 * `Identifier` because it runs at rank time and takes only names — the page
 * snippets are not sent a second time.
 */
export interface ProductDescriber {
  describe(names: string[]): Promise<ProductDescriptor[]>;
}

export class IdentifyUnavailableError extends Error {
  constructor() {
    super("identification is not configured");
    this.name = "IdentifyUnavailableError";
  }
}

const HOST_TYPES: [RegExp, ShortType][] = [
  [/(^|\.)(yelp|resy|opentable|tripadvisor|michelin|infatuation|eater|tock|ubereats|doordash|timeout)\./, "place"],
  [/(^|\.)(booking|airbnb|expedia|lonelyplanet|kayak)\./, "destination"],
  [/(^|\.)(goodreads|storygraph|bookshop|audible)\./, "book"],
  [/(^|\.)(imdb|letterboxd|rottentomatoes|mubi)\./, "movie"],
  [/(^|\.)(bandcamp|last\.fm|pitchfork|songkick|setlist)\./, "artist"],
  [/(^|\.)(steampowered|igdb|gog|itch)\./, "videogame"],
  [/(^|\.)(uniqlo|zara|hm|cos|muji|arket|everlane|ssense|farfetch|nordstrom|asos|gap)\./, "product"],
];

/**
 * Mock identifier for local development and tests until the Jev contract is
 * verified (V-02): the card's first snippet is the name, the type comes from
 * a small host table and the city is the first city hint. Unknown hosts are
 * answered with zero confidence, so nothing is ranked there.
 */
export function createMockIdentifier(): Identifier {
  return {
    async identify(body) {
      const type = HOST_TYPES.find(([re]) => re.test(`${body.host}.`))?.[1] ?? null;
      const city = type === "place" || type === "destination" ? (body.cityHints[0] ?? null) : null;
      const cards = body.cards.map((c) => ({
        clientId: c.clientId,
        name: c.snippets[0] ?? null,
        type,
        city,
        confidence: type && c.snippets[0] ? 0.9 : 0,
      }));
      return { isList: type !== null && cards.filter((c) => c.name).length >= 3, cards };
    },
  };
}

let describer: ProductDescriber | undefined;

/**
 * Jev when keyed, otherwise the keyword describer in @focal-ai/core. Unlike
 * `getIdentifier` this never throws: a keyless deployment still ranks product
 * pages, just from the words in the title rather than a model's reading.
 */
export function getDescriber(): ProductDescriber {
  if (describer) return describer;
  const apiKey = process.env.QLOO_MOCK === "1" ? undefined : process.env.TYPESAFE_API_KEY?.trim();
  if (apiKey) {
    return (describer = createJevDescriber({
      apiKey,
      baseUrl: process.env.TYPESAFE_BASE_URL,
      model: process.env.TYPESAFE_MODEL,
    }));
  }
  return (describer = {
    async describe(names) {
      return names.map((n) => describeFromName(n));
    },
  });
}

export function __setDescriberForTests(d: ProductDescriber | undefined): void {
  describer = d;
}

let identifier: Identifier | undefined;

/** Mock mode stays offline; otherwise Jev when keyed, the mock in dev, else unavailable. */
export function getIdentifier(): Identifier {
  if (identifier) return identifier;
  if (process.env.QLOO_MOCK === "1") return (identifier = createMockIdentifier());
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (apiKey) {
    return (identifier = createJevIdentifier({
      apiKey,
      baseUrl: process.env.TYPESAFE_BASE_URL,
      model: process.env.TYPESAFE_MODEL,
    }));
  }
  if (process.env.FOCAL_DEV_SESSION === "1") return (identifier = createMockIdentifier());
  throw new IdentifyUnavailableError();
}

export function __setIdentifierForTests(i: Identifier | undefined): void {
  identifier = i;
}

/**
 * Applies the confidence rule and the page-level answer. The page type is
 * the majority type of the confident cards; cards of other types stay in the
 * result so the rank step can skip them explicitly.
 */
export function selectIdentified(answer: PageAnswer, threshold = CONFIDENCE_THRESHOLD) {
  if (!answer.isList) return { isList: false, pageType: null, items: [] as IdentifiedItem[] };
  const items: IdentifiedItem[] = [];
  const counts = new Map<ShortType, number>();
  for (const c of answer.cards) {
    if (c.confidence < threshold || !c.name || !c.type) continue;
    items.push({ clientId: c.clientId, name: c.name, type: c.type, ...(c.city ? { city: c.city } : {}) });
    counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
  }
  const pageType = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { isList: items.length > 0, pageType, items };
}
