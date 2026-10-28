# Implementation tickets — focal.ai v2 (the extension)

**Last status update:** 2026-10-20 — backlog created from [spec.md](./spec.md). See [status.md](./status.md) for the log.

**Deadline:** October 30, 2026, 11:45pm EDT (Qloo Agentic Hackathon). Target submission Oct 29.

**How to use this file.** One ticket = one agent-sized unit of work. `Owns:` globs keep parallel tickets on disjoint files; if two open tickets touch the same path, a dependency is missing. Mark `Status: [x]` only when the acceptance criteria pass and the tests run in CI. Spec sections are cited as §n.

The Studio-era tickets (T-01..T-25), still referenced by older docs such as `architecture.md`, are archived in [archive/tickets-studio.md](./archive/tickets-studio.md).

---

## Wave V — settle the unknowns (spec §8)

### V-01 · Qloo signal behaviour
Status: [ ] · **P0** · Deps: Qloo key · Owns: `scripts/probe-unknowns.ts` (qloo section), `docs/qloo-contract.md`
Run `pnpm probe:unknowns qloo`. Record in `docs/qloo-contract.md`: whether `signal.interests.tags` changes scores for place / movie / brand, whether any weight syntax is accepted, and how many entity signals one call uses. Check the weight syntax against Qloo's Parameter Reference.
**Acceptance:** contract updated with redacted evidence; spec §5.5 updated to match (tags as signals or local boosts per type; weights or cut-only; signal cap).

### V-02 · Jev identification: cost, speed, accuracy
Status: [ ] · **P0** · Deps: TypeSafe key · Owns: `scripts/probe-unknowns.ts` (jev section)
Run `pnpm probe:unknowns jev` on the labelled sample pages, then on snippets captured from 10 real sites once X-03 exists. Record tokens per page, cost, latency, accuracy by confidence, and behaviour on non-list pages.
**Acceptance:** confidence threshold for §5.3 chosen from data; cost per identification recorded in spec §7.

### V-03 · Free LLM tiers and model bake-off
Status: [ ] · **P0** · Deps: free Groq / Cerebras / OpenRouter keys · Owns: `scripts/probe-unknowns.ts` (llm section), `scripts/chat-bakeoff/**`
Confirm tool calling per provider and model with `pnpm probe:unknowns llm`, then run ~20 scripted onboarding chats against 3 shortlisted open-weight models (locally through Ollama where possible), scoring right entity, asks when ambiguous, strength.
**Acceptance:** chosen model and provider order recorded in spec §5.9 with scores.

### V-04 · Sign-in service that can serve MCP OAuth
Status: [ ] · **P0** · Deps: none · Owns: `docs/decisions.md` (new record)
Evaluate WorkOS AuthKit, Clerk, Stytch, Descope, Better Auth, Supabase Auth and Cloudflare workers-oauth-provider for: Google + email-link sign-in, OAuth 2.1 authorization server for MCP (resource indicators, Client ID Metadata Documents or dynamic client registration), free tier, Next.js support.
**Acceptance:** decision record with the choice and evidence; a ChatGPT or claude.ai connector completes the OAuth flow against a spike.

---

## Wave P — platform

### P-01 · Database and schema
Status: [ ] · **P0** · Deps: none · Owns: `packages/db/**`
Postgres schema and migrations for User, ProfileEntry, ActivityEvent, SiteSetting, Layout, ResolutionCache, PageResult (§4.5). PageResult rows expire after 24 h.
**Acceptance:** migrations apply from empty; typed access layer with unit tests against a local Postgres in CI.

### P-02 · Accounts and extension session hand-off
Status: [ ] · **P0** · Deps: V-04, P-01 · Owns: `apps/web/app/(auth)/**`, `apps/web/lib/server/auth/**`
Google and email-link sign-in on the website; an endpoint that issues the extension a session token through externally connectable messaging; token refresh and sign-out.
**Acceptance:** signed-in website session; the extension receives and refreshes a token without its own login screen.

