# Development — focal.ai

How to run and work on this repo. Architecture (as built): [architecture.md](./architecture.md). Frozen interfaces: [contracts.md](./contracts.md). Verification and the wave gate: [testing.md](./testing.md).

## 1. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node | `>=22` (`engines` in root `package.json`); `.nvmrc` pins `24` | Verified with Node v24.1.0 |
| pnpm | `12.4.2` (`packageManager` field) | With corepack enabled (`corepack enable`), pnpm commands use the pinned version automatically. Alternatively install pnpm 12.4.2 directly |
| git | any recent version | |

Nothing else is required globally — `tsx`, `next`, `vitest`, and `eslint` are devDependencies. Workspace packages are consumed as TypeScript source (no `dist` build step).

## 2. First-time setup

```bash
pnpm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
```

- Root `.env` is read by `pnpm probe` (the probe script loads root `.env`, then `apps/web/.env.local`) and is reserved for the future MCP server (T-20). Next.js does **not** read the root `.env`.
- `apps/web/.env.local` is the web server's env (Next loads it in `dev`/`start`). Server-only.
- `.env` and `.env.*` are gitignored except `.env.example`. Never commit real keys, and never reference a key anywhere in client code — only server modules (`apps/web/lib/server/`, `packages/qloo/src/`) and `scripts/probe-qloo.ts` read them.

| Variable | Used by | Required? | Notes |
| --- | --- | --- | --- |
| `QLOO_API_KEY` | web server (`@focal-ai/qloo` client), `pnpm probe` | Required for live data; not needed in mock mode | Server-only; sent upstream as `X-Api-Key`. Hackathon keys work only against the hackathon host. |
| `QLOO_API_BASE` | same | No (default `https://hackathon.api.qloo.com`) | Override only if Qloo says otherwise. |
| `QLOO_MOCK` | `@focal-ai/qloo` client and web `dataSource()` (`/api/health`) | No | Set `1` for labeled fixture data (local only). Never set in production. |
| `FOCAL_DEV_SESSION` | page API, account pages and APIs (`/profile`, `/activity`, `/settings`, `/onboarding`, `/api/{profile,activity,settings,account,feedback}`) | No | Set `1` locally: with sign-in not configured, the website and any bearer token that isn't an `fx_` session act as the `dev@localhost` account (stored in the database when `DATABASE_URL` is set, in memory otherwise, seeded with Fugazi and Rintaro), and identification uses the mock identifier. Ignored when `NODE_ENV=production`. |
| `DATABASE_URL` | `@focal-ai/db` (migrations via `pnpm --filter @focal-ai/db migrate`, tests) | Needed for DB tests; they skip when unset. CI runs a Postgres 17 service | Server-only. Local: Postgres 17 in Docker |
| `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD` (≥32 chars), `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | sign-in (`/sign-in`, `/auth/callback`, `/connect`, `/api/extension/session`, `/api/chat`) | For accounts | Server-only except the redirect URI. Auth routes return 404 until client id, cookie password and redirect URI are set. |
| `NEXT_PUBLIC_FOCAL_EXTENSION_ID` | `/connect` | For the session handoff | The extension id (`chrome://extensions`) that receives the session token. |
| `GROQ_API_KEY` (then `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`) | `/api/chat` provider chain | For chat | Server-only. Tried in order; fails over on 429 or 5xx. |
| `ANTHROPIC_API_KEY` | nothing today | No | Reserved for LLM-assisted features (T-19); no code path reads it yet. |
| `FOCAL_API_KEY`, `FOCAL_MODEL_PROVIDER`, `FOCAL_MCP_TRANSPORT`, `FOCAL_MCP_PORT` | nothing today | No | Declared in root `.env.example` for the future MCP server (T-20 — currently a stub). |

## 3. Run the Studio locally

Three modes, all verified:

**Mock demo — zero keys.**

```bash
QLOO_MOCK=1 pnpm dev   # http://localhost:3000
```

