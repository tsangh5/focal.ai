import type { BackgroundReply, ContentMessage, FeedbackResponse, IdentifyResponse, PageOutcome, RankResponse } from "./api";
import { pathPattern } from "./api";
import { applyPlan, FOCAL_ATTR, focalTrusted, type ApplyHandle, type ApplyOptions, type ApplyTarget } from "./apply/apply";
import { createFirstRunGate, createRerunGate, type RenderGate } from "./apply/gate";
import { blockAnchor, decorate } from "./apply/ui";
import { FOCAL_HOSTS, isTrustedOrigin } from "./config";
import { cityHints, detectList, extractSnippets, snapshotCards, type DetectedList } from "./detect/detect";
import { checkEligibility } from "./guards/eligibility";
import { applyLayout } from "./layouts/apply";
import { deleteLayout, getLayout, layoutKey, saveLayout } from "./layouts/store";
import { isSiteEnabled } from "./settings";
import { getSettings } from "./storage";
import type { RenderOp, RenderPlan } from "./types";

function send<T>(msg: ContentMessage): Promise<BackgroundReply<T>> {
  return chrome.runtime.sendMessage(msg);
}

/** Fire-and-forget messages: a dead extension context must never break the page script. */
function notify(msg: ContentMessage): void {
  try {
    void Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => {});
  } catch {
    // The extension was reloaded or removed; there is no one to tell.
  }
}

/** Tell the popup why this page ended as it did. Best effort, like notify(). */
function report(outcome: PageOutcome): void {
  notify({ type: "page-outcome", outcome });
}

/** A plan on the page: its handle, the plan, and the cards (by id) it was applied to. */
interface Live {
  handle: ApplyHandle;
  plan: RenderPlan;
  container: Element;
  cards: Map<string, Element>;
}

/** What planEffectOnScreen needs to know about the plan already on the page. */
export interface AppliedPlan {
  active: boolean;
  plan: RenderPlan;
  container: Element;
  cards: Map<string, Element>;
}

let current: Live | null = null;
/** The newest gate, and the only one: cancelled before another is created and at every stand-down. */
let activeGate: RenderGate | null = null;
let watcher: MutationObserver | null = null;
let rerunTimer: ReturnType<typeof setTimeout> | undefined;
let firstScheduledAt = 0;
const runTimes: number[] = [];
/** Single flight: a run requested while one is in progress folds into one more pass. */
let running = false;
let rerunQueued = false;
/** Bumped by every stand-down; a pass that sees it change drops what it was doing. */
let epoch = 0;
/** Set once this page's first gate exists: every later run is a rerun, even if the first failed (§5.7). */
let hasGated = false;
/** The list as last seen, in order, with its first snippets, to tell a real change from our own writes. */
let lastList: { container: Element; cards: Element[]; fp: string } | null = null;
let last: { key: string; hints: string[] } | null = null;
let rejected = new WeakMap<Element, number>();
/** The container whose strip Undo the user clicked: it stays as the site made it until the URL changes. */
let userUndidFor: Element | null = null;
/** A failed identify or rank is tried again, a bounded number of times per list. */
let retryBudget = new Map<Element, { count: number; timer: ReturnType<typeof setTimeout> | undefined }>();

// Card ids stay with the element, so a card keeps its id when more load in.
const cardIds = new WeakMap<Element, string>();
let nextCardId = 0;

const RERUN_DELAY_MS = 1000;
const RERUN_MAX_WAIT_MS = 3000;
const MAX_RUNS_PER_MINUTE = 6;
const MAX_RETRIES = 3;
const RETRY_MS = 60_000;

function idFor(el: Element): string {
  let id = cardIds.get(el);
  if (!id) {
    id = `c${nextCardId++}`;
    cardIds.set(el, id);
  }
  return id;
}

function withStableIds(list: DetectedList): DetectedList {
  return { ...list, cards: new Map([...list.cards.values()].map((el) => [idFor(el), el])) };
}

/** First snippet of every card, in order: the same nodes recycled with new contents read differently. */
function fingerprint(cards: Element[]): string {
  return cards.map((el) => extractSnippets(el)[0] ?? "").join("\n");
}

function baseline(list: ApplyTarget): void {
  const cards = [...list.cards.values()];
  lastList = { container: list.container, cards, fp: fingerprint(cards) };
}

/** Re-baseline on what the page shows now, so our own writes never look like the site's changes. */
function rebaseline(list: DetectedList | null = detectList(document)): void {
  if (!list) return;
  baseline(list);
  watch(list.container, list.cards.values());
}