### P-03 · Profile v2 and activity
Status: [ ] · **P0** · Deps: P-01, P-02 · Owns: `packages/core/src/profile.ts`, `apps/web/app/api/profile/**`, `apps/web/app/api/activity/**`
Things, vibes and rules with strength (love / like / dislike / never) and source; pending rules; every write produces an ActivityEvent; undo restores the previous state. Export and delete account.
**Acceptance:** API tests for add / remove / change / approve / undo and attribution; export returns the full profile JSON.

### P-04 · Shared resolution cache and Qloo queue
Status: [ ] · **P0** · Deps: P-01 · Owns: `packages/qloo/src/pace.ts`, `apps/web/lib/server/qloo.ts`, `apps/web/lib/server/resolution/**`
One server-wide Qloo queue under 5 req/s; resolution results cached in ResolutionCache keyed by normalized name, type and city; cache hits skip `/search`.
**Acceptance:** tests show a second resolve of the same item makes no Qloo call; queue never exceeds the pace under concurrent ranks.

---

## Wave X — extension

### X-01 · MV3 scaffold and toolbar menu
Status: [ ] · **P0** · Deps: P-02 · Owns: `apps/extension/**` (scaffold, background, toolbar)
Chromium MV3 build; background service worker owns all server calls; toolbar menu with site on/off, "Why this order?", open dashboard, signed-in status.
**Acceptance:** loads unpacked in Chrome, Edge and Brave; signs in through the website; CI builds the zip.

### X-02 · Eligibility guards
Status: [ ] · **P0** · Deps: X-01 · Owns: `apps/extension/src/guards/**`
Built-in never-run list (§5.1), user skip list and per-site off from settings, password / payment field detection, incognito off by default.
**Acceptance:** unit tests per rule; on a blocked page nothing is extracted and no request is sent.

### X-03 · List detection and snippet extraction
Status: [ ] · **P0** · Deps: X-01 · Owns: `apps/extension/src/detect/**`
Find the dominant group of 3+ repeated cards with title-like text; extract up to 6 snippets of at most 80 characters per card plus outbound link hosts and paths; page city hints (search box, URL params, headings).
**Acceptance:** fixtures saved from 10 real sites detect the right list; non-list pages (inbox-like, news) detect nothing or are rejected by X-04.

### X-04 · Identify endpoint and layout learning
Status: [ ] · **P0** · Deps: V-02, X-03, P-01 · Owns: `apps/web/app/api/page/identify/**`, `apps/web/lib/server/jev/**`, `apps/extension/src/layouts/**`
One Jev call per new layout (name / type / city per card, page-level "is this a list of things"); confidence threshold; derive and save the Layout; the extension identifies matching layouts locally with no Jev call. Per-user Jev rate limit.
**Acceptance:** second visit to the same layout makes no identify call; low-confidence cards are excluded; TypeSafe key never leaves the server.

### X-05 · Rank endpoint v2
Status: [ ] · **P0** · Deps: P-03, P-04, V-01 · Owns: `packages/core/src/{pipeline,rank,plan,evidence}.ts`, `apps/web/app/api/page/rank/**`
Signal selection (§5.5), one insights call, lift-only rule (§5.6), dislikes never lifted, rule folds only on Qloo tags, labels with grounded reasons, PageResult stored for 24 h.
**Acceptance:** core tests for the lift rule, signal selection, folds and labels; route returns a valid plan; outside-ID confirmation covered where present.

### X-06 · Apply engine and render gate
Status: [ ] · **P0** · Deps: X-05 · Owns: `apps/extension/src/apply/**`
CSS order for flex / grid containers, node moves otherwise, re-apply on re-render; 300 ms gate; "ranking…" chip with Apply when the user has interacted; strip with Undo; fold lines with Show.
**Acceptance:** fixture pages for flex, grid and block lists reorder correctly; Undo restores the original DOM order; site click handlers still work after reordering.

