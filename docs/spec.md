# Product spec — focal.ai v2 (the extension)

**Date:** 2026-10-20 · **Status:** Proposed (pending team review) · **Supersedes:** the hosted-Studio plan in [decisions.md](./decisions.md) D-1 and D-2; the previous backlog is archived at [archive/tickets-studio.md](./archive/tickets-studio.md).

This spec defines the product we are building: a browser extension that re-orders real websites around the user's taste, with a profile written by a chat agent. It was produced by walking the design tree one decision at a time; §10 lists every decision. Anything not yet verified against a live API is marked **UNVERIFIED** and appears in §8 with the test that settles it.

---

## 1. North star

> You tell a chat agent what you like. It builds your taste profile. Every site you visit after that shows what you care about most first, automatically.

Same site, same data, your ordering. focal lifts what you will care about to the top of the lists you already browse, says why, and leaves the rest of the page as the site made it.

## 2. User journeys

**First run (account first).**
1. The user lands on the focal website (from the landing page, the Web Store listing or a shared link) and signs in with Google or an email link.
2. Onboarding chat: "Tell me a few things you love." The agent resolves what they mention to Qloo entities and tags and writes the profile (rules in §5.8).
3. Sites to skip: the built-in never-run list is shown; the user adds their own.
4. Install the extension, or confirm it is connected. The website shows "Try it now" links matched to the profile (e.g. restaurant search in their city, a film list).

**Every day.** The user browses normally. On any eligible page with a list of things Qloo knows about (restaurants, hotels, films, shows, artists, books, podcasts, games, brands, destinations, people), the clear matches move to the top with a label such as "Top pick for you · because you like Fugazi and Rintaro". A strip above the list says "focal lifted 3 for you · Undo". Each lifted card has **More like this** and **Not for me**.

**Teaching it more.** In the website chat ("I loved Kissaki last night, and I'm done with sports bars"), or from an outside assistant over MCP ("add the ramen place I just mentioned to my focal profile"). Every change lands in the activity feed with who made it and an undo.

**Asking why.** The extension's toolbar menu has "Why this order?", which opens the website's inspector for the page the user was on: what was identified, what was sent to Qloo, each item's exact Qloo affinity and the likes behind it.

**Trying without installing.** The website's playground (`/try`) re-orders demo lists and pasted lists with the same rules as the extension, no account needed.

## 3. Scope

**In:** Chromium extension (Chrome, Edge, Brave, Arc, Opera); automatic list detection on any site; Jev-assisted identification with learned layouts; lift-only ranking with labels; dislikes and hard rules; accounts and a server-side profile; website (onboarding, chat, profile, activity, settings, connect assistants, playground, inspector); hosted MCP with OAuth and write tools; explicit on-page feedback.

**Out (decided against):** sponsored-result detection; passive learning from clicks or browsing; hiding anything except by a user's hard rule; per-site hand-written adapters as the primary mechanism.

**Later:** Firefox; community sharing of learned layouts; multiple profiles (work/home/travel); local-only mode; paid LLM tier; commercial Qloo key (required to run past the hackathon, see §7).

## 4. Architecture

```
┌──────────────────────── user's browser ─────────────────────────┐
│ Extension (MV3)                                                  │
│  guards → detect list → extract snippets → [layout known?] ──┐   │
│  apply plan (CSS order / move) ← labels, undo, feedback taps │   │
│  toolbar: site on/off · "Why this order?" · open dashboard   │   │
└───────────────┬───────────────────────────────▲──────────────┼───┘
                │ identify (new layouts only)   │ plan          │ rank
                ▼                               │               ▼
┌──────────────────────── focal server (Next.js) ─────────────────┐
│ /api/page/identify ──► Jev (TypeSafe)   layout store (shared)    │
│ /api/page/rank ──► resolve (shared cache) ──► Qloo insights      │
│                    signal selection · lift rule · plan           │
│ /api/profile · /api/activity · /api/feedback · /api/settings     │
│ /api/chat ──► open-weight LLM (free tiers, fallback chain)       │
│ /mcp (HTTP, OAuth) ──► same profile tools                        │
│ Postgres: users, profile entries, activity, settings, layouts,   │
│           resolution cache, short-lived page results            │
└──────────────────────────────────────────────────────────────────┘
        ▲ website pages (same Next.js app): onboarding, chat, profile,
          activity, settings, connect, /try playground, /why/<id>
```