function drainRecords(): void {
  watcher?.takeRecords();
}

/** Same container, and every card from the last run is still there: more items loaded in. */
function isTopUp(list: DetectedList): boolean {
  if (!lastList || list.container !== lastList.container) return false;
  const now = new Set(list.cards.values());
  return now.size > lastList.cards.length && lastList.cards.every((el) => now.has(el));
}

/** Same container, same cards in the same order, same contents: nothing to rank again. */
function sameList(list: DetectedList): boolean {
  if (!lastList || list.container !== lastList.container) return false;
  const now = [...list.cards.values()];
  const then = lastList.cards;
  return now.length === then.length && now.every((el, i) => el === then[i]) && fingerprint(now) === lastList.fp;
}

function scheduleRerun(): void {
  const now = Date.now();
  if (rerunTimer === undefined) firstScheduledAt = now;
  else if (now - firstScheduledAt > RERUN_MAX_WAIT_MS) return;
  clearTimeout(rerunTimer);
  rerunTimer = setTimeout(() => {
    rerunTimer = undefined;
    const at = Date.now();
    while (runTimes.length > 0 && at - runTimes[0]! > 60_000) runTimes.shift();
    if (runTimes.length >= MAX_RUNS_PER_MINUTE) return scheduleRerun();
    const list = detectList(document);
    if (!list) {
      // The list went away: nothing of ours outlives it.
      standDown();
      lastList = null;
      return watchPage();
    }
    if (sameList(list) || rejected.get(list.container) === list.cards.size) return;
    if (userUndidFor === list.container) return rebaseline(list);
    // No undo here: seen items stay put until a newer plan is applied.
    void run();
  }, RERUN_DELAY_MS);
}

/** Nodes focal put on the page, and anything inside them. */
function inFocal(n: Node): boolean {
  const el = n.nodeType === 1 ? (n as Element) : n.parentElement;
  return !!el?.closest("[data-focal]");
}

function watch(container: Element, cards: Iterable<Element>): void {
  const known = new Set(cards);
  const inKnown = (n: Node) => [...known].some((k) => k.contains(n));
  watcher?.disconnect();
  watcher = new MutationObserver((records) => {
    let fresh = false;
    const appended: Element[] = [];
    for (const r of records) {
      if (inFocal(r.target)) continue;
      for (const n of r.removedNodes) {
        // A known card leaving (a site re-sort takes it out and puts it back) is a change; so is a card's text going.
        if (n.nodeType === 1 ? !inFocal(n) && [...known].some((k) => k === n || n.contains(k)) : n.nodeType === 3 && inKnown(r.target)) fresh = true;
      }
      for (const n of r.addedNodes) {
        if (n.nodeType === 3) {
          if (inKnown(r.target)) fresh = true;
        } else if (n.nodeType === 1 && !inFocal(n)) {
          fresh = true;
          if (r.target === container && !known.has(n as Element)) appended.push(n as Element);
        }
      }
    }
    // Keep freshly appended cards after the lifted ones right away; labels follow on the top-up.
    if (appended.length > 0 && current?.handle.active) current.handle.extend([], new Map(appended.map((el) => [idFor(el), el])));
    if (fresh || !container.isConnected) scheduleRerun();
  });
  watcher.observe(container, { childList: true, subtree: true });
  if (container.parentElement) watcher.observe(container.parentElement, { childList: true });
}

let offer: HTMLElement | null = null;

/**
 * "Enable focal for example.com" — shown above a list focal could rank on a
 * site the user has not enabled. Nothing has been read or sent at this point
 * and nothing will be unless they accept.
 */
function showOffer(container: Element): void {
  if (offer?.isConnected) return;
  const doc = container.ownerDocument;
  const host = location.hostname.replace(/^www\./, "");
  const el = decorate(doc.createElement("div"), "offer");
  el.setAttribute(FOCAL_ATTR, "offer");
  el.setAttribute("role", "status");

  const text = doc.createElement("span");
  text.setAttribute(FOCAL_ATTR, "offer-text");
  text.textContent = `Sort this list by your taste? focal is off for ${host}.`;

  const enable = doc.createElement("button");
  enable.type = "button";
  enable.setAttribute(FOCAL_ATTR, "enable");
  enable.textContent = `Enable for ${host}`;
  enable.addEventListener("click", (ev) => {
    if (!focalTrusted(ev, el)) return;
    void send({ type: "enable-site", host, on: true }).then(() => {
      el.remove();
      offer = null;
      void run();
    });
  });

  const dismiss = doc.createElement("button");
  dismiss.type = "button";
  dismiss.setAttribute(FOCAL_ATTR, "dismiss");
  dismiss.textContent = "Not now";
  dismiss.addEventListener("click", (ev) => {
    if (!focalTrusted(ev, el)) return;
    void send({ type: "enable-site", host, on: false }).then(() => {
      el.remove();
      offer = null;
    });
  });

  el.append(text, enable, dismiss);
  blockAnchor(container).before(el);
  offer = el;
}