### X-07 · Dynamic content
Status: [ ] · **P0** · Deps: X-06 · Owns: `apps/extension/src/watch/**`
Infinite-scroll top-ups through the cache without Jev; labels in place for late matches; lifted section updates only off screen; SPA navigation and new searches treated as new pages.
**Acceptance:** fixture with appended items never moves seen items; SPA route change triggers a fresh rank.

### X-08 · Labels and on-page feedback
Status: [ ] · **P0** · Deps: X-06, P-03 · Owns: `apps/extension/src/labels/**`, `apps/web/app/api/feedback/**`
"Top pick for you" / "Good match" with "because you like …"; More like this / Not for me write likes and dislikes with activity events.
**Acceptance:** labels never show invented reasons; a tap appears in the activity feed with undo.

---

## Wave W — website

### W-01 · Shell, onboarding flow
Status: [ ] · **P0** · Deps: P-02 · Owns: `apps/web/app/(site)/**`
Landing, sign-in, onboarding (chat → sites to skip → install or confirm extension → "Try it now" links).
**Acceptance:** a new account completes onboarding end to end; the extension shows as connected.

### W-02 · Chat agent
Status: [ ] · **P0** · Deps: V-03, P-03 · Owns: `apps/web/app/api/chat/**`, `apps/web/lib/server/chat/**`, `apps/web/components/chat/**`
OpenAI-compatible provider chain with fallback on rate limits; lean context; tools from §5.9 with write rules enforced in the tools; per-user daily cap.
**Acceptance:** scripted chats produce correct entries; ambiguous names return choices; rules are created pending; provider failover tested.

### W-03 · Profile, activity and settings pages
Status: [ ] · **P0** · Deps: P-03 · Owns: `apps/web/app/(site)/{profile,activity,settings}/**`
View and edit things, vibes and rules with strength; approve pending rules; activity with attribution and undo; sites to skip; export and delete.
**Acceptance:** every action round-trips through the API and shows in the feed.

### W-04 · "Why this order?" and playground
Status: [ ] · **P1** · Deps: X-05 · Owns: `apps/web/app/(site)/{why,try}/**`, `apps/web/components/{inspector,surface,paste}/**`
`/why/<id>` renders a PageResult with the Inspector; `/try` keeps the Studio demo and paste pages on the lift-only rules without an account.
**Acceptance:** toolbar link opens the right result; playground output matches the rank endpoint for the same input.

---

## Wave M — outside assistants

