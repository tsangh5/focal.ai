import type { InsightType } from "@focal-ai/core";
import { z } from "zod";

/** Types that are Qloo entities, so they can be resolved and scored by insights. */
export const ENTITY_SHORT_TYPES = [
  "place", "destination", "movie", "tv_show", "book", "artist", "brand", "podcast", "videogame", "person",
] as const;
export type EntityShortType = (typeof ENTITY_SHORT_TYPES)[number];

/**
 * `product` is deliberately not a Qloo entity type (§5.11): there is no
 * `urn:entity:product` to resolve against, so product pages take the facet
 * scoring path instead of resolve + insights. It is kept out of
 * `ENTITY_SHORT_TYPES` so `toInsightType` cannot be handed one by mistake.
 */
export const PRODUCT_SHORT_TYPE = "product";

/** Short type names used on the wire by the extension (apps/extension/src/api.ts). */
export const SHORT_TYPES = [...ENTITY_SHORT_TYPES, PRODUCT_SHORT_TYPE] as const;
export type ShortType = (typeof SHORT_TYPES)[number];

export function isEntityShortType(t: ShortType): t is EntityShortType {
  return t !== PRODUCT_SHORT_TYPE;
}

export function toInsightType(t: EntityShortType): InsightType {
  return `urn:entity:${t}` as InsightType;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const host = z.string().trim().toLowerCase().min(1).max(253).regex(/^[a-z0-9.-]+$/);

export const identifyBodySchema = z.object({
  host,
  pathPattern: z.string().max(300),
  signature: z.string().max(300),
  cityHints: z.array(text(80)).max(5),
  cards: z
    .array(
      z.object({
        clientId: text(16),
        snippets: z.array(text(80)).max(6),
        links: z.array(z.object({ host: z.string().max(253), path: z.string().max(500) })).max(4),
      }),
    )
    .min(1)
    .max(60),
});
export type IdentifyBody = z.infer<typeof identifyBodySchema>;

export const identifiedItemSchema = z.object({
  clientId: text(16),
  name: text(200),
  type: z.enum(SHORT_TYPES),
  city: text(80).optional(),
});
export type IdentifiedItem = z.infer<typeof identifiedItemSchema>;

export const pageRankBodySchema = z.object({
  host,
  pathPattern: z.string().max(300),
  pageType: z.enum(SHORT_TYPES),
  items: z.array(identifiedItemSchema).min(1).max(60),
});
export type PageRankBody = z.infer<typeof pageRankBodySchema>;