function watchPage(): void {
  watcher?.disconnect();
  watcher = new MutationObserver((records) => {
    if (records.some((r) => [...r.addedNodes].some((n) => n.nodeType === 1 && !(n as Element).hasAttribute("data-focal")))) scheduleRerun();
  });
  watcher.observe(document.body, { childList: true, subtree: true });
}

/**
 * The one teardown: retire the gate and its chip, undo the plan on the page,
 * and clear the tab's stored result if a plan was live (or `clearResult`).
 */
function standDown(clearResult = false): void {
  epoch++;
  activeGate?.cancel();
  activeGate = null;
  // A pending offer belongs to the list that just went away.
  offer?.remove();
  offer = null;
  const live = current;
  current = null; // first: undo() writes to the DOM
  live?.handle.undo();
  drainRecords();
  if (live || clearResult) notify({ type: "page-result", pageResultId: null, lifted: 0 });
}

function reject(list: DetectedList): void {
  rejected.set(list.container, list.cards.size);
  dropRetry(list.container);
  standDown();
  watchPage();
}

function dropRetry(container: Element): void {
  const entry = retryBudget.get(container);
  if (entry) clearTimeout(entry.timer);
  retryBudget.delete(container);
}

/** A failed identify or rank gets up to MAX_RETRIES more tries per container, RETRY_MS apart. */
function scheduleRetry(container: Element): void {
  const entry = retryBudget.get(container) ?? { count: 0, timer: undefined };
  if (entry.count >= MAX_RETRIES) return dropRetry(container);
  entry.count += 1;
  clearTimeout(entry.timer); // a second failure while one is queued never books two runs
  entry.timer = setTimeout(() => {
    if (!container.isConnected) return dropRetry(container);
    void run();
  }, RETRY_MS);
  retryBudget.set(container, entry);
}

function clearRetries(): void {
  for (const entry of retryBudget.values()) clearTimeout(entry.timer);
  retryBudget = new Map();
}

/**
 * The part of a fresh plan that touches only newly loaded cards: their labels,
 * highlights and folds. Reorders are dropped, so nothing already seen moves.
 */
function topUpOps(plan: RenderPlan, fresh: Set<string>): RenderOp[] {
  const ops: RenderOp[] = [];
  for (const op of plan.ops) {
    if (op.op === "annotate" || op.op === "emphasize") {
      if (fresh.has(op.clientId)) ops.push(op);
    } else if (op.op === "collapse" || op.op === "hide") {
      const clientIds = op.clientIds.filter((id) => fresh.has(id));
      if (clientIds.length > 0) ops.push({ ...op, clientIds, ...(op.op === "collapse" ? { label: op.label.replace(/^\d+/, String(clientIds.length)) } : {}) });
    }
  }
  return ops;
}

/**
 * A rank on a stored layout that resolved nothing means the layout names the
 * wrong snippets. A lookup-budget skip, or a profile with no signals, never got
 * that far; an older server that doesn't report the count can't tell us.
 */
function shouldInvalidateLayout(res: RankResponse): boolean {
  return res.resolvedCount === 0 && !res.resolutionLimited && res.status !== "no_signals";
}

const liftedCount = (plan: RenderPlan) => plan.summary.lifted ?? plan.summary.moved ?? 0;

function liftedIds(plan: RenderPlan): string[] {
  const reorder = plan.ops.find((o): o is Extract<RenderOp, { op: "reorder" }> => o.op === "reorder");
  return (reorder?.order ?? []).slice(0, liftedCount(plan));
}

function onScreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

/**
 * Whether applying `plan` would change something the user can see now (§5.7).
 * Additive: the first `lifted` cards in DOM order (the slots a lift fills), the
 * new plan's lifted cards, the applied plan's lifted cards when it is on this
 * same container, and every card a collapse or hide would fold away.
 */
