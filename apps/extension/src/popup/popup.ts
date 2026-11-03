import { FOCAL_HOSTS, FOCAL_ORIGIN } from "../config";
import { checkEligibility } from "../guards/eligibility";
import { isSiteEnabled, normalizeHost } from "../settings";
import { getOwnKeys, getSession, getSettings, getTabResult, setOwnKeys } from "../storage";
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
      // The worker saves it here and on the account, and keeps it pending until
      // the account has it, so signing in later can't undo it.
      await chrome.runtime.sendMessage({ type: "enable-site", host, on: toggle.checked }).catch(() => {});
      if (tab?.id !== undefined) await chrome.tabs.reload(tab.id);
    });
  }

  // Own-key panel. The key lives in this browser's extension storage and is
  // attached to identify requests; focal never stores it.
  const keyInput = $<HTMLInputElement>("own-key");
  const keyStatus = $("own-key-status");
  const saved = await getOwnKeys();
  if (saved.jev) {
    keyInput.value = saved.jev;
    keyStatus.textContent = "Using your key. Ranking does not count against the free allowance.";
    $("own-key-summary").textContent = "Your Jev key is in use";
  }
  $<HTMLButtonElement>("own-key-save").addEventListener("click", async () => {
    const next = keyInput.value.trim();
    await setOwnKeys(next ? { jev: next } : {});
    keyStatus.textContent = next ? "Saved in this browser." : "Cleared. Back to the shared key.";
  });

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
