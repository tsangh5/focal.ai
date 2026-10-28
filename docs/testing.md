# Testing & verification — focal.ai

How the repo is tested, what the fixtures do and do not prove, and the release-verifier gate a wave must pass. Dev workflow: [development.md](./development.md). Interfaces under test: [contracts.md](./contracts.md).

## 1. Current test inventory

Vitest everywhere (node environment; no browser/e2e runner yet). Counts below match a local run of `pnpm test`:

| Package | Test files | Tests | What's covered | Notable edge cases |
| --- | --- | --- | --- | --- |
| `@focal-ai/core` | 5 (`tests/`) | **72** | profile codec (11), resolver (15), ranker (14), plan compiler + validator (24), reason builder (8) | corrupt JSON / wrong version / bad shape errors; frozen-input immutability; diacritics + punctuation normalization; duplicate names and city mismatch → `ambiguous`; subtype gate; unresolved order preserved; missing affinity never scored; dislike forces local −1 while keeping raw `affinityPct`; boost never invents scores; annotate rejects `<` and 141 chars, accepts 140; validator collects all violations; reasons cite only profile seeds |
| `@focal-ai/qloo` | 5 (+ `support.ts`) | **46** | request params/URLs (9), error taxonomy (7), TTL cache (4), parsing (11), mock adapter (15) | 401 no retry vs 5xx exactly one retry; `Retry-After` → `retryAfterMs`; abort → `TIMEOUT` after retry; malformed entries skipped not thrown; affinity fallback `query.affinity` → `query.measurements.affinity`; `PARSE` on missing results array; take clamps; fixture marker string pinned; mock dedupe/take/50 ms delay; `createQlooClient({ mock: true })` works without a key |
| `@focal-ai/web` | 3 (`tests/server/`) | **21** | route handlers (7), adapters (6), rate limiter (8) | 400 before any upstream call; malformed JSON → 400; profile with no `like` seed → 400; full rank-through-mock assertions (Rintaro `affinityPct` 93, State Bird 78, unresolved kept, `meta.qlooRequest`, response contains no key material); sliding window; `x-forwarded-for` parsing |
| `@focal-ai/mcp` | 0 | **0** | nothing yet (stub) | `pnpm --filter @focal-ai/mcp test` exits 0 via `--passWithNoTests` |

Test locations: `packages/*/tests/*.test.ts` and `apps/web/tests/server/*.test.ts`. Web vitest config: `include: ["tests/**/*.test.ts"]`, node env, 15 s timeout, `@` alias to `apps/web`.

## 2. How to run

```bash
pnpm test                           # pnpm -r test — all packages
pnpm --filter @focal-ai/core test   # one package (also @focal-ai/qloo, @focal-ai/web, @focal-ai/mcp)
pnpm typecheck                      # pnpm -r typecheck (web runs next typegen + tsc)
pnpm lint                           # pnpm -r lint (web: eslint; core/qloo/mcp: tsc --noEmit)
pnpm build                          # production build of apps/web
pnpm check                          # pnpm -r typecheck && pnpm -r test
```

Notes: root `check` is types + tests only — it does not lint or build. Web tests import route handlers directly (no HTTP server needed); all Qloo traffic is exercised through fixtures, the mock adapter, and fetch spies — no network access.

## 3. Fixtures and honesty rules

Tests use hand-authored fixtures in `packages/qloo/fixtures/*.json`. Every fixture root carries `_fixture: "mock — hand-authored from public docs examples, not live Qloo data"`; the mock client echoes that marker in `raw` payloads and a test pins the exact string.

These fixtures are **not evidence of live API behavior**. Field names, the affinity path, explainability shape, subtype values, ID limits, and latency are unverified until T-01. The only live verification is `pnpm probe` with a real key (outcomes transcribed into [qloo-contract.md](./qloo-contract.md)) plus the future `scripts/smoke-live.ts` (T-22, key-blocked). Until then, treat every fixture-shaped mapping as a T-01 TODO — see [architecture.md §7](./architecture.md) on the subtype convention.

