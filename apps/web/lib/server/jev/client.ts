import { facetCriteria, facetValue, STYLE_FACETS, type ProductDescriptor } from "@focal-ai/core";
import type { CardAnswer, Identifier, PageAnswer, ProductDescriber } from "../page/identify";
import type { IdentifyBody, ShortType } from "../page/schemas";

/**
 * Jev (TypeSafe System One) card identification: one request per page, one
 * set of choice questions per card plus a page-level yes/no. Only card
 * snippets, link-free, go to TypeSafe (§6). Request shape verified live by
 * `pnpm probe:unknowns jev` on 2026-10-20.
 */
export const JEV_DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const JEV_DEFAULT_MODEL = "jev-latest";
/** Page-level "is this a list of real-world things?" cut-off. */
export const IS_LIST_THRESHOLD = 0.5;

/** Jev's choice keys → wire type names. `not_a_thing` maps to null. */
const TYPE_CHOICES: Record<string, { type: ShortType | null; description: string }> = {
  place: { type: "place", description: "A physical venue: restaurant, bar, café, hotel, shop, museum or similar" },
  destination: { type: "destination", description: "A city, region, country or travel destination" },
  movie: { type: "movie", description: "A film" },
  tv_show: { type: "tv_show", description: "A TV series" },
  artist: { type: "artist", description: "A musician or band" },
  book: { type: "book", description: "A book" },
  podcast: { type: "podcast", description: "A podcast" },
  video_game: { type: "videogame", description: "A video game" },
  brand: { type: "brand", description: "A company or brand, including fashion, beauty and product brands" },
  person: { type: "person", description: "A public figure such as an actor, author or athlete" },
  // Products used to fall under not_a_thing, which put every product grid
  // below the is_list cut-off (§5.11). They are now their own type and take
  // the facet scoring path rather than being resolved as entities.
  product: {
    type: "product",
    description:
      "A specific item for sale whose card does not name its brand: a garment, shoe, accessory or piece of homeware on a single-brand store",
  },
  not_a_thing: {
    type: null,
    description: "Not a named real-world thing: an email, article headline, ad copy or interface text",
  },
};

export class JevError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JevError";
  }
}

export interface JevOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function buildJevRequest(body: IdentifyBody, model: string): Record<string, unknown> {
  const typeCriteria = Object.fromEntries(Object.entries(TYPE_CHOICES).map(([k, v]) => [k, v.description]));
  const questions: Record<string, unknown> = {
    is_list: {
      type: "noul",
      instructions:
        "Is this page section a list of named real-world things (venues, films, shows, artists, books, podcasts, games, brands, destinations, public figures or products for sale)?",
      criteria: null,
    },
  };
  const cards = body.cards.map((card, index) => {
    const snippets = Object.fromEntries(card.snippets.map((text, i) => [`s${i}`, text]));
    questions[`c${index}_name`] = {
      type: "choice",
      // Brand first: a multi-brand retailer resolves to real Qloo entities and
      // ranks on verified affinities, which beats facet scoring. Only a card
      // that never names a brand — the single-brand store case — falls through
      // to the product name and the facet path (§5.11).
      instructions: `Which snippet of card c${index} is the name of the thing the card is about? If the card names a brand, choose the brand. Otherwise, for a product card, choose the product name — never the price or the colour count.`,
      criteria: { ...snippets, none: "None of these snippets names a real-world thing" },
    };
    questions[`c${index}_type`] = {
      type: "choice",
      instructions: `What kind of thing is card c${index} about?`,
      criteria: typeCriteria,
    };
    if (body.cityHints.length > 0) {
      questions[`c${index}_city`] = {
        type: "choice",
        instructions: `Which city hint gives the city of the thing on card c${index}?`,
        criteria: {
          unknown: "The city cannot be told from the page",
          ...Object.fromEntries(body.cityHints.map((hint, i) => [`h${i}`, hint])),
        },
      };
    }
    return { id: `c${index}`, snippets };
  });
  return {
    model,
    state: { site: body.host, path: body.pathPattern, cityHints: body.cityHints, cards },
    questions,
  };
}

type Choice = { choice?: unknown; confidence?: unknown };

