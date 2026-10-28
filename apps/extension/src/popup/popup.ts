import { FOCAL_HOSTS, FOCAL_ORIGIN } from "../config";
import { checkEligibility } from "../guards/eligibility";
import { normalizeHost, toggleSite } from "../settings";
import { getSession, getSettings, getTabResult, setSettings } from "../storage";
import { REASON_TEXT } from "./reasons";

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
  $("site-label").textContent = host ? `On for ${host}` : "This site";
  const check = checkEligibility({ url, settings: { ...settings, siteOff: [] }, incognito: !!tab?.incognito, focalHosts: FOCAL_HOSTS });
  if (!check.eligible) {
    toggle.disabled = true;
    toggle.checked = false;
    $("site-status").textContent = REASON_TEXT[check.reason.kind];
  } else {
    toggle.checked = !settings.siteOff.includes(host);
    toggle.addEventListener("change", async () => {
      await setSettings(toggleSite(await getSettings(), host, toggle.checked));
      // Keep the account's copy in step so the website's settings page shows it.
      if (session) void chrome.runtime.sendMessage({ type: "sync-settings" }).catch(() => {});
      if (tab?.id !== undefined) await chrome.tabs.reload(tab.id);
    });
  }

  const result = tab?.id !== undefined ? await getTabResult(tab.id) : null;
  const why = $<HTMLButtonElement>("why");
  if (result) {
    why.disabled = false;
    why.addEventListener("click", () => {
      void chrome.tabs.create({ url: `${FOCAL_ORIGIN}/why/${encodeURIComponent(result.pageResultId)}` });
    });
  }
}

void main();
