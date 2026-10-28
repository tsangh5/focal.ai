/**
 * Product style vocabulary (spec §5.11).
 *
 * Qloo has no product entities, so a product grid cannot be resolved and
 * scored the way a restaurant list is. What Qloo does have is a tag
 * vocabulary, and `tagAffinities` turns a taste set into weighted tags
 * ("punk", "minimalism", "workwear"). Product names carry none of those words,
 * so something has to join the two.
 *
 * That join is this file: a small fixed vocabulary of product descriptors,
 * each carrying the cultural words that mean the same thing. It is deliberately
 * a hand-written table rather than a model's per-page judgement — it is
 * reviewable, testable, costs nothing at request time, and keeps the user's
 * taste out of the identification call (§6).
 *
 * Three facets, chosen because they are answerable from a product card alone
 * and because they are the axes a taste graph can actually speak to:
 *
 *   style       what tradition the garment belongs to
 *   palette     what colour world it lives in
 *   formality   where it sits between lounging and black tie
 *
 * `synonyms` match against Qloo taste-tag names. `keywords` are the fallback
 * describer's evidence in a product name, used when no identifier is
 * configured (mock mode and tests).
 */

export const STYLE_FACETS = ["style", "palette", "formality"] as const;
export type StyleFacet = (typeof STYLE_FACETS)[number];

export interface FacetValue {
  id: string;
  /** Shown in labels: "your taste leans minimal". */
  name: string;
  /** Cultural words that mean this descriptor, matched against taste tags. */
  synonyms: string[];
  /** Words in a product name that imply this descriptor. */
  keywords: string[];
}

const STYLE_VALUES: FacetValue[] = [
  {
    id: "minimal",
    name: "minimal",
    // Not "japanese": Qloo uses it as a cuisine tag far more often than as a
    // design reference, so it would read a taste for ramen as a taste for
    // plain knitwear.
    synonyms: ["minimal", "minimalism", "minimalist", "understated", "sparse", "ambient", "scandinavian"],
    keywords: ["crew neck", "merino", "supima", "seamless", "plain", "essential", "cashmere"],
  },
  {
    id: "classic",
    name: "classic",
    synonyms: ["classic", "classical", "traditional", "timeless", "heritage", "vintage", "retro", "folk"],
    keywords: ["oxford", "chino", "linen", "flannel", "poplin", "broadcloth", "trench"],
  },
  {
    id: "tailored",
    name: "tailored",
    synonyms: ["tailored", "elegant", "sophisticated", "refined", "jazz", "noir", "opera", "luxury"],
    keywords: ["blazer", "pleated", "suit", "tailored", "dress shirt", "slacks", "wool trouser"],
  },
  {
    id: "workwear",
    name: "workwear",
    synonyms: ["workwear", "rugged", "americana", "country", "blues", "folk", "punk", "garage"],
    keywords: ["denim", "jean", "chore", "canvas", "corduroy", "twill", "work shirt"],
  },
  {
    id: "preppy",
    name: "preppy",
    synonyms: ["preppy", "collegiate", "ivy", "nautical", "academia", "indie pop", "soft rock"],
    keywords: ["polo", "rugby", "cardigan", "varsity", "striped", "button down", "button-down"],
  },
  {
    id: "street",
    name: "street",
    synonyms: ["street", "streetwear", "urban", "hip hop", "hip-hop", "rap", "skate", "graffiti", "punk", "grunge"],
    keywords: ["hoodie", "sweatshirt", "graphic", "oversized", "cargo short", "track", "ut "],
  },
  {
    id: "athletic",
    name: "athletic",
    synonyms: ["athletic", "sport", "sports", "fitness", "running", "gym", "performance", "electronic"],
    keywords: ["dry-ex", "dry ex", "airism", "active", "sport", "training", "jersey", "quick dry"],
  },
  {
    id: "outdoor",
    name: "outdoor",
    synonyms: ["outdoor", "outdoors", "hiking", "camping", "nature", "adventure", "mountain", "travel"],
    keywords: ["fleece", "parka", "puffer", "down", "windproof", "blocktech", "anorak", "trail"],
  },
  {
    id: "romantic",
    name: "romantic",
    synonyms: ["romantic", "romance", "feminine", "bohemian", "boho", "dreamy", "shoegaze", "ballet"],
    keywords: ["floral", "ruffle", "lace", "wrap", "blouse", "chiffon", "gathered"],
  },
  {
    id: "utility",
    name: "utility",
    // Not "science fiction": a genre tag with no clothing implication.
    synonyms: ["utility", "functional", "technical", "industrial", "military", "techno", "brutalist"],
    keywords: ["cargo", "utility", "tech", "pocket", "ripstop", "nylon", "padded"],
  },
];