### M-01 · Hosted MCP with OAuth and write tools
Status: [ ] (code merged in #8; acceptance runs in M-03) · **P1** · Deps: V-04, P-03 · Owns: `packages/mcp/**`, `apps/web/app/mcp/**`
HTTP transport with OAuth; tools from §5.10; ambiguity refusal; pending rules; attribution "via <assistant>"; stdio kept for local clients.
**Acceptance:** ChatGPT and claude.ai connect and add an entry that appears in the feed with undo.

### M-02 · Connect page
Status: [ ] · **P1** · Deps: M-01 · Owns: `apps/web/app/connect/**`, `apps/web/components/connect/**`
Step-by-step connection for ChatGPT, claude.ai, Claude Desktop and Claude Code. ChatGPT follows its current flow: chatgpt.com/plugins → **+** → Add custom MCP server → OAuth → Create as a plugin, then `@focal` in a chat.
**Acceptance:** each path verified once by hand.

### M-03 · Deploy, configure AuthKit, verify in ChatGPT and claude.ai
Status: [ ] · **P0** · Deps: S-03, M-02 · Owns: `docs/deployment.md`, `scripts/smoke-prod.ts` (MCP checks)
Production env adds `WORKOS_AUTHKIT_DOMAIN` and `FOCAL_PUBLIC_URL`. In WorkOS → Connect → Configuration, enable Client ID Metadata Documents and dynamic client registration, and add `https://<host>/mcp` as the default Resource Indicator. `pnpm smoke` checks MCP discovery: the protected-resource metadata names `<base>/mcp` and an authorization server; an unauthenticated `POST /mcp` returns 401 with `resource_metadata`; the authorization server advertises `S256` and a registration method.
**Acceptance:** smoke passes against production. In ChatGPT (custom MCP server, OAuth) and claude.ai: sign in, read the profile, save a thing (ChatGPT asks to confirm), an ambiguous name returns choices, a proposed rule stays pending, `rank_list` renders; the activity shows "via chatgpt" / "via claude".

### M-04 · ChatGPT-ready tool surface
Status: [ ] · **P1** · Deps: M-01 · Owns: `packages/mcp/src/{hosted,profileTools}.ts`, `packages/mcp/tests/**`
Every tool declares `readOnlyHint`, `destructiveHint` and `openWorldHint`; results carry `structuredContent` next to the JSON text block; descriptions say when to use each tool; write results link the profile page.
**Acceptance:** tests pin the annotations of all 9 tools and `structuredContent` on results.

### M-05 · In-chat UI (MCP Apps)
Status: [ ] · **P1** · Deps: M-04 · Owns: `packages/mcp/src/widgets.ts`, `packages/mcp/src/hosted.ts`, `packages/mcp/tests/**`
`rank_list` renders a ranked card (lifted items with their label first, the rest in original order); `recommend` renders cards with Love / Like buttons that save through `add_thing` from the widget. Resources are `ui://focal/…` with `text/html;profile=mcp-app`, self-contained (no external fetches), and render data as text only.
**Acceptance:** resource list/read tests; both widgets render from a tool-result notification in a local harness; they render in ChatGPT after M-03.

### M-06 · Approve and undo page (W-03 slice)
Status: [ ] · **P0** · Deps: P-03 · Owns: `apps/web/app/profile/**`, `apps/web/app/api/profile/**`, `apps/web/components/profile/**`
Signed-in `/profile` with pending rules (Approve), recent activity with who made each change (Undo), and the current entries. Assistant write results point to it. W-03 later grows this into the full profile, activity and settings pages.
**Acceptance:** route tests for approve and undo (attributed, version-guarded); a rule proposed over MCP can be approved and an assistant's save can be undone from the page.

---

## Wave S — ship

### S-01 · Privacy policy and Web Store listing
Status: [ ] · **P0** · Deps: X-02, W-02 · Owns: `apps/web/app/(site)/privacy/**`, `apps/extension/store/**`
Policy matching §6 (what is sent when, third parties, retention, deletion); store listing with the `<all_urls>` justification; submit early, since broad permissions get an in-depth review. A downloadable zip is the fallback for judges.
**Acceptance:** listing submitted; policy linked from the site and the listing.

### S-02 · End-to-end tests
Status: [ ] · **P0** · Deps: X-06, W-01 · Owns: `e2e/**`
Playwright loads the unpacked extension against saved fixture pages with the server's Qloo and Jev calls mocked; covers guard, detect, identify, rank, apply, undo, feedback.
**Acceptance:** green in CI with no network access.

### S-03 · Deploy and live smoke
Status: [ ] · **P0** · Deps: P-01, P-02 · Owns: `scripts/smoke-prod.ts`, deployment config
Website and API on Vercel with database, sign-in and server-only keys; live smoke against the deployed URL.
**Acceptance:** `pnpm smoke` passes against production with live Qloo and Jev.

### S-04 · README and submission
Status: [ ] · **P0** · Deps: S-01, S-03 · Owns: `README.md`, `docs/submission.md`, `docs/demo-script.md`
Rewrite README and Devpost text for the extension; demo script on real sites; disclose limits honestly.
**Acceptance:** submitted by Oct 29 with hosted URL, extension link or zip, and repo.

### S-05 · Qloo access after the hackathon
Status: [ ] · **P1** · Deps: none · Owns: none (non-code)
The hackathon key is deactivated after judging. Start the commercial-key conversation with Qloo.
**Acceptance:** a path to a production key is known.

---

## Critical path

V-04 → P-02 → X-01 → X-03 → X-04 → X-05 → X-06 → S-02 → S-03 → S-04, with V-01..V-03 settling inputs early and W-01..W-03 in parallel once P-03 lands.
