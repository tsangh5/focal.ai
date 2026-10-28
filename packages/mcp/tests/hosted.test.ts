import { describe, expect, it, vi } from "vitest";
import { createEmptyProfileV2, type ActivityEvent, type ProfileV2 } from "@focal-ai/core";
import type { QlooClient, QlooEntity } from "@focal-ai/qloo";
import { handleHostedRequest, type HostedDeps } from "../src/hosted.js";

const entity = (id: string, name: string, subtype: string, disambiguation?: string) =>
  ({ entityId: id, name, subtype, disambiguation, tagIds: [], tagNames: [], raw: null }) as QlooEntity;

const qloo = {
  search: async ({ query }: { query: string }) => ({
    entities:
      query.toLowerCase() === "rintaro"
        ? [entity("Q-rin", "Rintaro", "urn:entity:place", "San Francisco")]
        : query.toLowerCase() === "dune"
          ? [entity("Q1", "Dune", "urn:entity:movie", "2021"), entity("Q2", "Dune", "urn:entity:movie", "1984")]
          : [],
    durationMs: 1,
    raw: null,
  }),
  searchTags: async ({ query }: { query: string }) => ({ tags: /chain/i.test(query) ? [{ id: "urn:tag:chain", name: "chain" }] : [], raw: null }),
  insights: async () => ({
    entities: [
      { entity: entity("Q-rin", "Rintaro", "urn:entity:place"), affinity: 0.99, rankIndex: 0 },
      { entity: entity("Q-new", "Nopalito", "urn:entity:place"), affinity: 0.9, rankIndex: 1 },
    ],
    durationMs: 1,
    raw: null,
  }),
  getEntities: async () => ({ entities: [], raw: null }),
} as unknown as QlooClient;

function deps(start: ProfileV2 = createEmptyProfileV2(), profileUrl = "https://focal.test/profile") {
  let profile = start;
  const commits: ActivityEvent[] = [];
  const d: HostedDeps = {
    qloo,
    actor: "mcp:claude",
    profileUrl,
    loadProfile: async () => profile,
    commit: async (next, event) => {
      profile = next;
      commits.push(event);
    },
    rankList: vi.fn(async ({ items }) => ({ status: "ranked", items: items.map((name: string, i: number) => ({ name, original_position: i + 1, lifted: false })) })),
  };
  return { d, commits, profile: () => profile };
}

let nextId = 1;
async function rpc(d: HostedDeps, method: string, params: Record<string, unknown> = {}) {
  const res = await handleHostedRequest(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }),
    d,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { result: Record<string, unknown>; error?: unknown };
}
const call = async (d: HostedDeps, name: string, args: Record<string, unknown> = {}) => {
  const { result } = await rpc(d, "tools/call", { name, arguments: args });
  const content = result.content as { text: string }[];
  const text = content[0]!.text;
  const value = (text.startsWith("{") ? JSON.parse(text) : { message: text }) as Record<string, unknown>;
  return { isError: result.isError, value, structured: result.structuredContent as Record<string, unknown> | undefined };
};

