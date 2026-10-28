import type { HostedDeps, RankedListItem } from "@focal-ai/mcp/hosted";
import type { Db } from "@focal-ai/db";
import type { EntrySource } from "@focal-ai/core";
import { dbProfileStore } from "../chat/store";
import { rankPage } from "../page/rank";
import { getQlooClient } from "../qloo";

/** Wires the hosted MCP tools to one user's Neon-backed profile and the page ranker. */
export function mcpDeps(db: Db, userId: string, client: string, profileUrl: string): HostedDeps {
  const store = dbProfileStore(db, userId);
  return {
    qloo: getQlooClient(),
    actor: `mcp:${client}` as EntrySource,
    profileUrl,
    loadProfile: () => store.load(),
    commit: (next, event) => store.commit(next, event),
    async rankList({ type, items, city }, profile) {
      const result = await rankPage(
        {
          host: "mcp",
          pathPattern: "/",
          pageType: type,
          items: items.map((name, i) => ({ clientId: `c${i}`, name, type, ...(city ? { city } : {}) })),
        },
        profile,
        crypto.randomUUID(),
      );
      const byId = new Map(result.items.map((it) => [it.clientId, it]));
      const reorder = result.plan?.ops.find((op) => op.op === "reorder");
      const order = reorder?.op === "reorder" ? reorder.order : items.map((_, i) => `c${i}`);
      const ranked: RankedListItem[] = order.map((id) => {
        const it = byId.get(id);
        const i = Number(id.slice(1));
        return {
          name: items[i] ?? it?.name ?? id,
          original_position: i + 1,
          lifted: it?.outcome === "lifted",
          ...(it?.outcome === "folded" ? { folded_by: it.foldedBy ?? [] } : {}),
          ...(it?.label ? { label: it.label.text } : {}),
          ...(it?.entityName ? { matched: it.entityName } : {}),
        };
      });
      return { status: result.status, items: ranked };
    },
  };
}