const PALETTE_VALUES: FacetValue[] = [
  {
    id: "neutral",
    name: "neutral",
    synonyms: ["neutral", "beige", "tan", "muted", "understated", "minimalism", "scandinavian"],
    keywords: ["beige", "ecru", "ivory", "cream", "oatmeal", "stone", "sand", "khaki"],
  },
  {
    id: "monochrome",
    name: "monochrome",
    synonyms: ["monochrome", "black and white", "grayscale", "greyscale", "noir", "minimalism"],
    keywords: ["monochrome", "black and white", "charcoal", "grey", "gray"],
  },
  {
    id: "earth",
    name: "earthy",
    // Not "natural" or "organic": both are food-and-drink words in Qloo's
    // vocabulary ("Natural Wine", "Organic"), and a taste in wine says
    // nothing about a colour palette.
    synonyms: ["earth", "earthy", "folk", "country", "americana"],
    keywords: ["olive", "brown", "rust", "terracotta", "moss", "camel", "clay"],
  },
  {
    id: "bright",
    name: "bright",
    synonyms: ["bright", "vivid", "colourful", "colorful", "bold", "pop", "neon", "psychedelic"],
    keywords: ["bright", "vivid", "neon", "yellow", "orange", "red", "multicolor", "multicolour"],
  },
  {
    id: "pastel",
    name: "pastel",
    synonyms: ["pastel", "soft", "dreamy", "shoegaze", "dream pop", "light"],
    keywords: ["pastel", "pink", "lavender", "mint", "pale", "light blue", "powder"],
  },
  {
    id: "dark",
    name: "dark",
    synonyms: ["dark", "gothic", "goth", "metal", "noir", "moody", "industrial", "post-punk"],
    keywords: ["black", "navy", "dark", "midnight", "ink"],
  },
];

const FORMALITY_VALUES: FacetValue[] = [
  {
    id: "loungewear",
    name: "loungewear",
    synonyms: ["loungewear", "lounge", "comfort", "cozy", "cosy", "homebody", "ambient"],
    keywords: ["pajama", "pyjama", "lounge", "room wear", "roomwear", "sleep", "relaco", "sweatpant"],
  },
  {
    id: "casual",
    name: "casual",
    synonyms: ["casual", "everyday", "relaxed", "laid back", "laid-back", "indie", "skate"],
    keywords: ["t-shirt", "tee", "hoodie", "sweat", "short", "jean", "polo"],
  },
  {
    id: "smart-casual",
    name: "smart casual",
    synonyms: ["smart casual", "smart-casual", "polished", "put together", "sophisticated", "jazz"],
    keywords: ["shirt", "chino", "cardigan", "knit", "blouse", "trouser", "pant"],
  },
  {
    id: "formal",
    name: "formal",
    synonyms: ["formal", "dressy", "black tie", "evening", "elegant", "opera", "ballet", "classical"],
    keywords: ["suit", "blazer", "dress shirt", "tie", "slacks", "gown", "tuxedo"],
  },
];

export const FACET_VALUES: Record<StyleFacet, FacetValue[]> = {
  style: STYLE_VALUES,
  palette: PALETTE_VALUES,
  formality: FORMALITY_VALUES,
};

/** One product, described on the three facets. Any facet may be unknown. */
export type ProductDescriptor = Partial<Record<StyleFacet, string>>;

export function facetValue(facet: StyleFacet, id: string): FacetValue | undefined {
  return FACET_VALUES[facet].find((v) => v.id === id);
}

/** Choice criteria for an identifier: `{ minimal: "minimal", ... , unknown: "..." }`. */
export function facetCriteria(facet: StyleFacet): Record<string, string> {
  const out: Record<string, string> = {};
  for (const value of FACET_VALUES[facet]) {
    out[value.id] = `${value.name}: ${value.keywords.slice(0, 4).join(", ")}`;
  }
  out["unknown"] = "Cannot be told from the product name";
  return out;
}

function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/**
 * Whole-word containment in either direction, so "minimal" matches the taste
 * tag "Minimalism" but "art" never matches "smart". Multi-word synonyms are
 * matched as phrases.
 */
function mentions(haystack: string, needle: string): boolean {
  const h = normalize(haystack);
  const n = normalize(needle).trim();
  if (!n) return false;
  if (h.includes(` ${n} `)) return true;
  // Prefix match on the single-word case catches "minimal" in "minimalism".
  return !n.includes(" ") && new RegExp(`\\s${n}[a-z]{0,4}\\s`).test(h);
}

/** True when a taste-tag name means the same thing as this facet value. */
export function facetMatchesTag(value: FacetValue, tagName: string): boolean {
  return value.synonyms.some((s) => mentions(tagName, s));
}

/**
 * Fallback describer used when no identifier is configured: reads the facets
 * straight out of the product name by keyword. Weaker than a model — it sees
 * only words that happen to be in the title — but it is deterministic, needs
 * no key, and apparel titles are unusually descriptive ("Pleated Wide Leg
 * Pants", "Dry-EX Short Sleeve Polo Shirt").
 */
export function describeFromName(name: string): ProductDescriptor {
  const descriptor: ProductDescriptor = {};
  for (const facet of STYLE_FACETS) {
    let best: { id: string; hits: number } | undefined;
    for (const value of FACET_VALUES[facet]) {
      const hits = value.keywords.filter((k) => mentions(name, k)).length;
      if (hits > 0 && (!best || hits > best.hits)) best = { id: value.id, hits };
    }
    if (best) descriptor[facet] = best.id;
  }
  return descriptor;
}