### 4.1 Extension (`apps/extension`, new)

- **Manifest V3**, one build for Chromium browsers. Host permission `<all_urls>` (Chrome shows "read and change all your data on all websites"; expect a slower, in-depth Web Store review).
- **Session:** the website hands the extension a session token after sign-in (externally connectable messaging from the focal origin); the extension never shows its own login.
- **Local state (`chrome.storage`):** session token, built-in never-run list version, the user's sites to skip, per-site on/off, learned layouts for sites visited, and the profile version. The profile itself stays on the server; the extension caches settings so eligibility checks never need the network.
- **Pipeline per page:** guards (§5.1) → list detection (§5.2) → identification (§5.3) → rank request (§5.4) → apply (§5.6) → watch for changes (§5.7).
- **Server calls go from the background service worker**, which is exempt from page CORS under its host permissions; content scripts never call the API directly.
- **Toolbar menu:** on/off for this site, "Why this order?", open dashboard, signed-in status.

### 4.2 focal server (`apps/web` API routes, evolved)

| Endpoint | Purpose |
|---|---|
| `POST /api/page/identify` | Card snippets for a new layout → Jev → name/type/city per card + a layout description to save |
| `POST /api/page/rank` | Identified items for a page → resolve → one Qloo insights call → lift decision → render plan + labels; stores the result for "Why this order?" (24 h) |
| `GET/POST /api/profile` | Read and write things, vibes and rules (§4.5); every write produces an activity event |
| `GET /api/activity`, `POST /api/activity/:id/undo` | Activity feed and undo |
| `POST /api/feedback` | More like this / Not for me from a page |
| `GET/PUT /api/settings` | Sites to skip, preferences |
| `POST /api/chat` | Website chat agent (§5.9) |
| `/mcp` | Hosted MCP endpoint with OAuth (§5.10) |

