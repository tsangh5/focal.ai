/**
 * The chat writes through the shared profile store (lib/server/profile/store),
 * so the website pages, the extension and assistants see the same profile.
 */
export { dbProfileStore, memoryProfileStore, type ProfileStore as ChatProfileStore } from "../profile/store";
