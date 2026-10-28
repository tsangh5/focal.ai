import { STRENGTHS, TYPES, normalizeName, runProfileTool, type ProfileToolContext } from "@focal-ai/mcp/profile-tools";
import type { ToolSpec } from "./providers";

export const CHAT_TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "search_entities",
      description: "Find real-world things (venues, films, artists…) by name. Use before adding when unsure.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, type: { type: "string", enum: TYPES }, city: { type: "string" } },
        required: ["query", "type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_thing",
      description:
        "Save a thing the user likes, loves or dislikes. Saves only on one clear match; otherwise returns choices to ask the user about. Pass entity_id when the user picked one of the choices.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: TYPES },
          strength: { type: "string", enum: STRENGTHS },
          city: { type: "string" },
          entity_id: { type: "string" },
        },
        required: ["name", "type", "strength"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_vibe",
      description: "Save a vibe (a style or quality like 'natural wine' or 'minimalist') the user likes or dislikes.",
      parameters: {
        type: "object",
        properties: { vibe: { type: "string" }, strength: { type: "string", enum: STRENGTHS }, tag_id: { type: "string" } },
        required: ["vibe", "strength"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_rule",
      description: "Propose a hard rule ('never show me chains'). It stays pending until the user approves it on the website.",
      parameters: {
        type: "object",
        properties: { rule: { type: "string" }, tag_id: { type: "string" } },
        required: ["rule"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_entry",
      description: "Remove something from the profile by name. Pass kind when a thing, vibe and rule share a name.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" }, kind: { type: "string", enum: ["thing", "vibe", "rule"] } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: { name: "read_profile", description: "Read the user's current taste profile.", parameters: { type: "object", properties: {} } },
  },
];

export type ToolContext = Omit<ProfileToolContext, "actor">;
export { normalizeName };

/** Executes one website-chat tool call with the shared write rules, attributed to `chat`. */
export const runTool = (ctx: ToolContext, name: string, args: Record<string, unknown>) =>
  runProfileTool({ ...ctx, actor: "chat" }, name, args);
