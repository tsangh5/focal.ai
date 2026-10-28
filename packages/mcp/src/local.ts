/**
 * focal MCP server over stdio, local mode: read-only tools over a profile file.
 *
 * stdout carries MCP protocol traffic ONLY — every log line goes to stderr.
 * A missing QLOO_API_KEY is not fatal at startup: the server boots, and
 * Qloo-backed tools report the missing key per call.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolveProfilePath } from "./deps.js";
import { createToolHandlers } from "./tools.js";

const SERVER_NAME = "focal-ai";
const SERVER_VERSION = "0.0.1";

const candidateSchema = z.object({
  clientId: z.string().min(1).describe("Stable id of the element on the page"),
  name: z.string().min(1).describe("Visible text of the element (what should be resolved)"),
  locationText: z.string().optional().describe("Location text shown next to the element, if any"),
  url: z.string().optional(),
  originalIndex: z.number().int().min(0).describe("Zero-based original position on the page"),
  sponsored: z.boolean().optional(),
});

const candidatesSchema = z
  .array(candidateSchema)
  .min(1)
  .max(50)
  .describe("Page elements to score, in original page order (max 50)");

const rankingShape = {
  pageId: z.string().min(1).describe("Identifier of the page being ranked"),
  pageType: z
    .string()
    .min(1)
    .describe("Qloo entity type of the page, e.g. urn:entity:place (must match entity subtypes)"),
  locationQuery: z.string().optional().describe("Location constraint, e.g. San Francisco"),
  containerId: z.string().optional().describe("Render container id, default focal:results"),
  candidates: candidatesSchema,
};

const handlers = createToolHandlers();
const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

server.registerTool(
  "get_taste_profile",
  {
    title: "Get taste profile",
    description:
      "Read the local focal taste profile (identity, seeds, and rules) from disk. No network call.",
    inputSchema: {},
  },
  async () => handlers.getTasteProfile(),
);

server.registerTool(
  "search_entities",
  {
    title: "Search Qloo entities",
    description:
      "Resolve free text to Qloo entities with disambiguation. Returns at most 5 matches.",
    inputSchema: {
      query: z.string().min(1).describe("Free-text entity name"),
      types: z
        .array(z.string())
        .optional()
        .describe("Qloo entity types to constrain the search, e.g. urn:entity:place"),
      location: z.string().optional().describe("Location constraint"),
    },
  },
  async (args) => handlers.searchEntities(args),
);

server.registerTool(
  "score_candidates",
  {
    title: "Score page candidates",
    description:
      "Rank page elements against the local taste profile: resolve candidates via Qloo, score them, and return order + affinity + summary.",
    inputSchema: rankingShape,
  },
  async (args) => handlers.scoreCandidates(args),
);

server.registerTool(
  "discover_cross_domain",
  {
    title: "Discover cross-domain entities",
    description:
      "Signal-only Qloo insights from the positive taste seeds: entities the profile should like, without filtering to a page list.",
    inputSchema: {
      pageType: rankingShape.pageType,
      locationQuery: rankingShape.locationQuery,
    },
  },
  async (args) => handlers.discoverCrossDomain(args),
);

server.registerTool(
  "explain_ranking",
  {
    title: "Explain one ranking",
    description:
      "Run the rank pipeline and return the grounded explanation (affinity, reason, contributions) for a single candidate by clientId.",
    inputSchema: { ...rankingShape, clientId: z.string().min(1).describe("clientId to explain") },
  },
  async (args) => handlers.explainRanking(args),
);

server.registerTool(
  "create_render_plan",
  {
    title: "Create render plan",
    description:
      "Run the rank pipeline and return the validated RenderPlan (reorder / collapse / annotate / emphasize ops) plus its summary.",
    inputSchema: rankingShape,
  },
  async (args) => handlers.createRenderPlan(args),
);

if (process.env.QLOO_MOCK === "1") {
  console.error("[focal-mcp] QLOO_MOCK=1 — Qloo calls are served from local fixtures.");
} else if (!process.env.QLOO_API_KEY) {
  console.error(
    "[focal-mcp] QLOO_API_KEY is not set — Qloo-backed tools will return errors until it is configured (or set QLOO_MOCK=1 to use fixtures).",
  );
}
console.error(`[focal-mcp] taste profile: ${resolveProfilePath()}`);

const transport = new StdioServerTransport();
await server.connect(transport);