Server-wide concerns: one Qloo request queue paced under 5 req/s; a shared resolution cache keyed by (normalized name, type, city) → entity, kept indefinitely (Qloo's hackathon guide allows private server-side caching with no time limit); per-user limits on Jev calls, rank calls and chat messages.

### 4.3 Website (`apps/web` pages)

`/` landing · `/signin` · `/onboarding` · `/chat` · `/profile` · `/activity` · `/settings` · `/connect` (ChatGPT / Claude setup) · `/try` (playground: today's Studio pages on the new ranking rules) · `/why/<id>` (inspector for a page ranking) · `/privacy`.

### 4.4 MCP (`packages/mcp`, evolved)

Moves from local stdio to a hosted HTTP endpoint with OAuth so ChatGPT and claude.ai can connect; stdio stays for local clients. Tools and rules in §5.10.

### 4.5 Data model

| Record | Fields (sketch) | Notes |
|---|---|---|
| User | id, email, auth provider ids, created | |
| ProfileEntry | id, user, kind (`thing` / `vibe` / `rule`), qloo id (entity or tag URN), name, type, strength (`love` / `like` / `dislike`; rules are `never`), source (`chat` / `mcp:<client>` / `page` / `manual`), created | Rules start `pending` when proposed by an agent and become active on approval |
| ActivityEvent | id, user, actor, action (add / remove / change / approve / undo), entry snapshot, at, undone | Feeds the activity page and undo |
| SiteSetting | user, hostname, mode (`skip` / `off` / `on`) | Built-in never-run list is code, not data |
| Layout | hostname, path pattern, card fingerprint, name position, type, city source, confidence, learned at | Shared across users: holds structure only, never page content |
| ResolutionCache | normalized name, type, city → entity id + match status | Shared across users |
| PageResult | id, user, hostname, items with status/affinity/reasons, plan, created | Deleted after 24 h; backs `/why/<id>` |

## 5. Behaviour

### 5.1 Where focal runs

Runs on every page except:
- **Built-in never-run list (not configurable):** banking and payments, health portals, government sites, email, messaging, document and file storage, password managers, sign-in and account pages, and focal's own site.
- **Sites the user skips** (entered during onboarding, editable in settings) and sites switched off from the toolbar.
- **Pages with a password or payment field**, and **incognito windows** unless the user enables incognito.

Pages with no detected list are left alone, and nothing is sent anywhere.

### 5.2 Finding the list

Automatic detection on any site, no per-site adapters: find the dominant group of repeated sibling elements with similar structure (cards), at least 3 of them, containing short title-like text. For each card, extract up to 6 text snippets (title, subtitle, address line, badge; each at most 80 characters) and any outbound link hosts and paths. Detection and extraction run locally.

### 5.3 Identifying each item (Jev)

- **New layout:** the extension sends the page's hostname, path pattern, any city hints found on the page (search box value, URL parameters, headings) and the card snippets to `/api/page/identify`. The server asks Jev (TypeSafe System One, `POST https://api.typesafe.ai/v1/systemone`) one request per page with, for each card:
  - `name`: choice among that card's snippets (or `none`)
  - `type`: choice among Qloo's 10 insight types (or `not_a_thing`)
  - `city`: choice among the page's city hints (or `unknown`), for places and destinations
  
  plus one page-level yes/no: "is this a list of real-world things?"
- **Confidence rule:** a card whose answers fall below the confidence threshold is left untouched. Initial threshold 0.8, tuned with the validation script (§8).
- **Layout learning:** once Jev has picked names on a page, the server derives where names sit in that card structure, the page's type and where the city comes from, and saves a Layout. Later visits to a matching layout are identified locally with no Jev call and only names, type and city are sent to the rank endpoint.
- **Confirmation by outside IDs:** where a card links to a site Qloo records an ID for (Resy, Michelin, Tripadvisor, Google Place), a matching ID on the Qloo entity confirms the match.

### 5.4 Matching and scoring

1. Resolve each identified item through the shared cache, then Qloo `/search` (type and city filtered). The existing strict resolver rules apply (name normalization, type must match, city context decides between same-named entities; never invent a match).
2. Choose the signals for this page (§5.5) and make **one** `/v2/insights` call with `filter.results.entities` set to the resolved items and `feature.explainability=true`.

### 5.5 Which likes go into a ranking

- Your top ~5 favourites overall, of any type (cross-domain taste is Qloo's strength).
- Fill up to the signal cap with your strongest likes of this page's type.
- Add the vibes (tags) that apply to this type as `signal.interests.tags` (**UNVERIFIED**: if the live test shows tag signals have no effect for a type, vibes act only as local boosts there).
- Strength is sent as a weight if Qloo accepts weights (**UNVERIFIED**); otherwise it only decides which likes make the cut.
- The cap starts at 20 (the current code's choice); the validation script measures Qloo's real limit.

### 5.6 Changing the page

- **Lift only.** Items that score clearly above this page's average move to the top, best first. Initial rule, to be tuned: at least 3 scored items on the page; lift items whose affinity is at least one standard deviation above the page mean, at most 5. Everything else, including unmatched items, keeps the site's order. Scores are compared within the page because Qloo's levels differ by type (places around 0.7, destinations around 0.9).
- **Reorder in place.** Prefer CSS ordering when the container is flex or grid (no nodes move); otherwise move nodes; re-apply when the site re-renders its list. Rewriting the list is a last-resort fallback for layouts where neither works.
- **Labels:** "Top pick for you" for the one or two clearest matches, "Good match" for the rest, followed by "because you like X and Y" only when Qloo's explainability names likes from the profile. No reason text is ever invented. Exact Qloo affinity appears only in "Why this order?".
- **Dislikes** (things and vibes) are never lifted and stay where the site put them.
- **Hard rules** fold matching items into one line in place, e.g. "2 hidden by your rules (chain) · Show", only when Qloo has the item tagged with the rule's tag.
- **Undo** in the strip restores the site's order for that page.
- **Sponsored results are not detected** and are ranked like anything else; labels say "matches your taste", never "recommended".

### 5.7 Timing and changing pages

- **Render gate:** hide the list for at most 300 ms. If the plan is ready, the page appears already ordered. If not, show the site's order with a "focal is ranking…" chip; when the plan arrives, re-order with a short animation only if the user has not scrolled or clicked in the list, otherwise the chip offers "Apply".
- **Items loaded later** (infinite scroll): scored in the background through the cache, with no Jev call. Clear matches are labelled where they appear; the lifted section updates only while it is off screen. Nothing the user has already seen moves.
- **New search, filter or page within a single-page app** counts as a new page.

### 5.8 Learning

- **Chat:** the website chat and MCP assistants write the profile (§5.9, §5.10).
- **On-page taps:** More like this and Not for me write a like or dislike, logged in the activity feed with undo.
- **No passive learning.** Clicks, visits and dwell time are never recorded or used.

### 5.9 Website chat agent

- **Model:** an open-weight model chosen by a bake-off: about 20 scripted onboarding chats, scored on picking the right entity, asking when a name is ambiguous, and setting strength correctly. Shortlist from families currently strong at tool use (Qwen, GLM, DeepSeek, Kimi, gpt-oss).
- **Hosting, free for now:** OpenAI-compatible free tiers tried in order (Groq, then Cerebras, then OpenRouter `:free` models), switching on rate-limit errors; local models through Ollama for development and the bake-off. Tool calling on each free tier is **UNVERIFIED** (§8).
- **Lean context:** a compact profile summary instead of full history, short instructions and tool descriptions; target 50–100k tokens per onboarding chat. A per-user daily message cap protects the shared allowance.
- **Tools:** search entities, search tags, add entry (with strength), remove entry, propose rule, recommendations, taste summary, read profile.
- **Write rules, enforced in the tools rather than by the model:** save directly when Qloo returns exactly one match of the right type (with undo); return the choices when ambiguous so the agent asks; hard rules are created `pending` until the user approves them.

### 5.10 Outside assistants (MCP)

Read and write with the same rules as the chat: read profile, search entities and tags, add and remove things and vibes with strength, propose rules (pending until approved on the website), recommendations, taste summary, rank a list. When a name is ambiguous the tool refuses to save and returns the choices for the assistant to ask the user. Settings and sites to skip are website-only. Every write appears in the activity feed as "via <assistant>" with undo.

### 5.11 Product grids

Qloo has no `urn:entity:product`, so a product grid cannot be resolved and scored like a restaurant list. Until this section, product cards fell under Jev's `not_a_thing` choice and the page-level "is a list" answer measured 0.45 against a 0.5 cut-off (§8 results, 2026-10-20) — focal looked at a Uniqlo grid and did nothing, silently. Ranking brands instead does not help: a single-brand store resolves every card to the same entity, so every affinity is identical and the lift step's standard-deviation guard correctly declines to rank.

Products are therefore their own page type, scored on **facets** rather than entities.

- **Descriptor.** Every product is described on three axes: `style` (minimal, classic, tailored, workwear, preppy, street, athletic, outdoor, romantic, utility), `palette` (neutral, monochrome, earthy, bright, pastel, dark) and `formality` (loungewear, casual, smart casual, formal). Any axis may be unknown; an unknown axis contributes nothing rather than a guess. Measured: `palette` comes back `unknown` for every product, because titles name a fabric and a cut rather than a colour, so in practice a product is scored on two axes. It is kept because a card that *does* carry colour costs nothing extra to read, and removing the axis would need a migration of stored results.
- **Brand before facets.** A product card that names its maker is turned into a `brand` card by the server (a separate per-card "which snippet names the brand?" question, resolved in `parseJevAnswers`), because Qloo knows brands and their affinities are verified to rank. Only a card that names no brand — the single-brand store — falls through to facet scoring. Leaving this to the model as an instruction was tried and measurably failed (§8).
- **Where the descriptor comes from.** Jev, at rank time, from the product name alone — apparel titles are unusually descriptive ("Pleated Wide Leg Pants"). It is a second call rather than part of identify so that the request carries only the names already going to Qloo, and so the answers stay profile-free and cacheable per page. With no key configured a keyword describer in `@focal-ai/core` reads the same facets off the title, so mock mode still ranks.
- **Where taste comes from.** One `tagAffinities` call per profile returns Qloo's own weighted tag vocabulary for the user's whole cross-domain taste set ("Punk 0.93, Minimalism 0.87"). The Qloo client caches it for 10 minutes, so it is one call per profile, not per page.
- **The join** between a cultural tag vocabulary and a garment is a hand-written synonym table in `packages/core/src/style.ts`. Deliberately not a model's per-page judgement: it is reviewable, unit-tested, free at request time, and it keeps the user's taste out of the identification call (§6).
- **Score.** Each facet matches at most one taste tag — the strongest whose name means the same thing — and contributes that tag's affinity:

  ```
  score(product) = Σ affinity(best matching taste tag) over its three facets
  ```

  Bounded by three times the strongest affinity. Rewards a product that lines up on more than one axis, and cannot be inflated by a wordy title, because each facet contributes exactly once however many synonyms the tag name hits. A product matching nothing scores 0 rather than going unscored, so it still counts toward the page mean: on a grid where some products match and others do not, that difference is the whole signal.
- **Then nothing is special.** The score is never compared across pages; `decideLift` z-scores it within the grid exactly as it does a Qloo affinity, and lift, folds, labels and the plan are the same code every other list uses. When no product matches anything the page is reported `nothing_scored` and left alone, rather than ranked with an empty plan.
- **Rules and dislikes come free.** A matched facet carries the real Qloo tag URN, so a hard rule folds products and a disliked vibe suppresses them through the existing tag machinery, with no product-specific code.
- **Labels** name the facet, not an entity: "Top pick for you · your taste leans minimal and casual". "Leans" because the facet is Qloo's reading of the taste set, not a phrase the user used.
- **Feedback** on a lifted product saves the strongest facet as a vibe on its Qloo tag — the product itself has no entity to save, and the facet is what the label named, so it is what the user is reacting to.

## 6. Privacy and security

- **What leaves the browser:** on a new site layout, the text snippets of list cards (never full pages, form fields or screenshots) go to the focal server and to TypeSafe (Jev). On known layouts, only item names, type and city go to the focal server. Item names go to Qloo.
- **Stored on the server:** account, profile, activity, settings, shared layouts (structure only), the shared resolution cache, and page results for 24 h. No browsing history.
- **Chat text** is processed by the free LLM providers, some of which log prompts; the privacy policy names them.
- **Never:** pages on the never-run list or the user's skip list, pages with password or payment fields, incognito by default, selling data.
- **Agents cannot act quietly:** every write is attributed and undoable; hard rules need approval; MCP cannot change settings.
- **Export and delete** the profile and account at any time.
- **Keys** (Qloo, TypeSafe, LLM providers) are server-only and never reach the extension or the browser.
- **Render plans stay declarative** (reorder, collapse, annotate, emphasize, hide). Selectors exist only in learned layouts used by the extension's own code, never in plans sent from the server.

## 7. External services, limits and costs

| Service | Use | Limits and cost |
|---|---|---|
| Qloo (hackathon key) | search, entities, tags, insights | Free; 5 req/s burst; key deactivated after judging closes, so a commercial key is needed to keep running. Do not store Qloo response data in the public repo |
| TypeSafe Jev | card identification on new layouts | Reported $0.042 per million input tokens, output free (third-party sources; measure with §8). Budget $5 ≈ 12–24k page identifications at 5–10k tokens each |
| Open-weight LLM | website chat | Free tiers: Groq about 1,000 requests and 200k tokens per day per model; Cerebras and OpenRouter as fallbacks (figures from third-party summaries, verify) |
| Hosting, database, auth | website, API, storage, sign-in | Free tiers (Vercel Hobby, hosted Postgres, sign-in service) |

Speed targets: first visit to a page about 2–3 s (Qloo pacing), repeat pages 0.2–0.5 s, render gate 300 ms.

## 8. Open questions and how we settle them

| Unknown | Why it matters | How to settle |
|---|---|---|
| Do tag signals (`signal.interests.tags`) change insights scores, per type? | Whether vibes reach Qloo or stay local boosts | `pnpm probe:unknowns qloo` compares insights with and without a tag signal for place, movie and brand |
| Does Qloo accept per-signal weights, and in what syntax? | Whether love vs like reaches Qloo | Same script tries candidate syntaxes and checks the scores move toward the heavier like. Confirm against Qloo's Parameter Reference |
| How many entity signals does one insights call accept and use? | The signal cap in §5.5 | Same script sends 20, 35 and 50 signals and compares results |
| Jev cost, speed and accuracy on card identification | Budget, render gate, confidence threshold | `pnpm probe:unknowns jev` runs labelled sample pages (and a non-list page) and reports tokens, latency, accuracy by confidence |
| Do the free LLM tiers support tool calling, with which models? | Whether the chat can run free | `pnpm probe:unknowns llm` lists models and sends a tool-calling request to each configured provider |
| Which sign-in service can also be the OAuth server for MCP connectors? | ChatGPT and claude.ai connections | Desk research: MCP requires OAuth 2.1 with resource indicators and client registration (Client ID Metadata Documents or dynamic registration). Candidates to check: WorkOS AuthKit, Clerk, Stytch, Descope, Better Auth, Supabase Auth, Cloudflare's workers-oauth-provider |
| How reliable is automatic list detection on real sites? | Core promise | Prototype the extractor and run it on saved pages from 10 target sites (restaurants, hotels, films, music, books, games, fashion) |
| ~~Does `is_list` clear 0.5 on a product grid?~~ | **Settled 2026-10-28: 0.98.** See results below | `pnpm probe:unknowns jev` |
| ~~How accurately does Jev read the facets from a product name?~~ | **Settled 2026-10-28: style 100%, formality 83%, palette unanswerable.** See results below | `pnpm probe:unknowns jev` |
| ~~Do real taste vocabularies overlap the style synonym table?~~ | **Settled 2026-10-28: 5/20 facet values for a music-heavy profile, none on formality.** See results below | `pnpm probe:unknowns qloo` §4 |
| Does facet reach rise enough on a profile containing brands to justify the palette and formality axes? | Reach is the ceiling on how often product ranking does anything; a bands-only profile scores on style alone | Seed a profile with fashion and homeware brands, rerun `pnpm probe:unknowns qloo` §4, and compare reach against the Fugazi baseline |

### Results (2026-10-20, live keys)

- **Tag signals take effect** for every type tested. place: max |Δaffinity| 0.021, order unchanged. movie: 0.138, order changed. brand: 0.131, order changed. Vibes are now sent as `signal.interests.tags`; local boosts are only a config fallback.
- **Weights:** both JSON syntaxes (`[{"entity","weight"}]`, `[{"entity_id","weight"}]`) are rejected with HTTP 400. Strength only decides which likes make the cut.
- **Signal cap:** going from 20 to 35 to 50 entity signals moves scores by only about 0.002–0.003 each step. The extra signals are used but barely matter, so the cap stays at 20 (latency 0.64 s → 1.29 s).
- **Jev** (`jev-latest`):
  - Speed and cost: 60–90 ms per page, about 540 input tokens per card, so a 30-card page is about 16k tokens or $0.0007.
  - Page-level "is a list": 0.97 / 0.98 on real lists, 0.05 / 0.06 on inbox and news, 0.45 on a product grid (brand ≠ product name). The product-grid result is what §5.11 was written to fix; it predates `product` being a type choice and needs re-measuring (§8).
  - Per-answer accuracy: 96% at confidence ≥ 0.8 and 100% at ≥ 0.9. The threshold stays 0.8; the page-level cut-off is 0.5.
- **Live end-to-end** (Jev identify, then one live insights call): a 9-card SF page identified in 148 ms and ranked in 1.6 s. One item was lifted, labelled "Top pick for you · because you like Rintaro and Fugazi". Places the user already likes come back unscored because Qloo leaves signal entities out of results; whether to lift them anyway is an open product call.
- **Free LLM (Groq):** `openai/gpt-oss-120b` is listed and returns a correct tool call (`search_entities({"query":"Fugazi","type":"artist"})`) in 404 ms. Free-tier limits seen: 1,000 requests and 8,000 tokens per minute. The token limit is tight, so chat context must stay compact (`summarizeProfile`). Cerebras and OpenRouter are untested (no keys).
- **Sign-in and database:** see `docs/auth-and-db.md`.

### Results (2026-10-28, live keys) — product grids (§5.11)

- **`is_list` on a single-brand product grid: 0.98** (expected yes, cut-off 0.5), up from 0.45 when products were `not_a_thing`. All six Uniqlo cards got the right name and type at confidence 0.99–1.0. **The gate §5.11 was written to clear is cleared.**
- **Multi-brand grids regressed, and were fixed.** On the first run every SSENSE card answered `product` and chose the product name over the brand, at 0.76–0.93 confidence — the instruction "if the card names a brand, choose the brand" lost to "choose the product name". Weighing two clauses was the wrong mechanism. There is now a separate per-card question — *which snippet names the brand?* — and `parseJevAnswers` turns a `product` card that names its maker into a `brand` card. All four cards then came back correct at confidence 1.0. This matters because brand affinities are verified to rank (Δ 0.131, order changed) while facets would score a hand wash on garment axes.
- **Facet accuracy from the product name:** style 6/6 (mean confidence 0.99), formality 5/6 (0.91). The single miss is a judgement call, not an error — Jev read a Dry-EX polo as smart casual where the label said casual; the label was left alone rather than tuned to agree.
- **Palette is unanswerable from a title: 6/6 `unknown`.** Product titles name a fabric and a cut, not a colour. The axis costs a question and returns nothing, so in practice a product is scored on *two* facets, not three.
- **Identification accuracy overall** rose to 94.1% at the 0.8-confidence threshold used in §5.3 and 100% at 0.9 (from 90.9% ungated). Cost is now ~862 input tokens per card, a 30-card page ≈ $0.0011.
- **Facet reach is the real ceiling, and it is low.** A music-heavy profile (Fugazi) reaches only **5 of 20** facet values, and adding SF restaurants *reduces* it to 4 — place tags are cuisine words, which the table deliberately refuses to read as style. Every tag Qloo returns is a genre (punk, post-punk, garage rock, shoegaze), and those reach `style:workwear`, `style:street` and `palette:dark` but **nothing on formality**. Combined with palette being unanswerable, such a profile is effectively scored on the style facet alone — one affinity, not a sum. The design still works (one facet gives a spread, and an unreached grid is left alone), but the cross-axis story needs a profile containing brands, not just bands. Widening the synonyms would raise reach and reintroduce exactly the false positives below, so it was not done.
- **Two false positives found offline and removed** before the live run: "Natural Wine" reached `palette:earth` through the synonym "natural" and "Japanese" reached `style:minimal` — both food-and-drink words in Qloo's vocabulary, so the table was reading a taste in wine or ramen as a taste in clothes. "Science Fiction" → `style:utility` went too. Mock reach fell 11 → 9 of 20. A missed link leaves the grid alone; an invented one re-orders a page for a reason that does not exist. `productScore.test.ts` pins the class.

The probe script writes its report to `scripts/probe-output/` (gitignored, since Qloo data must not be stored in the public repo). Keys are read from `.env` or `apps/web/.env.local`: `QLOO_API_KEY`, `TYPESAFE_API_KEY`, and optionally `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`.

## 9. What we reuse

| Existing | Becomes |
|---|---|
| `packages/qloo` (typed client, pacing, cache, error taxonomy) | Server's Qloo client; add tag signals, weights and the shared cache |
| `packages/core` resolver, profile codec, ranker, plan compiler, evidence | Resolver as is; profile v2 (things, vibes, rules, strength); ranker gains the lift-only rule; plan compiler gains rule folds; evidence builds the "because you like" reasons |
| `apps/web` Studio | Website shell; Studio pages become `/try`; Inspector becomes `/why/<id>` |
| `apps/web` agent route | Replaced by the LLM chat agent; the deterministic intent parser is retired |
| `packages/mcp` tools | Hosted HTTP transport, OAuth, write tools |
| `scripts/probe-qloo.ts`, `scripts/smoke-prod.ts` | Kept; joined by `scripts/probe-unknowns.ts` |
| Dockerfile, security headers, CI | Kept |

New: `apps/extension`, database and migrations, auth, the identify endpoint, the chat agent, the activity feed.

## 10. Decision log

| # | Decision |
|---|---|
| 1 | The product is the extension, shipped by the hackathon deadline |
| 2 | Automatic list detection on any site, no per-site adapters |
| 3 | Jev identifies name, type and city per card with confidence; unsure cards are left alone; layouts are learned and reused |
| 4 | Reorder the site's own cards in place |
| 5 | No sponsored detection |
| 6 | The profile is written by the website chat and by outside assistants over MCP |
| 7 | Profile on our server with accounts; the extension caches settings |
| 8 | A profile holds things, vibes and hard rules |
| 9 | Runs everywhere except a built-in never-run list and sites the user skips; never on password or payment pages or in incognito by default |
| 10 | 300 ms render gate, then the site's order with a chip; re-order only before the user interacts, otherwise offer Apply |
| 11 | Lift clear matches above the page average; the rest keep the site's order |
| 12 | Each ranking uses top favourites plus the strongest likes of the page's type plus applicable vibes, in one Qloo call |
| 13 | Agents save when certain, ask when ambiguous, and need approval for hard rules; activity feed with attribution and undo |
| 14 | Learning from chat and explicit taps only; no passive tracking |
| 15 | Chat, profile, feed and settings live on the website; the extension only reorders, labels and has a toolbar menu |
| 16 | Sign-in with Google or an email link through a service that can also serve MCP OAuth |
| 17 | Nothing moves after the user has seen it; a new search or filter is a new page |
| 18 | MCP reads and writes under the chat's rules; settings are website-only |
| 19 | The chat runs on an open-weight model |
| 20 | Free hosted tiers with fallback for now; local models for development |
| 21 | Chromium browsers (Chrome, Edge, Brave, Arc, Opera); Firefox later |
| 22 | Studio pages stay as a no-install playground on the same ranking rules |
| 23 | First run is account first: sign in, chat, sites to skip, install |
| 24 | Labels are page-relative words with the reason first; exact score in "Why this order?" |
| 25 | Dislikes are never lifted; hard rules fold matching items behind "Show" only on Qloo's own tag |
| 26 | This spec lands through a pull request for team review |
| 26 | Vibes go to Qloo as tag signals (verified to move scores); strength is not sent as a weight (rejected) |
| 27 | Jev keeps the 0.8 per-answer threshold and a 0.5 page-level "is a list" cut-off |
