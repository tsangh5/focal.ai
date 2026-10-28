/**
 * Qloo entity artwork.
 *
 * Most types carry `properties.image.url`, but some (notably
 * `urn:entity:person`) have no `image` key at all. The image CDN still serves
 * those by entity id — verified live 2026-10-23: Kevin Durant
 * (`DE3C9AB4-…`) has `properties.image === null` yet the constructed URL
 * returns HTTP 200. So fall back to the id-derived URL rather than dropping
 * the image, and let the client's onError swap in a placeholder for the
 * genuinely missing ones.
 */
const CDN = "https://images.qloo.com/i";

/** `420x-auto` is the width Qloo's own `properties.image.url` uses. */
export function qlooImageUrl(
  entityId: string,
  properties?: Record<string, unknown>,
): string | undefined {
  const image = properties?.["image"];
  if (image && typeof image === "object" && "url" in image) {
    const url = (image as { url?: unknown }).url;
    if (typeof url === "string" && url.startsWith("https://")) return url;
  }
  // Entity ids are uppercase UUIDs; anything else is not a CDN path.
  if (/^[0-9A-Fa-f-]{36}$/.test(entityId)) return `${CDN}/${entityId}-420x-auto.jpg`;
  return undefined;
}
