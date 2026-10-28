import type { BackgroundReply, ContentMessage, ExternalMessage } from "./api";
import { FOCAL_ORIGIN, isTrustedOrigin } from "./config";
import { parseSettings } from "./settings";
import { getSession, getSettings, setSession, setSettings, setTabResult } from "./storage";

/** A hung server must not pin a run (and its chip) forever. */
const FETCH_TIMEOUT_MS = 15_000;

async function call<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<BackgroundReply<T>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "signed_out", status: 401 };
  try {
    const res = await fetch(`${FOCAL_ORIGIN}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // The abort rejects fetch (or the body read) into the catch below.
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 401) await setSession(null);
    if (!res.ok) return { ok: false, error: `http_${res.status}`, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network_error" };
  }
}

const post = <T>(path: string, body: unknown) => call<T>("POST", path, body);

const SETTINGS_REFRESH_MS = 5 * 60 * 1000;
/** When a pull last succeeded. A failed one leaves it, so the next run tries again. */
let settingsFetchedAt = 0;
let settingsPulling = false;

/**
 * Sites to skip and sites switched off live on the server (edited on the
 * website); keep the local copy fresh so eligibility checks never wait on it.
 * Incognito stays a per-browser choice. One pull at a time: identify calls
 * that arrive while one is out don't start another.
 */
async function refreshSettings(force = false): Promise<void> {
  if (!force && (settingsPulling || Date.now() - settingsFetchedAt < SETTINGS_REFRESH_MS)) return;
  settingsPulling = true;
  try {
    const res = await call<{ skipSites: string[]; siteOff: string[] }>("GET", "/api/settings");
    if (!res.ok) return;
    const current = await getSettings();
    await setSettings(parseSettings({ ...res.data, incognito: current.incognito }));
    settingsFetchedAt = Date.now();
  } finally {
    settingsPulling = false;
  }
}

async function pushSettings(): Promise<void> {
  const { skipSites, siteOff } = await getSettings();
  await call("PUT", "/api/settings", { skipSites, siteOff });
}

chrome.runtime.onMessage.addListener((msg: ContentMessage, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  switch (msg.type) {
    case "identify":
      void refreshSettings();
      void post("/api/page/identify", msg.body).then(sendResponse);
      return true;
    case "rank":
      void post("/api/page/rank", msg.body).then(sendResponse);
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
    case "sync-settings":
      void pushSettings().then(() => sendResponse({ ok: true }));
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
        .then(() => sendResponse({ ok: true }));
      return true;
    case "focal:ping":
      sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
      return false;
  }
  sendResponse({ ok: false, error: "bad_message" });
  return false;
});