## 4. CI

`.github/workflows/ci.yml` runs on pushes and pull requests to `main`:

1. `actions/checkout@v4`
2. `pnpm/action-setup@v4` with `version: 12.4.2`
3. `actions/setup-node@v4` with `node-version-file: .nvmrc` and pnpm cache
4. `pnpm install --frozen-lockfile`
5. `pnpm -r typecheck`
6. `pnpm -r test`
7. `pnpm --filter @focal-ai/web build`

A green run means: the lockfile is in sync; all four packages typecheck (web includes `next typegen`); core 72 + qloo 46 + web 21 tests pass with no network access to Qloo and no secrets; the Studio production build compiles. CI does not run lint or the probe — run `pnpm lint` locally before opening a PR.

A second job, `e2e`, runs the Playwright suite in `e2e/` (`pnpm e2e`) against a Postgres service: `next dev` with mock Qloo and Jev, fixture copies of Yelp, Letterboxd, Gmail and example.org, and the unpacked extension in Chromium. It needs no keys. On failure it uploads traces, screenshots and the server log as the `e2e-results` artifact. Details: [e2e/README.md](../e2e/README.md).

## 5. Wave verification gate

The release-verifier procedure used before a wave is called done (all commands below were executed on this tree):

1. **Tree shape** — `git status --short`: only the wave's intended files; `scripts/probe-output/` is gitignored and must not be tracked.
2. **Frozen install** — `pnpm install --frozen-lockfile` (exit 0).
3. **All typechecks** — `pnpm -r typecheck` → 4/4 packages green (web: `next typegen && tsc --noEmit`).
4. **All tests** — `pnpm -r test` → core 72, qloo 46, web 21, mcp no-tests; all exit 0.
5. **Web build + route table + prerender sanity**

   ```bash
   pnpm --filter @focal-ai/web build
   # expect: ○ / (static), ƒ /api/health, ƒ /api/qloo/rank, ƒ /api/qloo/search (dynamic)
   grep -c "Loading…" apps/web/.next/server/app/index.html   # expect 0
   grep -c "Your taste" apps/web/.next/server/app/index.html # expect ≥1
   ```

6. **Root lint** — `pnpm lint` → 0 errors (unused-var warnings are acceptable; 0 errors is the bar).
7. **Keyless probe** — `pnpm probe` → exit 2 with the setup-instructions message.
8. **MCP stub** — `pnpm --filter @focal-ai/mcp start` → prints the not-implemented notice, exit 0.
9. **Secret scan**

   ```bash
   grep -rn "QLOO_API_KEY\|hackathon.api.qloo.com" apps/web/.next/static
   ```

   Expect **0 hits** for `hackathon.api.qloo.com`. `QLOO_API_KEY` may appear only as the UI error-hint copy (currently one hit in a client chunk, compiled from `apps/web/app/page.tsx`) — never a key value. Confirm no `.env`/`.env.local` in the tree (only `.env.example` files exist; both real files are gitignored).
10. **Runtime smoke (mock)** — start the production server and check the API surface:

    ```bash
    QLOO_MOCK=1 pnpm --filter @focal-ai/web start -p 3210
    curl -s localhost:3210/api/health
    # {"ok":true,"hasQlooKey":false,"dataSource":"mock"}
    ```

    POST a 3-candidate rank body (2 resolvable + 1 bogus) with a Fugazi seed:

    ```bash
    curl -s -X POST localhost:3210/api/qloo/rank -H 'content-type: application/json' -d '{
      "pageId": "test-page",
      "pageType": "urn:entity:place",
      "locationQuery": "San Francisco",
      "candidates": [
        { "clientId": "c-0", "name": "Rintaro", "locationText": "San Francisco", "originalIndex": 0 },
        { "clientId": "c-1", "name": "State Bird Provisions", "locationText": "San Francisco", "originalIndex": 1 },
        { "clientId": "c-2", "name": "Absolutely Not A Real Venue", "locationText": "San Francisco", "originalIndex": 2 }
      ],
      "profile": {
        "version": 1,
        "updatedAt": "2026-10-17T00:00:00.000Z",
        "seeds": [{
          "entityId": "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948",
          "name": "Fugazi",
          "subtype": "urn:entity:artist",
          "disambiguation": "Washington, D.C.",
          "polarity": "like",
          "weight": 1,
          "source": "searched",
          "addedAt": "2026-10-17T00:00:00.000Z"
        }],
        "rules": []
      }
    }'
    ```

    Expect HTTP 200 with: `ranked` length 3, Rintaro `affinityPct: 93`, `meta.unresolved: 1`, `meta.dataSource: "mock"`, `meta.qlooRequest.path: "/v2/insights"`, and no key material in the body (grep the response for the key value when one is set). Then stop the server.