export function planEffectOnScreen(list: ApplyTarget, plan: RenderPlan, applied?: AppliedPlan | null): boolean {
  const pick = (ids: string[], cards: Map<string, Element>) => ids.flatMap((id) => cards.get(id) ?? []);
  const els = [...[...list.cards.values()].slice(0, liftedCount(plan)), ...pick(liftedIds(plan), list.cards)];
  if (applied?.active && applied.container === list.container) els.push(...pick(liftedIds(applied.plan), applied.cards));
  for (const op of plan.ops) {
    if (op.op === "collapse" || op.op === "hide") els.push(...pick(op.clientIds, list.cards));
  }
  return els.some(onScreen);
}

/** guards → list detection → identify → rank → apply (§4.1), one pass at a time. */
async function run(): Promise<void> {
  if (running) {
    rerunQueued = true; // the newer DOM state folds into one more pass
    return;
  }
  running = true;
  try {
    do {
      rerunQueued = false;
      await runPass();
    } while (rerunQueued);
  } finally {
    running = false;
  }
}

async function runPass(): Promise<void> {
  runTimes.push(Date.now());
  // A newer pass retires the previous gate and any chip it offered.
  activeGate?.cancel();
  activeGate = null;
  const started = epoch;
  const stale = () => epoch !== started;
  let gate: RenderGate | null = null;
  let container: Element | null = null;
  try {
    const settings = await getSettings();
    if (stale()) return;
    const eligibility = checkEligibility({
      url: location.href,
      settings,
      incognito: chrome.extension.inIncognitoContext,
      focalHosts: FOCAL_HOSTS,
      document,
    });
    if (!eligibility.eligible) {
      standDown();
      lastList = null;
      return;
    }

    const detected = detectList(document);
    if (!detected) {
      standDown();
      lastList = null;
      if (isSiteEnabled(settings, location.hostname)) report("no-list");
      return watchPage();
    }

    // Ranking is opt-in per site. Detection is a local DOM scan, so we can
    // tell the page has a list worth ranking and offer to turn focal on here
    // without reading or sending anything. Identify only runs once accepted.
    if (!isSiteEnabled(settings, location.hostname)) {
      standDown();
      lastList = null;
      showOffer(detected.container);
      return;
    }

    const list = withStableIds(detected);
    // The user put this list back: keep watching it, never rank it again on this page.
    if (userUndidFor === list.container) return rebaseline(list);
    container = list.container;
    const topUp = isTopUp(list);
    const seen = new Set(topUp ? lastList!.cards : []);
    baseline(list);
    watch(list.container, list.cards.values());

    const cards = snapshotCards(list);
    // Apps can change the URL (and its search box) before swapping the list; cards keep the context they came with.
    const key = cards.map((c) => c.snippets[0] ?? "").sort().join("\n");
    const hints = topUp && last ? last.hints : last?.key === key ? last.hints : cityHints(document);
    last = { key, hints };

    // Top-ups only label what loaded in, so they need no gate.
    if (!topUp) {
      gate = hasGated ? createRerunGate(list.container as HTMLElement) : createFirstRunGate(list.container as HTMLElement);
      activeGate = gate;
      hasGated = true;
    }
    const host = location.hostname.replace(/^www\./, "");
    const pattern = pathPattern(location.pathname);
    const layoutId = layoutKey(host, pattern, list.signature);

    // A known layout names the cards here: no identify call, and no snippets leave the page.
    const layout = await getLayout(layoutId);
    const local = layout && applyLayout(layout, cards, hints);
    const identified: BackgroundReply<IdentifyResponse> = local
      ? { ok: true, data: local }
      : await send<IdentifyResponse>({
          type: "identify",
          body: { host, pathPattern: pattern, signature: list.signature, cityHints: hints, cards },
        });
    if (stale()) return gate?.cancel();
    if (!identified.ok) {
      gate?.cancel();
      report(identified.error === "signed_out" ? "signed-out" : "error");
      // Signed out: stand down until a session appears; anything else may pass.
      return identified.error === "signed_out" ? reject(list) : scheduleRetry(list.container);
    }
    if (!identified.data.isList || !identified.data.pageType || identified.data.items.length === 0) {
      gate?.cancel();
      dropRetry(list.container);
      report("not-a-list");
      if (!topUp) reject(list);
      return;
    }
    if (identified.data.layout) void saveLayout(layoutId, identified.data.layout);

    const ranked = await send<RankResponse>({
      type: "rank",
      body: { host, pathPattern: pattern, pageType: identified.data.pageType, items: identified.data.items },
    });
    if (local && ranked.ok && shouldInvalidateLayout(ranked.data)) void deleteLayout(layoutId);
    if (stale()) return gate?.cancel();
    if (!ranked.ok) {
      gate?.cancel();
      report(ranked.error === "signed_out" ? "signed-out" : "error");
      return ranked.error === "signed_out" ? reject(list) : scheduleRetry(list.container);
    }
    dropRetry(list.container); // identified and ranked: the failure episode is over
    if (!ranked.data.plan) {
      gate?.cancel();
      report(ranked.data.status === "no_signals" ? "no-signals" : "nothing-to-lift");
      // Nothing to lift in the list as it is now: the old arrangement goes too.
      if (!topUp) standDown();
      return;
    }
    const { plan, pageResultId } = ranked.data;
    const options: ApplyOptions = {
      onUserUndo: () => {
        userUndidFor = list.container;
        standDown();
        rebaseline();
      },
      ...(pageResultId && {
        onWhy: () => notify({ type: "open-why", pageResultId }),
        onFeedback: async (clientId, verdict) => {
          const reply = await send<FeedbackResponse>({ type: "feedback", body: { pageResultId, clientId, verdict } });
          return reply.ok && reply.data.saved;
        },
      }),
    };

    if (topUp) {
      const fresh = new Map([...list.cards].filter(([, el]) => !seen.has(el)));
      const ops = topUpOps(plan, new Set(fresh.keys()));
      if (current?.handle.active) current.handle.extend(ops, fresh);
      else if (ops.length > 0) current = { handle: applyPlan(list, { ...plan, ops }, options), plan: { ...plan, ops }, container: list.container, cards: list.cards };
      drainRecords();
      rebaseline();
      if (pageResultId && current) notify({ type: "page-result", pageResultId, lifted: current.handle.lifted });
      report(current && current.handle.lifted > 0 ? "lifted" : "nothing-to-lift");
      return;
    }

    const own = gate!;
    const apply = () => {
      if (stale() || activeGate !== own || userUndidFor === list.container) return;
      // The previous plan goes only now, as the new one lands.
      const previous = current;
      current = null;
      previous?.handle.undo();
      current = { handle: applyPlan(list, plan, options), plan, container: list.container, cards: list.cards };
      // Our own moves must not read as a site change; re-baseline once the gate has revealed the list.
      drainRecords();
      queueMicrotask(() => rebaseline());
      if (pageResultId) notify({ type: "page-result", pageResultId, lifted: current.handle.lifted });
      report(current.handle.lifted > 0 ? "lifted" : "nothing-to-lift");
    };
    const applied = current && { ...current, active: current.handle.active };
    own.ready(apply, planEffectOnScreen(list, plan, applied));
  } catch {
    // Only this pass's own gate: a newer gate is never touched, and no chip is left behind.
    gate?.cancel();
    if (activeGate === gate) activeGate = null;
    if (container && !stale()) scheduleRetry(container);
  }
}