- The status badge shows **MOCK DATA**, and the Inspector "source" pill reads `mock`.
- Mock search substring-matches names inside hand-authored fixtures only (`packages/qloo/src/mock.ts`). Names that resolve: **Rintaro, State Bird Provisions, Zuni Café, House of Prime Rib, Che Fico** (places) and **Fugazi** (artist). Everything else stays `unresolved` and keeps its original position.
- On the demo pages this means: Tables resolves the five fixture places; Atlas (hotels) and Verve (brands) resolve nothing in mock — they render unchanged and the rank response still returns 200 with `meta.unresolved` counts.

**Live.**

```bash
# put QLOO_API_KEY in apps/web/.env.local (cp from .env.example), or export it in the shell
pnpm dev
```

Badge reads "Qloo connected"; Inspector source reads `live`. Without a key the badge says "Qloo key not configured" and requests fail with a server error explaining it.

**Production preview.**

```bash
pnpm build
pnpm --filter @focal-ai/web start        # add -p 3210 if port 3000 is busy
```

**Try the product** (works in mock or live):

1. Open http://localhost:3000/try (the landing page at `/` links to it as "Try it without installing").
2. In the "Your taste" panel, search `Rintaro` (or `Fugazi`) and click **Add**; add 2–3 seeds. The picker hint offers "Try: Rintaro · Fugazi · Zuni Café".
3. Click **Focus N results** on the Tables page.
4. Toggle **Original / Focal / Diff** — Diff shows the moved/collapsed/avg strip and per-card delta arrows.
5. Read the Inspector (right column): the exact Qloo request (path + params), source/duration/unresolved, the plan op summary, and top-3 evidence.
6. Switch to the **Atlas** and **Verve** pages and focus each (mock: mostly unresolved; live: real scorings).
7. **Export JSON** downloads `focal-profile.json`; **Clear** wipes the profile (confirmation dialog). The profile persists in `localStorage` under `focal.profile.v1` across reloads.

## 4. What leaves the browser

Only entity name strings, city strings, Qloo entity IDs, and the taste profile (JSON) are sent — to **this app's** server, per request. The server holds the Qloo key, calls Qloo (which additionally sees only names/city/IDs), and is otherwise stateless: the profile is used for the request and discarded — no database, no accounts, nothing persisted or logged. Page HTML/DOM, form values, and the stored local copy of the profile never leave the browser. `meta.qlooRequest` in rank responses records the upstream path/params with the key excluded (asserted in tests).

## 5. Command reference

Root scripts (quoted exactly from `package.json`):

| Command | Runs | When to use |
| --- | --- | --- |
| `pnpm dev` | `pnpm --filter @focal-ai/web dev` (`next dev`) | Studio with hot reload |
| `pnpm dev:all` | `pnpm --parallel --filter @focal-ai/web --filter @focal-ai/mcp dev` | Studio plus the MCP dev watcher (MCP is a stub today — it logs a notice) |
| `pnpm build` | `pnpm --filter @focal-ai/web build` | Production build of the Studio |
| `pnpm --filter @focal-ai/web start` | `next start` (no root `start` script exists) | Serve the built Studio |
| `pnpm test` | `pnpm -r test` | All package test suites |
| `pnpm typecheck` | `pnpm -r typecheck` | TypeScript across all packages |
| `pnpm lint` | `pnpm -r lint` | ESLint for web; `tsc --noEmit` for core/qloo/mcp |
| `pnpm check` | `pnpm -r typecheck && pnpm -r test` | Pre-PR gate for types + tests (does not lint or build) |
| `pnpm probe` | `tsx scripts/probe-qloo.ts` | Live Qloo contract probe (needs a key) |
| `pnpm e2e` | `pnpm --filter @focal-ai/e2e e2e` | Playwright browser tests for the website, MCP and the extension. Needs Postgres and free ports 3000 and 4567. See [e2e/README.md](../e2e/README.md) |

Per-package variants: `pnpm --filter @focal-ai/core test` (also `@focal-ai/qloo`, `@focal-ai/web`, `@focal-ai/mcp`), same for `typecheck`/`lint`. `pnpm -r <script>` runs the script across every workspace package that defines it (web + the three packages; the MCP test script exits 0 with no tests).

## 6. The Qloo contract probe

