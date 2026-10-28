/**
 * Product scoring (spec §5.11).
 *
 * A product is described on three facets (style, palette, formality). The
 * profile arrives as Qloo taste tags with affinities. Each facet matches at
 * most one taste tag — the strongest whose name means the same thing — and
 * contributes that tag's affinity:
 *
 *   score(product) = Σ affinity(best matching taste tag) over its three facets
 *
 * So the score is bounded by three times the strongest affinity, rewards a
 * product that lines up with taste on more than one axis, and cannot be gamed
 * by a verbose product title: each facet contributes once, whatever the
 * wording. Products that match nothing score 0 rather than going unscored, so
 * they still count toward the page mean — on a grid where some products match
 * and others do not, that difference is the signal.
 *
 * The score is never compared across pages. `decideLift` z-scores it within
 * the grid, exactly as it does Qloo affinities, because this number has no
 * meaning on its own.
 */
import { facetMatchesTag, FACET_VALUES, STYLE_FACETS, type ProductDescriptor, type StyleFacet } from "./style";

/** A Qloo tag with the affinity `tagAffinities` gave it for this profile. */
export interface TasteTag {
  /** Qloo tag URN; carried onto the item so rules and dislikes apply. */
  id: string;
  name: string;
  affinity?: number;
}

export interface DescribedProduct {
  clientId: string;
  name: string;
  originalIndex: number;
  descriptor: ProductDescriptor;
}

export interface FacetMatch {
  facet: StyleFacet;
  /** Facet value id, e.g. "workwear". */
  valueId: string;
  /** Display name used in labels, e.g. "workwear". */
  valueName: string;
  tagId: string;
  tagName: string;
  affinity: number;
}

export interface ProductScore {
  clientId: string;
  score: number;
  matches: FacetMatch[];
  /** Qloo tag URNs of the matched taste tags, strongest first. */
  tagIds: string[];
}

/**
 * Strongest taste tag meaning the same thing as this facet value. Tags with no
 * affinity are skipped: Qloo omits the field when it has no score to give, and
 * an unscored match must not look like a zero-strength one.
 */
function bestMatch(facet: StyleFacet, valueId: string, tasteTags: TasteTag[]): FacetMatch | undefined {
  const value = FACET_VALUES[facet].find((v) => v.id === valueId);
  if (!value) return undefined;
  let best: FacetMatch | undefined;
  for (const tag of tasteTags) {
    if (tag.affinity === undefined) continue;
    if (!facetMatchesTag(value, tag.name)) continue;
    if (best && tag.affinity <= best.affinity) continue;
    best = {
      facet,
      valueId: value.id,
      valueName: value.name,
      tagId: tag.id,
      tagName: tag.name,
      affinity: tag.affinity,
    };
  }
  return best;
}

export function scoreProduct(descriptor: ProductDescriptor, tasteTags: TasteTag[]): Omit<ProductScore, "clientId"> {
  const matches: FacetMatch[] = [];
  for (const facet of STYLE_FACETS) {
    const valueId = descriptor[facet];
    if (valueId === undefined) continue;
    const match = bestMatch(facet, valueId, tasteTags);
    if (match) matches.push(match);
  }
  matches.sort((a, b) => b.affinity - a.affinity);
  return {
    score: matches.reduce((sum, m) => sum + m.affinity, 0),
    matches,
    tagIds: [...new Set(matches.map((m) => m.tagId))],
  };
}

export function scoreProducts(products: DescribedProduct[], tasteTags: TasteTag[]): ProductScore[] {
  return products.map((p) => ({ clientId: p.clientId, ...scoreProduct(p.descriptor, tasteTags) }));
}