describe("hosted MCP server", () => {
  it("initializes and lists the profile tools, with no settings tools", async () => {
    const { d } = deps();
    const init = await rpc(d, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.result.serverInfo).toMatchObject({ name: "focal" });
    const { result } = await rpc(d, "tools/list");
    const names = (result.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual(
      ["add_thing", "add_vibe", "propose_rule", "rank_list", "read_profile", "recommend", "remove_entry", "search_entities", "taste_summary"].sort(),
    );
    expect(names.some((n) => /setting/.test(n))).toBe(false);
  });

  it("pins tool annotations and ui metadata", async () => {
    const { d } = deps();
    const { result } = await rpc(d, "tools/list");
    const tools = result.tools as { name: string; annotations?: Record<string, unknown>; _meta?: Record<string, unknown> }[];
    const ann = (name: string) => tools.find((t) => t.name === name)?.annotations;
    const meta = (name: string) => tools.find((t) => t.name === name)?._meta;
    for (const n of ["read_profile", "taste_summary"]) {
      expect(ann(n)).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    }
    for (const n of ["search_entities", "recommend", "rank_list"]) {
      expect(ann(n)).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    }
    for (const n of ["add_thing", "add_vibe"]) {
      expect(ann(n)).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true });
    }
    expect(ann("propose_rule")).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    expect(ann("remove_entry")).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
    expect(meta("rank_list")).toMatchObject({ ui: { resourceUri: "ui://focal/ranked-list-v1.html" } });
    expect(meta("recommend")).toMatchObject({ ui: { resourceUri: "ui://focal/recommendations-v1.html" } });
    expect((meta("add_thing")?.ui as { visibility?: string[] })?.visibility).toContain("app");
  });

  it("serves both widget resources", async () => {
    const { d } = deps();
    const { result } = await rpc(d, "resources/list");
    const uris = (result.resources as { uri: string }[]).map((r) => r.uri);
    expect(uris).toEqual(expect.arrayContaining(["ui://focal/ranked-list-v1.html", "ui://focal/recommendations-v1.html"]));
    for (const uri of uris) {
      const read = await rpc(d, "resources/read", { uri });
      const [content] = (read.result.contents as { mimeType: string; text: string }[]);
      expect(content!.mimeType).toBe("text/html;profile=mcp-app");
      expect(content!.text).toContain("ui/notifications/tool-result");
      expect(content!.text).toContain("tools/call");
      expect(content!.text).not.toContain("innerHTML");
    }
  });

  it("returns structuredContent matching the JSON text block", async () => {
    const { d } = deps();
    const read = await call(d, "taste_summary");
    expect(read.structured).toEqual(read.value);
    const saved = await call(d, "add_thing", { name: "rintaro", type: "place", strength: "love" });
    expect(saved.structured).toEqual(saved.value);
  });

  it("saves one clear match attributed to the assistant", async () => {
    const { d, commits, profile } = deps();
    const { value } = await call(d, "add_thing", { name: "rintaro", type: "place", strength: "love" });
    expect(value).toMatchObject({ saved: true, name: "Rintaro", profile_page: "https://focal.test/profile" });
    expect(commits[0]).toMatchObject({ actor: "mcp:claude", action: "add" });
    expect(profile().entries[0]).toMatchObject({ name: "Rintaro", source: "mcp:claude" });
  });

  it("refuses to save an ambiguous name and returns choices", async () => {
    const { d, commits } = deps();
    const { value } = await call(d, "add_thing", { name: "Dune", type: "movie", strength: "like" });
    expect(value).toMatchObject({ saved: false, reason: "ambiguous" });
    expect(value.choices).toHaveLength(2);
    expect(commits).toHaveLength(0);
    const picked = await call(d, "add_thing", { name: "Dune", type: "movie", strength: "like", entity_id: "Q2" });
    expect(picked.value).toMatchObject({ saved: true });
  });

  it("tells the assistant to retry with a short phrase when no tag matches", async () => {
    const { d, commits } = deps();
    const { value } = await call(d, "propose_rule", { rule: "Never show me anything loud." });
    expect(value).toMatchObject({ saved: false, reason: "no match" });
    expect(value).not.toHaveProperty("choices");
    expect(commits).toHaveLength(0);
  });

  it("keeps proposed rules pending", async () => {
    const { d, profile } = deps();
    const { value } = await call(d, "propose_rule", { rule: "chain" });
    expect(value).toMatchObject({ saved: true, status: "pending" });
    expect(profile().entries[0]).toMatchObject({ kind: "rule", status: "pending", source: "mcp:claude" });
  });

  it("removes an entry by name and summarises the profile", async () => {
    const { d, commits } = deps();
    await call(d, "add_thing", { name: "rintaro", type: "place", strength: "like" });
    expect((await call(d, "taste_summary")).value).toMatchObject({ things: 1 });
    expect((await call(d, "remove_entry", { name: "Rintaro" })).value).toMatchObject({ removed: true });
    expect(commits.map((e) => e.action)).toEqual(["add", "remove"]);
  });

  it("recommends things not already saved", async () => {
    const { d } = deps();
    await call(d, "add_thing", { name: "rintaro", type: "place", strength: "love" });
    const { value } = await call(d, "recommend", { type: "place", city: "San Francisco" });
    expect(value).toMatchObject({ type: "place", city: "San Francisco" });
    expect((value.results as { name: string }[]).map((r) => r.name)).toEqual(["Nopalito"]);
    expect((value.results as { entity_id?: string }[])[0]?.entity_id).toBe("Q-new");
  });

  it("validates tool input and forwards rank_list", async () => {
    const { d } = deps();
    const bad = await call(d, "add_thing", { name: "x", type: "restaurant", strength: "love" });
    expect(bad.isError).toBe(true);
    const ranked = await call(d, "rank_list", { type: "movie", items: ["Heat", "Dune"] });
    expect(ranked.value).toMatchObject({ status: "ranked" });
    expect(d.rankList).toHaveBeenCalledWith({ type: "movie", items: ["Heat", "Dune"] }, expect.anything());
  });
});