Purpose: freeze the live Qloo response shapes — affinity field path, explainability JSON, ID limits, latency, 429 behavior — into [qloo-contract.md](./qloo-contract.md) (ticket T-01). Requires `QLOO_API_KEY`; the probe loads root `.env` then `apps/web/.env.local`.

| Exit code | Meaning |
| --- | --- |
| `0` | All requests returned 2xx |
| `1` | At least one request failed (non-2xx) |
| `2` | No key found — prints setup instructions |

With a key it probes `GET /search` (Rintaro place + Fugazi artist), `GET /v2/insights`, and `GET /v2/tags`, saving raw JSON to `scripts/probe-output/` (created on run, gitignored). The key value is never printed.

**Getting a hackathon key:** request one via the form at https://forms.gle/zz12orkLHTAneLGz6. Keys are issued within a few business days — check your spam folder. When it arrives:

1. Put it in `.env` (`cp .env.example .env` if you have not already).
2. Run `pnpm probe` until it exits 0.
3. Transcribe the (redacted) outcomes into `docs/qloo-contract.md` and tick T-01 in [tickets.md](./tickets.md). If any mapping changes, edit [contracts.md](./contracts.md) first.
4. Switch the demo to live (stop setting `QLOO_MOCK=1`) and keep mock as a labeled fallback only.

## 7. Where to edit what

| Change | Edit |
| --- | --- |
| Demo page content (candidates, blurbs, sponsored flags) | `apps/web/lib/pages/{tables,atlas,verve}.ts` (plus `index.ts`) |
| Ranking / resolver / plan / evidence rules | `packages/core/src/` — keep `packages/core/tests/` in sync |
| Qloo HTTP behavior (params, parsing, errors, cache, mock) | `packages/qloo/src/` (fixtures in `packages/qloo/fixtures/`) |
| API routes | `apps/web/app/api/` (`health`, `qloo/search`, `qloo/rank`) |
| UI components | `apps/web/components/` |
| Client store / fetch wrappers / demo-page types | `apps/web/lib/client/` |
| Frozen interfaces | `docs/contracts.md` — **edit it first** when a contract changes, then the code |
| Backlog and statuses | `docs/tickets.md` |

## 8. Troubleshooting

- **"QLOO_API_KEY is not configured" style failures:** the banner under the error reads "Check that QLOO_API_KEY is set (or QLOO_MOCK=1 for local demo data)." Fix by adding the key to `apps/web/.env.local`, or run with `QLOO_MOCK=1`.
- **429:** per-IP limits are 30 req/min on `/api/qloo/search` and 20 req/min on `/api/qloo/rank` (responses carry `Retry-After`). Upstream Qloo 429s surface as `RATE_LIMIT` with `retryAfterMs`.
- **`pnpm probe` exits 2:** no key found — expected until the hackathon key arrives. It prints the exact setup steps.
- **Web build fails on imports inside packages:** package source files must use extensionless imports (`./cache`, not `./cache.js`) — Turbopack resolves the TS source. Test files are vitest-only and may use `.js` suffixes.
- **Next 16 render-time `new Date()` errors:** do not call `new Date()` during render of a client component; use constants or create timestamps in handlers/effects (see the SSR-safe pattern in `apps/web/lib/client/store.ts`).
- **ESLint `react-hooks/set-state-in-effect` in `store.ts`:** intentional — the one-time hydration-safe `localStorage` load carries a documented `eslint-disable-next-line` with a reason. Do not "fix" it by moving the load into render.
- **Vitest config warning (`ESM syntax in a file loaded as CommonJS`) for `apps/web/vitest.config.ts`:** benign; tests pass.
- **MCP prints "not implemented yet" and exits:** expected (stub for T-20).

## 9. Working agreements

- Keep a wave log in `docs/status.md` and update it after each wave.
- Keep `docs/tickets.md` statuses current (`Status: [x]` only when acceptance criteria pass and tests run in CI).
- One wave = one parallel agent batch; a wave ends with a single verifier pass over the gate in [testing.md §5](./testing.md) — a wave is not done until that gate passes.
- No pushes without confirming remote access; commit only when asked.
- Contract changes edit `docs/contracts.md` first; never silently deviate.