**A wave is not done until this gate passes.** Record the outcome (test counts, route table, smoke result) with the wave handoff.

## 6. Production smoke checklist (after deploy — T-23/T-24)

Not runnable yet (no deployment exists; the live path is blocked on the T-01 key). Once deployed, walk this list and record results:

| Check | Expected |
| --- | --- |
| Studio URL loads from outside the dev network | 200, UI renders, no console errors |
| `GET /api/health` on the deployed URL | `{"ok":true,"hasQlooKey":true,"dataSource":"live"}` |
| Live search (`POST /api/qloo/search` with `{"query":"Rintaro"}`) | Real Qloo entity IDs + disambiguation (not fixture values) |
| Live rank on Tables with a real seed | Real affinities, grounded reasons, `meta.dataSource: "live"` |
| Induced failure states | Wrong key → honest AUTH error copy; request burst → 429 with `Retry-After`; gibberish candidate → `unresolved`, left in place, no fabricated card |
| Secret scan of the deployed client bundles | No key value anywhere; the variable name may appear only in the error-hint copy |
| Clean-clone walkthrough | README instructions work from a fresh clone in ≤10 minutes (T-24) |
| Devpost requirements | Hosted URL public and working, public repo, project description, license visible in the repo About/label |

## 7. Known gaps

- **Browser tests run against mocks only.** `e2e/` covers the website, MCP and the extension with mock Qloo and Jev and placeholder WorkOS credentials; real sign-in, live Qloo and real sites are still checked by hand. Pages that call `notFound()` answer HTTP 200 with the not-found page, because the shell streams first (a `test.fixme` in `e2e/tests/dev/pages.spec.ts`).
- **No live-API verification yet** — T-01 is blocked on the hackathon key. Every qloo fixture shape (affinity path, explainability, limits) is unverified until `pnpm probe` runs and `docs/qloo-contract.md` is filled.
- **No CI lint step and no CI probe** — lint is a local pre-PR step; probe requires a key and never runs in CI.
- **MCP server is a stub** (T-20): no protocol behavior to test yet.

Manual UI QA checklist (run before any demo or submission):

1. Seed 3 entities: search `Rintaro`, `Fugazi`, and one more fixture-known name in the taste panel and click **Add**; confirm chips render with subtype labels.
2. Focus each of the 3 pages (Tables, Atlas, Verve): 200 path, no console errors; in mock expect the fixture places to score on Tables and mostly-unresolved (kept in place) on Atlas/Verve.
3. Toggle **Diff**: strip shows moved/collapsed/avgMovement and delta arrows; **Original** restores the original order; **Focal** shows the ranked order.
4. **Reset** returns to Original and clears the response; Focus re-enables.
5. Profile export/import round-trip: **Export JSON** downloads `focal-profile.json`; in a fresh browser profile, paste that JSON into `localStorage` under `focal.profile.v1`, reload, and confirm the seeds restore (there is no import button yet; `deserializeProfile` validates the schema).
6. **Clear** the profile (confirm dialog): empty-state copy appears and Focus stays disabled until a seed is added.
