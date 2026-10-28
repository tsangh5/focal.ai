<div align="center">

<img src="docs/assets/logo.svg" width="92" alt="focal.ai logo" />

# focal.ai

### The web, rendered for you.

focal.ai rewrites the DOM of any page before it reaches your eyes, so every site you open is already arranged around what you actually like.

[![License: MIT](https://img.shields.io/badge/License-MIT-6E56CF.svg?style=flat-square)](LICENSE)
[![Status: Alpha](https://img.shields.io/badge/status-alpha-orange?style=flat-square)](#roadmap)
[![Powered by Qloo](https://img.shields.io/badge/taste%20graph-Qloo-black?style=flat-square)](https://qloo.com)
[![MCP](https://img.shields.io/badge/MCP-planned-00A3A3?style=flat-square)](https://modelcontextprotocol.io)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](#contributing)

[Quickstart](#quickstart) · [How it works](#how-it-works) · [MCP server](#mcp-server) · [Render policies](#render-policies) · [Privacy](#privacy) · [Roadmap](#roadmap)

</div>

> [!NOTE]
> **focal.ai is pre-release.** The hosted Studio (taste profile plus re-ranked demo pages) is implemented and runnable locally today: mock mode works with zero keys. The browser extension and MCP server are still in development. See [`docs/development.md`](docs/development.md) for run instructions and [`docs/status.md`](docs/status.md) for live status.

---

## The internet was built for the average user. The average user does not exist.

Every page you load is the same page everyone else loads. The restaurant list is sorted by ad spend. The streaming rows are sorted by licensing deals. The product grid is sorted by margin. Your taste never enters the equation, because the page was rendered long before anyone knew who you were.

focal.ai moves personalization out of the server and into the last hundred milliseconds before paint.

The planned extension sits between the network and the screen: it reads the structure of the page, resolves the real world entities inside it against [Qloo's](https://qloo.com) cross domain taste graph, scores every node against your personal taste vector, and then rewrites the DOM. Reorder. Emphasize. Collapse. Annotate. Hide.

Same site. Same data. Your ordering.

```
Yelp, unmodified                      Yelp, through focal.ai
--------------------------------      --------------------------------
1. Olive Garden          (ad)         1. Bar Part Time       97% match
2. Chili's               (ad)            natural wine, tiny room, loud
3. Cheesecake Factory                 2. Rintaro             94% match
4. Bar Part Time                         izakaya, you loved Kissaki
5. Rintaro                            3. Outta Sight Pizza   89% match
...                                   ...
24. Outta Sight Pizza                 [ 2 sponsored results collapsed ]
```

---

## Why this is different

Recommendation engines personalize **their** product. focal.ai personalizes **the whole web**, including every site that will never build a recommender, never know who you are, and never ask.

|                        | Site native personalization | Ad tech profiles  | focal.ai                    |
| ---------------------- | --------------------------- | ----------------- | --------------------------- |
| Works on any site      | No                          | No                | Yes                         |
| Understands taste      | Within one catalog          | Within one funnel | Across 10 cultural domains  |
| Cold start             | Weeks of clicks             | Weeks of clicks   | Seconds, from one seed list |
| Who owns the profile   | The site                    | The broker        | You                         |
| Portable between sites | No                          | No                | Yes                         |
| Readable and editable  | No                          | No                | Yes, it is just JSON        |
| Agent writable         | No                          | No                | Yes, over MCP               |

The taste graph is the moat. Qloo connects affinities across music, film, TV, dining, nightlife, travel, fashion, books, podcasts, and brands, which means telling focal.ai that you love *Paprika*, Fugazi, and natural wine is enough to rank a hotel list in Lisbon you have never visited.

---

## How it works

```
   ┌──────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────────┐
   │  Page    │ --> │   Extract    │ --> │    Resolve    │ --> │    Score     │
   │  loads   │     │  semantic    │     │  entities to  │     │  vs. your    │
   └──────────┘     │  skeleton    │     │  Qloo graph   │     │ taste vector │
                    └──────────────┘     └───────────────┘     └──────┬───────┘
                                                                      │
   ┌──────────┐     ┌──────────────┐     ┌───────────────┐            │
   │  Paint   │ <-- │  Apply DOM   │ <-- │    Render     │ <----------┘
   │          │     │  mutations   │     │    policy     │
   └──────────┘     └──────────────┘     └───────────────┘
```

1. **Extract.** A content script walks the document and builds a semantic skeleton: repeated list structures, cards, headings, prices, images, and the text that identifies a real world thing. No screenshots, no full page uploads.
2. **Resolve.** Candidate entities ("Rintaro", "A24", "Aesop", "Lisbon") are resolved to Qloo entity IDs. Anything that does not resolve is left exactly as it was.
3. **Score.** Each resolved entity is scored against your taste vector through Qloo's affinity API. The result is an affinity, a confidence, and a short human readable reason.
4. **Transform.** A render policy turns scores into DOM operations. Policies are declarative, per site, and fully overridable.
5. **Paint.** Mutations are applied inside a render gate so the user never sees a flash of unpersonalized content.

Everything above the Qloo call runs locally. Pages you have blocklisted never leave the browser at all.

---

## Quickstart

### Run the Studio locally

```bash
git clone https://github.com/tsangh5/focal.ai.git
cd focal.ai
pnpm install
QLOO_MOCK=1 pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and seed "Rintaro" or "Fugazi", then press **Focus** and switch between Original / Focal / Diff. Mock mode needs zero keys.

**Go live:** get a Qloo hackathon key, put `QLOO_API_KEY` in `apps/web/.env.local`, drop `QLOO_MOCK`, then run `pnpm probe` to verify the live contract.

### Add your keys

```bash
cp apps/web/.env.example apps/web/.env.local
```

```env
QLOO_API_KEY=your_qloo_key
FOCAL_MODEL_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_anthropic_key
```

Grab a Qloo key from the [Qloo developer portal](https://docs.qloo.com). The model key is optional and currently unused: LLM-powered features are planned, and without a key focal.ai runs in its deterministic degraded mode by design.

### Seed your taste graph

Open the Studio and search for anything Qloo knows: a movie, an artist, a restaurant, a brand. Free-text paste of a whole list (a Letterboxd export, a Spotify top artists list, or a sentence) is planned:

```
I like A24 movies, Japanese city pop, natural wine bars,
brutalist architecture, and I will not eat at a chain.
```

That is the cold start solved. The more you seed, the sharper the graph gets.

---

## MCP server

The website hosts a [Model Context Protocol](https://modelcontextprotocol.io) server at `/mcp`, signed in with OAuth (WorkOS AuthKit), so the assistants you already talk to can read and write your taste graph. Tell ChatGPT about a restaurant you loved last night, and the next product grid you open is already resorted.

Connect from the site's `/connect` page — step-by-step for ChatGPT, claude.ai, Claude Desktop and Claude Code.

### Tools exposed

| Tool             | What it does                                                              |
| ---------------- | ------------------------------------------------------------------------- |
| `read_profile`   | Reads the taste profile: loved/liked/disliked things, vibes, rules        |
| `taste_summary`  | Counts and a one-line summary                                             |
| `search_entities`| Resolves free text to Qloo entities                                       |
| `add_thing`      | Saves a thing; ambiguous names return choices, never a guess              |
| `add_vibe`       | Saves a vibe (a style or quality)                                         |
| `propose_rule`   | Proposes a hard rule, pending until approved on `/profile`                |
| `remove_entry`   | Removes an entry by name; undoable on `/profile`                          |
| `recommend`      | Recommendations from the profile, excluding saved and disliked things     |
| `rank_list`      | Ranks a shared list the way the extension does — lifts, labels, folds      |

Every write is attributed (`via chatgpt`, `via claude`), logged and undoable on the `/profile` page. `rank_list` and `recommend` render in-chat cards where the host supports MCP Apps (e.g. ChatGPT).

### Local stdio server

For development there's also a local stdio variant (`pnpm --filter @focal-ai/mcp start`) — read-only, no account needed; see `packages/mcp/README.md`.

---

## Render policies

Policies are the contract between a score and a DOM mutation. They are plain YAML, they live in `policies/`, and you can write them in English and let focal.ai compile them.

```yaml
name: listings
match: ["yelp.com/search*", "opentable.com/s*", "resy.com/cities/*"]

operations:
  - reorder:
      container: "[data-testid='results-list']"
      by: affinity
      floor: 0.35

  - collapse:
      when: "is_sponsored or affinity < 0.2"
      label: "{n} low match results hidden"

  - annotate:
      template: "{affinity_pct} match · {reason}"
      placement: after_title

  - emphasize:
      when: "affinity > 0.85"
      style: focal.highlight
```

Policies are versioned, shareable, and sandboxed. A policy can reorder, hide, collapse, annotate, and restyle. It cannot exfiltrate page content, touch other origins, or run arbitrary script.

Ship a good one for a site everyone uses and open a PR. The policy library is the part of this project that compounds.

---

## Architecture

```
focal.ai/
├── apps/
│   ├── extension/        MV3 extension: content scripts, render gate, UI
│   └── web/              Dashboard for your taste graph and policies
├── packages/
│   ├── mcp/              MCP server (@focal-ai/mcp), stdio and HTTP
│   ├── core/             Extraction, scoring, mutation planner
│   ├── qloo/             Typed Qloo Taste AI client with caching
│   └── policy/           Policy parser, compiler, and sandbox
├── policies/             Community render policies
└── docs/
```

### Performance budget

The render path is the product. If focal.ai is slow, focal.ai is broken. Current targets:

| Stage                       | Budget         |
| --------------------------- | -------------- |
| Extraction                  | 8 ms           |
| Resolution (warm cache)     | 12 ms          |
| Scoring                     | 10 ms          |
| Mutation plan and apply     | 10 ms          |
| **Added time to paint**     | **under 40 ms**|

Entity resolutions are cached locally and shared across sites, so the second time you see Rintaro anywhere on the internet it costs nothing.

---

## Privacy

This product only works if you trust it with your taste, so the defaults are built for that.

- **The graph is yours.** Stored locally by default. Export the whole thing as JSON, or delete it, at any time.
- **Pages are not uploaded.** Only extracted entity strings are sent for resolution, never page HTML, never screenshots, never form fields.
- **Nothing on sensitive origins.** Banking, health, government, and auth pages are hard blocked and not configurable.
- **No ad tech, ever.** Your taste graph is not a product. There is no data sale in the business model and there will not be one.
- **Agents are audited.** Every MCP write is attributed, timestamped, and reversible.
- **Inspectable by design.** Press `⌥F` on any page to see exactly which nodes were moved and why.

---

## Roadmap

- [ ] DOM extraction and mutation engine (in progress)
- [ ] Qloo entity resolution and affinity scoring (in progress)
- [ ] MCP server over stdio (in progress)
- [ ] Chrome Web Store release
- [ ] Hosted MCP endpoint with OAuth for ChatGPT and other remote clients
- [ ] Natural language policy compiler in the extension UI
- [ ] Policy library with one click install
- [ ] Firefox and Safari builds
- [ ] Multi profile support (work, home, travel)
- [ ] Local only mode with on device scoring
- [ ] Mobile via browser extension support in iOS Safari

Have an opinion about the order? Open an issue.

---

## Contributing

focal.ai is early and the surface area is wide. Good first contributions:

- **Render policies** for sites you use daily. This is the highest leverage thing you can do.
- **Extraction adapters** for frameworks and layouts the generic walker handles poorly.
- **MCP tools** that make the taste graph more useful to agents.

```bash
pnpm install
pnpm dev          # Studio (apps/web) with hot reload
pnpm test
pnpm lint
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

---

## FAQ

<details>
<summary><b>Is this just an ad blocker?</b></summary>
<br>
No. An ad blocker removes. focal.ai reorders, and it ranks the content a site was always going to show you by how much you are likely to care about it. Hiding sponsored results is one policy operation out of five.
</details>

<details>
<summary><b>Does it break sites?</b></summary>
<br>
Mutations are confined to layout and ordering inside containers a policy names explicitly. Event handlers and React state are preserved. If a policy misbehaves, press <code>⌥F</code> and hit revert, and the page returns to its original DOM.
</details>

<details>
<summary><b>What if I disagree with a ranking?</b></summary>
<br>
Dismiss it. That is a signal. You can also open the taste graph and edit any affinity by hand, which is something no recommender has ever let you do.
</details>

<details>
<summary><b>Why Qloo instead of building our own graph?</b></summary>
<br>
Cross domain taste correlation is a data problem, not a modeling problem, and Qloo already spent a decade on it. Building a worse version of it would have been the slowest possible path to a working product.
</details>

<details>
<summary><b>Can I use my own model?</b></summary>
<br>
Yes. Set <code>FOCAL_MODEL_PROVIDER</code> to any supported provider, or point it at a local endpoint. Extraction and reason generation are the only model dependent steps.
</details>

---

## License

[MIT](LICENSE)

<div align="center">
<br>
<b>Stop reading the average internet.</b>
<br><br>
<sub>Built with <a href="https://qloo.com">Qloo Taste AI</a> and the <a href="https://modelcontextprotocol.io">Model Context Protocol</a>.</sub>
</div>