const rec = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function parseJevAnswers(body: IdentifyBody, payload: unknown): PageAnswer {
  const answers = rec(rec(payload)?.answers) ?? {};
  const isList = num(rec(answers.is_list)?.noul) >= IS_LIST_THRESHOLD;
  const cards: CardAnswer[] = body.cards.map((card, index) => {
    const name = (rec(answers[`c${index}_name`]) ?? {}) as Choice;
    const type = (rec(answers[`c${index}_type`]) ?? {}) as Choice;
    const city = (rec(answers[`c${index}_city`]) ?? {}) as Choice;
    const nameMatch = typeof name.choice === "string" ? /^s(\d)$/.exec(name.choice) : null;
    const cityMatch = typeof city.choice === "string" ? /^h(\d)$/.exec(city.choice) : null;
    const typeKey = typeof type.choice === "string" ? type.choice : "";
    const mappedType = TYPE_CHOICES[typeKey]?.type ?? null;
    return {
      clientId: card.clientId,
      name: nameMatch ? (card.snippets[Number(nameMatch[1])] ?? null) : null,
      type: mappedType,
      city: cityMatch && (mappedType === "place" || mappedType === "destination") ? (body.cityHints[Number(cityMatch[1])] ?? null) : null,
      confidence: Math.min(num(name.confidence), num(type.confidence)),
    };
  });
  return { isList, cards };
}

/**
 * Facet questions for a set of product names (§5.11). Sent at rank time, not
 * identify time, because the facets are read off the product name alone — the
 * page snippets are not needed a second time, so this request carries only the
 * names already sent to Qloo.
 *
 * One single-choice question per facet per product. The criteria come from the
 * shared vocabulary in @focal-ai/core, so the wire format and the scorer can
 * never drift apart.
 */
export function buildDescribeRequest(names: string[], model: string): Record<string, unknown> {
  const questions: Record<string, unknown> = {};
  names.forEach((name, index) => {
    for (const facet of STYLE_FACETS) {
      questions[`p${index}_${facet}`] = {
        type: "choice",
        instructions: `For the product "${name}", which ${facet} does it belong to?`,
        criteria: facetCriteria(facet),
      };
    }
  });
  return {
    model,
    state: { products: names.map((name, index) => ({ id: `p${index}`, name })) },
    questions,
  };
}

/** Facet answers below this keep the facet unset rather than guessing. */
export const FACET_CONFIDENCE_THRESHOLD = 0.6;

export function parseDescribeAnswers(names: string[], payload: unknown): ProductDescriptor[] {
  const answers = rec(rec(payload)?.answers) ?? {};
  return names.map((_, index) => {
    const descriptor: ProductDescriptor = {};
    for (const facet of STYLE_FACETS) {
      const answer = (rec(answers[`p${index}_${facet}`]) ?? {}) as Choice;
      const choice = typeof answer.choice === "string" ? answer.choice : "";
      if (!choice || choice === "unknown") continue;
      if (num(answer.confidence) < FACET_CONFIDENCE_THRESHOLD) continue;
      if (facetValue(facet, choice)) descriptor[facet] = choice;
    }
    return descriptor;
  });
}

function jevFetch(opts: JevOptions, body: Record<string, unknown>): Promise<unknown> {
  const baseUrl = (opts.baseUrl ?? JEV_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  return (async () => {
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}/v1/systemone`, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      });
    } catch (e) {
      throw new JevError(e instanceof Error && e.name === "TimeoutError" ? "Jev timed out" : "Jev request failed");
    }
    if (!res.ok) throw new JevError(`Jev returned HTTP ${res.status}`, res.status);
    const payload: unknown = await res.json().catch(() => undefined);
    if (!rec(payload)?.answers) throw new JevError("Jev response had no answers");
    return payload;
  })();
}

export function createJevIdentifier(opts: JevOptions): Identifier {
  const model = opts.model ?? JEV_DEFAULT_MODEL;
  return {
    async identify(body) {
      return parseJevAnswers(body, await jevFetch(opts, buildJevRequest(body, model)));
    },
  };
}

export function createJevDescriber(opts: JevOptions): ProductDescriber {
  const model = opts.model ?? JEV_DEFAULT_MODEL;
  return {
    async describe(names) {
      if (names.length === 0) return [];
      return parseDescribeAnswers(names, await jevFetch(opts, buildDescribeRequest(names, model)));
    },
  };
}
