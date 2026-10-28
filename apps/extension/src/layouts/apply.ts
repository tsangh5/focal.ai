import type { IdentifiedItem, IdentifyResponse, LearnedLayout } from "../api";
import { MIN_CARDS } from "../detect/detect";
import type { CardSnapshot } from "../types";

/**
 * Identifies cards locally with a stored layout (§5.3), in the shape of an
 * identify reply: each name is the snippet at the learned position, the type
 * is the page's and the city comes from the learned hint. Null when fewer than
 * 3 cards have a name there, so the caller identifies the page afresh.
 */
export function applyLayout(layout: LearnedLayout, cards: CardSnapshot[], cityHints: string[]): IdentifyResponse | null {
  const city = layout.citySource ? cityHints[layout.citySource.hintIndex] : undefined;
  const items = cards.flatMap((card): IdentifiedItem[] => {
    const name = card.snippets[layout.namePosition.snippetIndex];
    return name ? [{ clientId: card.clientId, name, type: layout.type, ...(city ? { city } : {}) }] : [];
  });
  return items.length >= MIN_CARDS ? { isList: true, pageType: layout.type, items } : null;
}
