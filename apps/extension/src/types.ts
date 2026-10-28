/**
 * Mirror of the declarative render plan in @focal-ai/core (`RenderOp` /
 * `RenderPlan`). Kept local so the extension bundle never pulls in core's
 * runtime dependencies; the server validates plans before sending them.
 */
export type Badge = "top-pick" | "good-match" | "favourite";

export type RenderOp =
  | { op: "reorder"; containerId: string; order: string[] }
  | { op: "collapse"; containerId: string; clientIds: string[]; label: string }
  | { op: "annotate"; containerId: string; clientId: string; text: string; badge?: Badge }
  | { op: "emphasize"; containerId: string; clientId: string; level: "high" }
  | { op: "hide"; containerId: string; clientIds: string[]; label: string };

export interface RenderPlan {
  id: string;
  pageId: string;
  createdAt: string;
  ops: RenderOp[];
  summary: {
    moved: number;
    collapsed: number;
    unresolved: number;
    avgMovement: number;
    lifted?: number;
  };
}

export interface LinkRef {
  host: string;
  path: string;
}

/** What the extension extracts from one card. Never full HTML. */
export interface CardSnapshot {
  clientId: string;
  snippets: string[];
  links: LinkRef[];
}
