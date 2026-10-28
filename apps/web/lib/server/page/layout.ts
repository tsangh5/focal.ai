import { CONFIDENCE_THRESHOLD, type PageAnswer } from "./identify";
import type { IdentifyBody, ShortType } from "./schemas";

/**
 * Where the names sit in one card structure, the page's type and which city
 * hint gives the city (§5.3). Structure only, never page text. It goes back
 * in the identify response for the extension to keep; the server never stores
 * it. Mirrors `LearnedLayout` in apps/extension/src/api.ts.
 */
export interface LearnedLayout {
  fingerprint: string;
  namePosition: { snippetIndex: number };
  type: ShortType;
  citySource: { hintIndex: number } | null;
}

const MIN_CARDS = 3;
const MIN_NAME_AGREEMENT = 0.8;

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The most common index (-1 means no match and never wins); ties go to the earlier one. */
function mostCommon(indexes: number[]): { index: number; count: number } | null {
  const counts = new Map<number, number>();
  for (const i of indexes) if (i >= 0) counts.set(i, (counts.get(i) ?? 0) + 1);
  let best: { index: number; count: number } | null = null;
  for (const [index, count] of counts) {
    if (!best || count > best.count || (count === best.count && index < best.index)) best = { index, count };
  }
  return best;
}

/**
 * Learns a layout from one identified page, or null when replaying it could
 * misname cards: at least 3 confident cards, all of one type, and at least 80%
 * of them named by the same snippet position. The city source is kept only
 * when every confident card's city is the same hint.
 */
export function deriveLayout(body: IdentifyBody, answer: PageAnswer): LearnedLayout | null {
  if (!answer.isList) return null;
  const confident = answer.cards.filter((c) => c.confidence >= CONFIDENCE_THRESHOLD && c.name && c.type);
  const type = confident[0]?.type;
  if (!type || confident.length < MIN_CARDS || confident.some((c) => c.type !== type)) return null;

  const snippets = new Map(body.cards.map((c) => [c.clientId, c.snippets]));
  const name = mostCommon(confident.map((c) => snippets.get(c.clientId)?.findIndex((s) => sameText(s, c.name!)) ?? -1));
  if (!name || name.count / confident.length < MIN_NAME_AGREEMENT) return null;

  const located = type === "place" || type === "destination";
  const city = located ? mostCommon(confident.map((c) => (c.city ? body.cityHints.findIndex((h) => sameText(h, c.city!)) : -1))) : null;
  return {
    fingerprint: body.signature,
    namePosition: { snippetIndex: name.index },
    type,
    citySource: city && city.count === confident.length ? { hintIndex: city.index } : null,
  };
}
