import { FOCAL_HOSTS, FOCAL_ORIGIN } from "../config";
import { checkEligibility } from "../guards/eligibility";
import { isSiteEnabled, normalizeHost, toggleSite } from "../settings";
import { getSession, getSettings, getTabResult, setSettings } from "../storage";
import { OUTCOME_TEXT, REASON_TEXT } from "./reasons";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function main(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const session = await getSession();
  const settings = await getSettings();
  $("dashboard").setAttribute("href", `${FOCAL_ORIGIN}/chat`);

  $("account").textContent = session ? `Signed in${session.email ? ` as ${session.email}` : ""}` : "Not signed in";
  if (!session) {
    const link = document.createElement("a");
    link.href = `${FOCAL_ORIGIN}/sign-in?from=extension`;
    link.target = "_blank";
    link.textContent = "Sign in";
    $("account").append(" · ", link);
  }

  const url = tab?.url ?? "";
  const host = url ? normalizeHost(url) : "";
  const toggle = $<HTMLInputElement>("site-toggle");
  $("site-label").textContent = host ? `Enable focal for ${host}` : "This site";
  // Ignore the declined list here: the toggle is how a declined site gets
  // turned back on, so it must stay usable.
  const check = checkEligibility({ url, settings: { ...settings, siteOff: [] }, incognito: !!tab?.incognito, focalHosts: FOCAL_HOSTS });
  if (!check.eligible) {
    toggle.disabled = true;
    toggle.checked = false;
    $("site-status").textContent = REASON_TEXT[check.reason.kind];
  } else {
    toggle.checked = isSiteEnabled(settings, host);
    $("site-status").textContent = toggle.checked ? "" : "focal is off here until you turn it on.";
    toggle.addEventListener("change", async () => {
      await setSettings(toggleSite(await getSettings(), host, toggle.checked));
      // Keep the account's copy in step so the website's settings page shows it.
      if (session) void chrome.runtime.sendMessage({ type: "sync-settings" }).catch(() => {});
      if (tab?.id !== undefined) await chrome.tabs.reload(tab.id);
    });
  }

  const result = tab?.id !== undefined ? await getTabResult(tab.id) : null;
  const why = $<HTMLButtonElement>("why");
  // "Why this order?" needs a stored ranking; an outcome alone has nothing to open.
  if (result?.pageResultId) {
    why.disabled = false;
    const id = result.pageResultId;
    why.addEventListener("click", () => {
      void chrome.tabs.create({ url: `${FOCAL_ORIGIN}/why/${encodeURIComponent(id)}` });
    });
  }

  // On an enabled site that was left alone, say why. Silence here reads as a
  // broken extension rather than a decision focal made on purpose.
  if (toggle.checked && result?.outcome) {
    const text =
      result.outcome === "lifted"
        ? `focal lifted ${result.lifted} ${result.lifted === 1 ? "match" : "matches"} on this page.`
        : OUTCOME_TEXT[result.outcome];
    if (text) $("site-status").textContent = text;
  }
}

void main();
