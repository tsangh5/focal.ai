import type { BackgroundReply, ContentMessage, ExternalMessage } from "./api";
import { FOCAL_ORIGIN, isTrustedOrigin } from "./config";
import { applyPendingSites, enableSite, parseSettings, type Settings } from "./settings";
import { getPendingSites, getSession, getSettings, setPendingSites, setSession, setSettings, setTabOutcome, setTabResult, type PendingSites } from "./storage";

/** A hung server must not pin a run (and its chip) forever. */
const FETCH_TIMEOUT_MS = 15_000;
/** A first rank of a new list resolves every name with Qloo, which can take well over 15 s. */
const RANK_TIMEOUT_MS = 45_000;

async function call<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown, timeoutMs = FETCH_TIMEOUT_MS): Promise<BackgroundReply<T>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "signed_out", status: 401 };
  try {
    const res = await fetch(`${FOCAL_ORIGIN}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // The abort rejects fetch (or the body read) into the catch below.
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401) await setSession(null);
    if (!res.ok) return { ok: false, error: `http_${res.status}`, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network_error" };
  }
}

const post = <T>(path: string, body: unknown, timeoutMs?: number) => call<T>("POST", path, body, timeoutMs);

const SETTINGS_REFRESH_MS = 5 * 60 * 1000;
/** When a pull last succeeded. A failed one leaves it, so the next run tries again. */
let settingsFetchedAt = 0;
let settingsPulling = false;

/**
 * The per-site lists live on the server (edited on the website); keep the
 * local copy fresh so eligibility checks never wait on it. Incognito stays a
 * per-browser choice. One pull at a time: identify calls that arrive while one
 * is out don't start another.
 */
async function refreshSettings(force = false): Promise<void> {
  if (!force && (settingsPulling || Date.now() - settingsFetchedAt < SETTINGS_REFRESH_MS)) return;
  settingsPulling = true;
  try {
    const decisionsBefore = siteDecisions;
    const res = await call<{ siteOn: string[]; skipSites: string[]; siteOff: string[] }>("GET", "/api/settings");
    // A decision made while the pull was out may already be stored and no
    // longer pending, yet missing from this answer; the next pull will see it.
    if (!res.ok || siteDecisions !== decisionsBefore) return;
    const current = await getSettings();
    const pending = await getPendingSites();
    const merged = applyPendingSites(parseSettings({ ...res.data, incognito: current.incognito }), pending);
    await setSettings(merged);
    settingsFetchedAt = Date.now();
    if (Object.keys(pending).length > 0) await pushSettings(merged, pending);
  } finally {
    settingsPulling = false;
  }
}

/**
 * Mirrors the site lists to the account. Once stored, the `pushed` decisions
 * stop being pending, unless the user changed them again meanwhile.
 */
async function pushSettings(settings: Settings, pushed: PendingSites = {}): Promise<boolean> {
  const { siteOn, skipSites, siteOff } = settings;
  const res = await call("PUT", "/api/settings", { siteOn, skipSites, siteOff });
  if (!res.ok) return false;
  const pending = await getPendingSites();
  for (const [host, on] of Object.entries(pushed)) if (pending[host] === on) delete pending[host];
  await setPendingSites(pending);
  return true;
}

/** Site decisions made so far, so a pull can tell one happened while it was out. */
let siteDecisions = 0;

/** Saves a site decision here first, then on the account; it stays pending until stored there. */
async function decideSite(host: string, on: boolean): Promise<void> {
  siteDecisions++;
  const settings = enableSite(await getSettings(), host, on);
  await setSettings(settings);
  const key = settings[on ? "siteOn" : "siteOff"].at(-1)!;
  await setPendingSites({ ...(await getPendingSites()), [key]: on });
  await pushSettings(settings, { [key]: on });
}

chrome.runtime.onMessage.addListener((msg: ContentMessage, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  switch (msg.type) {
    case "identify":
      void refreshSettings();
      void post("/api/page/identify", msg.body).then(sendResponse);
      return true;
    case "rank":
      void post("/api/page/rank", msg.body, RANK_TIMEOUT_MS).then(sendResponse);
      return true;
    case "feedback":
      void post("/api/feedback", msg.body).then(sendResponse);
      return true;
    case "page-result":
      if (tabId !== undefined) void setTabResult(tabId, { pageResultId: msg.pageResultId, lifted: msg.lifted });
      return false;
    case "open-why":
      void chrome.tabs.create({ url: `${FOCAL_ORIGIN}/why/${encodeURIComponent(msg.pageResultId)}` });
      return false;
    case "enable-site": {
      // Persist first, then mirror to the account so the website's settings
      // page agrees. The caller re-runs (or reloads) once this resolves.
      void decideSite(msg.host, msg.on)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false, error: "save_failed" }));
      return true;
    }
    case "page-outcome":
      if (tabId !== undefined) void setTabOutcome(tabId, msg.outcome);
      return false;
    case "sync-settings":
      void getSettings()
        .then((settings) => pushSettings(settings))
        .then(() => sendResponse({ ok: true }));
      return true;
    default:
      return false;
  }
});

chrome.runtime.onMessageExternal.addListener((msg: ExternalMessage, sender, sendResponse) => {
  if (!isTrustedOrigin(sender.origin)) {
    sendResponse({ ok: false, error: "forbidden_origin" });
    return false;
  }
  switch (msg?.type) {
    case "focal:session":
      if (typeof msg.token !== "string" || !msg.token) break;
      void setSession({ token: msg.token, email: msg.email, savedAt: new Date().toISOString() })
        .then(() => refreshSettings(true))
        .then(() => sendResponse({ ok: true }));
      return true;
    case "focal:signout":
      void setSession(null).then(() => sendResponse({ ok: true }));
      return true;
    case "focal:settings":
      void getSettings()
        .then((current) => {
          const raw = msg.settings && typeof msg.settings === "object" ? (msg.settings as Record<string, unknown>) : {};
          // The website doesn't manage incognito; keep this browser's choice unless it is sent.
          return setSettings(parseSettings({ incognito: current.incognito, ...raw }));
        })
        // Saved on the website, so the account now holds the user's latest word.
        .then(() => setPendingSites({}))
        .then(() => sendResponse({ ok: true }));
      return true;
    case "focal:ping":
      sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
      return false;
  }
  sendResponse({ ok: false, error: "bad_message" });
  return false;
});
