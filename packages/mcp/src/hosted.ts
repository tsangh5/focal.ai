/**
 * Hosted MCP server (spec §4.4, §5.10): the same profile tools and write rules
 * as the website chat, bound to one signed-in user per request. Stateless, so
 * it runs in a serverless route handler. Settings are deliberately not exposed.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { ActivityEvent, EntrySource, ProfileV2 } from "@focal-ai/core";
import type { QlooClient } from "@focal-ai/qloo";
import { z } from "zod";
import { STRENGTHS, TYPES, runProfileTool, type ShortType } from "./profileTools";

export const HOSTED_SERVER_NAME = "focal";
export const HOSTED_SERVER_VERSION = "0.1.0";
export const RANK_LIST_MAX = 60;

export interface RankedListItem {
  name: string;
  original_position: number;
  lifted: boolean;
  label?: string;
  matched?: string;
  /** Rules that would fold this item away on a page. */
  folded_by?: string[];
}

export interface HostedDeps {
  qloo: QlooClient;
  /** `mcp:<client>`, shown in the activity feed as "via <client>". */
  actor: EntrySource;
  loadProfile(): Promise<ProfileV2>;
  /** Persists one write; throws on conflict. */
  commit(next: ProfileV2, event: ActivityEvent): Promise<void>;
  rankList(input: { type: ShortType; items: string[]; city?: string }, profile: ProfileV2): Promise<{ status: string; items: RankedListItem[] }>;
}

const INSTRUCTIONS = [
  "focal holds the user's taste profile: things they love, like or dislike, vibes, and hard rules.",
  "Read it before recommending. When a save returns choices, ask the user which one they meant and call again with the id; never guess.",
  "Rules you propose stay pending until the user approves them on the focal website.",
].join(" ");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const asResult = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  ...(value && typeof value === "object" && "error" in value ? { isError: true } : {}),
});

export function createHostedServer(deps: HostedDeps): McpServer {
  const server = new McpServer({ name: HOSTED_SERVER_NAME, version: HOSTED_SERVER_VERSION }, { instructions: INSTRUCTIONS });
  let profile: ProfileV2 | null = null;
  const events: ActivityEvent[] = [];
  const current = async () => (profile ??= await deps.loadProfile());

  const run = async (name: string, args: Record<string, unknown>) => {
    let latest = await current();
    const result = await runProfileTool(
      {
        qloo: deps.qloo,
        actor: deps.actor,
        events,
        getProfile: () => latest,
        commit: async (next, event) => {
          await deps.commit(next, event);
          latest = profile = next;
        },
      },
      name,
      args,
    );
    return asResult(result);
  };

  const type = z.enum(TYPES).describe("Kind of thing");
  const strength = z.enum(STRENGTHS);
  const read = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    "read_profile",
    { title: "Read taste profile", description: "Read the user's focal taste profile.", inputSchema: {}, annotations: read },
    () => run("read_profile", {}),
  );
  server.registerTool(
    "taste_summary",
    { title: "Taste summary", description: "Counts and a short summary of the user's taste profile.", inputSchema: {}, annotations: read },
    () => run("taste_summary", {}),
  );
  server.registerTool(
    "search_entities",
    {
      title: "Search things",
      description: "Find real-world things (venues, films, artists, books…) by name.",
      inputSchema: { query: z.string().min(1).max(200), type, city: z.string().max(80).optional() },
      annotations: { readOnlyHint: true },
    },
    (args) => run("search_entities", args),
  );
  server.registerTool(
    "add_thing",
    {
      title: "Save a thing",
      description:
        "Save a thing the user loves, likes or dislikes. Saves only on one clear match; otherwise returns choices to ask the user about. Pass entity_id once the user has picked.",
      inputSchema: {
        name: z.string().min(1).max(200),
        type,
        strength,
        city: z.string().max(80).optional(),
        entity_id: z.string().max(200).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (args) => run("add_thing", args),
  );
  server.registerTool(
    "add_vibe",
    {
      title: "Save a vibe",
      description: "Save a vibe (a style or quality like 'natural wine' or 'minimalist') the user loves, likes or dislikes.",
      inputSchema: { vibe: z.string().min(1).max(200), strength, tag_id: z.string().max(200).optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (args) => run("add_vibe", args),
  );
  server.registerTool(
    "propose_rule",
    {
      title: "Propose a rule",
      description: "Propose a hard rule ('never show me chains'). It stays pending until the user approves it on the focal website.",
      inputSchema: { rule: z.string().min(1).max(200), tag_id: z.string().max(200).optional() },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (args) => run("propose_rule", args),
  );
  server.registerTool(
    "remove_entry",
    {
      title: "Remove from profile",
      description:
        "Remove a thing, vibe or rule from the profile by its exact name. Pass kind when a thing, vibe and rule share a name. The user can undo this on the website.",
      inputSchema: { name: z.string().min(1).max(200), kind: z.enum(["thing", "vibe", "rule"]).optional() },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    (args) => run("remove_entry", args),
  );
  server.registerTool(
    "recommend",
    {
      title: "Recommend",
      description: "Recommendations of one type from the user's profile, excluding things already saved or disliked.",
      inputSchema: { type, city: z.string().max(80).optional(), take: z.number().int().min(1).max(20).optional() },
      annotations: { readOnlyHint: true },
    },
    (args) => run("recommend", args),
  );
  server.registerTool(
    "rank_list",
    {
      title: "Rank a list",
      description:
        "Rank a list of names for this user the way the focal extension does: clear matches move up with a reason, everything else keeps its order. Dislikes are never lifted.",
      inputSchema: {
        type,
        items: z.array(z.string().min(1).max(200)).min(1).max(RANK_LIST_MAX),
        city: z.string().max(80).optional().describe("City, for places only"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => asResult(await deps.rankList(args, await current())),
  );
  return server;
}

/** Serves one MCP HTTP request (JSON responses, no sessions). */
export async function handleHostedRequest(req: Request, deps: HostedDeps, authInfo?: AuthInfo): Promise<Response> {
  const server = createHostedServer(deps);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req, authInfo ? { authInfo } : undefined);
  } finally {
    void server.close();
  }
}