let lastHref = location.href;
setInterval(() => {
  if (location.href === lastHref) return;
  lastHref = location.href;
  // A new URL is a new page: nothing from the old one carries over, not even its "Why this order?".
  standDown(true);
  lastList = null;
  last = null;
  userUndidFor = null;
  hasGated = false;
  runTimes.length = 0;
  clearTimeout(rerunTimer);
  rerunTimer = undefined;
  firstScheduledAt = 0;
  clearRetries();
  rejected = new WeakMap();
  scheduleRerun();
}, 1000);

/**
 * Publish the extension id on focal's own site, so `/connect` can message us
 * without being configured with it.
 *
 * `externally_connectable` requires the *page* to name the extension it wants
 * to talk to, which made the handoff depend on a build-time constant on the
 * website matching the id Chrome assigned the extension. For an unpacked build
 * that id comes from the install path, so it differs per machine; for a store
 * build it is fixed but still has to be copied into the deployment by hand. A
 * mismatch is indistinguishable from "no extension installed" from the page's
 * side, which is the wrong thing to tell someone.
 *
 * Announcing it inverts the dependency: the extension knows its own id, and
 * the page learns it from the DOM. Only on origins already trusted for the
 * handoff — `isTrustedOrigin` is exact-match — so no other site can read it.
 */
if (typeof chrome !== "undefined" && chrome.runtime?.id && isTrustedOrigin(location.origin)) {
  document.documentElement.dataset.focalExtensionId = chrome.runtime.id;
}

// Signing in resumes a tab that stood down while signed out.
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !("session" in changes)) return;
    const next = changes.session?.newValue as { token?: unknown } | undefined;
    if (!next || typeof next.token !== "string") return;
    rejected = new WeakMap();
    lastList = null;
    scheduleRerun();
  });
}

void run();
