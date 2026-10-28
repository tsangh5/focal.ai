# @focal-ai/mcp

Two MCP servers live here:

- **Hosted (`src/hosted.ts`)**: served by the website at `/mcp` over Streamable
  HTTP, signed in with WorkOS AuthKit OAuth. It reads and writes the signed-in
  user's profile with the same rules as the website chat (`src/profileTools.ts`):
  `read_profile`, `taste_summary`, `search_entities`, `add_thing`, `add_vibe`,
  `propose_rule`, `remove_entry`, `recommend`, `rank_list`. Ambiguous names return
  choices instead of saving, proposed rules stay pending, every write is
  attributed `mcp:<client>` and undoable, and settings are not exposed. Setup per
  client is on the website's `/connect` page; the Claude Code plugin is in
  `plugins/focal`.
- **Local stdio (`src/index.ts`)**, in one of two modes:
  - **Account mode**, when `FOCAL_TOKEN` is set to a focal session token (the one
    the website hands the extension; `POST /api/extension/session` issues one):
    it forwards to the hosted endpoint (`FOCAL_MCP_URL`, default
    `http://localhost:3000/mcp`), so stdio-only clients get the same nine tools,
    writes included (`src/bridge.ts`).
  - **Local mode** otherwise, described below (`src/local.ts`).

A local [Model Context Protocol](https://modelcontextprotocol.io) server (stdio) for
focal.ai. It lets external agents (Claude Desktop, Claude Code, any MCP client) read
the local taste profile and call Qloo-backed ranking tools on it.

The server runs on your machine, speaks the MCP protocol over stdin/stdout, and is
**read-only**: it never writes to the taste profile or to any other file.

## Run

```bash
pnpm --filter @focal-ai/mcp start
```

The process waits on stdio for an MCP client. Nothing is printed to stdout except
protocol traffic; logs go to stderr. It exits when the client closes the transport
(you can also Ctrl-C it).

Without `QLOO_API_KEY`, startup still succeeds — only `get_taste_profile` and the
local half of the pipeline work; Qloo-backed calls return a clear tool error until
a key is configured. With `QLOO_MOCK=1`, Qloo calls are served from the fixtures in
`packages/qloo/fixtures/` (no network, no key needed).

## Environment

| Variable             | Default                     | Meaning                                                                  |
| -------------------- | --------------------------- | ------------------------------------------------------------------------ |
| `QLOO_API_KEY`       | —                           | Qloo API key. Missing → Qloo-backed tools error; not fatal at startup.    |
| `QLOO_API_BASE`      | `https://hackathon.api.qloo.com` | Qloo API base URL.                                                  |
| `QLOO_MOCK`          | off                         | `1` serves Qloo responses from local fixtures (demo / tests).            |
| `FOCAL_PROFILE_PATH` | `~/.focal/profile.json`     | Path to the taste profile JSON (`TasteProfile` schema, `version: 1`).    |

The profile file is a plain JSON document as produced by the Studio:

```json
{
  "version": 1,
  "updatedAt": "2026-10-18T00:00:00.000Z",
  "seeds": [
    {
      "entityId": "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948",
      "name": "Fugazi",
      "subtype": "urn:entity:artist",
      "polarity": "like",
      "weight": 1,
      "source": "searched",
      "addedAt": "2026-10-18T00:00:00.000Z"
    }
  ],
  "rules": []
}
```

A missing file is fine (empty profile, reported in the tool output). A corrupt
file is a tool error — the server never pretends the profile is empty.

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS). Replace
`/absolute/path/to/focal.ai` with this repository's path — Claude Desktop does not
inherit your shell `PATH`, so the config points straight at the repo's `tsx` binary:

```json
{
  "mcpServers": {
    "focal": {
      "command": "/absolute/path/to/focal.ai/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/focal.ai/packages/mcp/src/index.ts"],
      "env": {
        "QLOO_API_KEY": "your_qloo_key",
        "FOCAL_PROFILE_PATH": "/absolute/path/to/profile.json"
      }
    }
  }
}
```

For a keyless demo, set `"QLOO_MOCK": "1"` in `env` instead of `QLOO_API_KEY`.
Restart Claude Desktop after editing. If `pnpm` is on the app's PATH, this variant
is equivalent:

```json
{
  "mcpServers": {
    "focal": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/focal.ai", "--filter", "@focal-ai/mcp", "start"],
      "env": { "QLOO_MOCK": "1" }
    }
  }
}
```

## Tools

| Tool                    | Inputs                                                        | Returns                                                              |
| ----------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `get_taste_profile`     | —                                                             | Seed/rule counts, seeds (`name`, `subtype`, `polarity`), `profilePath`. No network. |
| `search_entities`       | `query`, optional `types`, `location`                         | Top 5 Qloo entities (`entityId`, `name`, `subtype`, `disambiguation`). |
| `score_candidates`      | `pageId`, `pageType`, `locationQuery?`, `containerId?`, `candidates` (≤50) | Ranked candidates (`name`, `clientId`, `position`, `affinityPct?`, `reason?`, `status`) + summary (`moved`, `collapsed`, `unresolved`). |
| `discover_cross_domain` | `pageType`, `locationQuery?`                                  | Up to 6 signal-only Qloo insights (`name`, `subtype`, `disambiguation?`, `affinityPct?`). |
| `explain_ranking`       | `pageId`, `pageType`, `clientId`, `locationQuery?`, `candidates` | One candidate's `affinityPct`, grounded `reason`, `contributions` — or a clear "not resolved" message. |
| `create_render_plan`    | Same as `score_candidates`                                    | A validated `RenderPlan` (reorder / collapse / annotate / emphasize) + summary. |

`score_candidates` and `create_render_plan` call the same `runRankPipeline` as the
web Studio (`packages/core/src/pipeline.ts`), so results match the app.

## Limitations

- Local stdio server only. There is no remote/hosted endpoint and no OAuth; do not
  expose it on a network.
- Read-only: no profile writes, no `saveProfile`, nothing is persisted anywhere.
- The Qloo key stays in the server process; it is never echoed into tool output or
  error messages.

## Tests

```bash
pnpm --filter @focal-ai/mcp test
```

Unit tests cover the tool handlers against `QLOO_MOCK=1` fixtures; the smoke test
spawns the real server over stdio and exercises the MCP handshake, `tools/list`,
and a `tools/call` round-trip.
