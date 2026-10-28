/**
 * Built-in never-run list (§5.1). Not user-configurable. Bump the version when
 * the list changes so cached copies in chrome.storage can be compared.
 */
export const NEVER_RUN_VERSION = 3;

export type NeverRunCategory =
  | "banking"
  | "health"
  | "government"
  | "email"
  | "messaging"
  | "documents"
  | "passwords"
  | "sign-in"
  | "assistant"
  | "developer"
  | "search-engine"
  | "focal";

const SITES: Record<Exclude<NeverRunCategory, "focal">, string[]> = {
  banking: [
    "paypal.com", "stripe.com", "venmo.com", "wise.com", "revolut.com", "monzo.com",
    "chase.com", "bankofamerica.com", "wellsfargo.com", "citi.com", "capitalone.com",
    "americanexpress.com", "discover.com", "usbank.com", "schwab.com", "fidelity.com",
    "vanguard.com", "robinhood.com", "coinbase.com", "klarna.com", "affirm.com",
    "barclays.co.uk", "hsbc.com", "hsbc.co.uk", "lloydsbank.com", "natwest.com",
    "santander.co.uk", "starlingbank.com", "n26.com", "ing.com", "squareup.com",
  ],
  health: [
    "mychart.com", "mychart.org", "nhs.uk", "healthcare.gov", "kp.org",
    "kaiserpermanente.org", "patient.info", "zocdoc.com", "teladoc.com", "onemedical.com",
    "cvs.com", "walgreens.com", "goodrx.com", "23andme.com", "followmyhealth.com",
  ],
  government: ["europa.eu", "service.gov.uk", "irs.gov", "ssa.gov", "canada.ca"],
  email: [
    "mail.google.com", "outlook.live.com", "outlook.office.com", "outlook.office365.com",
    "mail.yahoo.com", "mail.proton.me", "proton.me", "protonmail.com", "fastmail.com",
    "mail.aol.com", "hey.com", "tutanota.com", "zoho.com",
  ],
  messaging: [
    "web.whatsapp.com", "messenger.com", "web.telegram.org", "discord.com", "slack.com",
    "app.slack.com", "teams.microsoft.com", "teams.live.com", "messages.google.com",
    "chat.google.com", "signal.org", "web.skype.com",
  ],
  documents: [
    "docs.google.com", "drive.google.com", "sheets.google.com", "dropbox.com",
    "onedrive.live.com", "sharepoint.com", "box.com", "icloud.com", "notion.so",
    "notion.site", "evernote.com", "office.com", "quip.com", "airtable.com",
  ],
  passwords: [
    "1password.com", "bitwarden.com", "lastpass.com", "dashlane.com",
    "keepersecurity.com", "nordpass.com", "roboform.com",
  ],
  "sign-in": [
    "accounts.google.com", "login.microsoftonline.com", "login.live.com",
    "appleid.apple.com", "id.apple.com", "auth0.com", "okta.com", "onelogin.com",
    "login.gov", "id.me",
  ],
  // Chat transcripts are as sensitive as email or messaging, and a thread of
  // turns looks enough like a card list to trip detection.
  assistant: [
    "claude.ai", "anthropic.com", "chatgpt.com", "chat.openai.com", "openai.com",
    "gemini.google.com", "aistudio.google.com", "copilot.microsoft.com",
    "perplexity.ai", "poe.com", "character.ai", "mistral.ai", "huggingface.co",
  ],
  // Consoles and repos: private code, infra and customer data. focal has
  // nothing useful to rank here and these pages are full of list-shaped rows.
  developer: [
    "github.com", "gitlab.com", "bitbucket.org", "console.cloud.google.com",
    "console.aws.amazon.com", "portal.azure.com", "vercel.com", "netlify.com",
    "heroku.com", "console.neon.tech", "supabase.com", "dashboard.stripe.com",
    "sentry.io", "datadoghq.com", "grafana.com", "jira.com", "atlassian.net",
    "linear.app", "figma.com",
  ],
  // Search engines rank their own results, and re-ordering them is both the
  // one place focal would be fighting the page's whole purpose and the most
  // likely to breach a site's terms. Google's ccTLDs are matched by regex.
  "search-engine": [
    "bing.com", "duckduckgo.com", "search.yahoo.com", "yandex.com", "yandex.ru",
    "baidu.com", "ecosia.org", "startpage.com", "qwant.com", "search.brave.com",
    "kagi.com", "mojeek.com", "searx.be",
  ],
};

/**
 * Every Google property, across all ~190 ccTLDs (`google.com`, `google.co.uk`,
 * `google.de`) and subdomains. Deliberately broad: it also covers Maps and
 * Images, which are list-shaped and would otherwise be ranked.
 */
const GOOGLE_HOST = /(^|\.)google(\.[a-z]{2,3}){1,2}$/;

const GOV_SUFFIX = /(^|\.)(gov|mil)(\.[a-z]{2})?$|(^|\.)gouv\.[a-z]{2}$|(^|\.)gob\.[a-z]{2}$|(^|\.)gc\.ca$|(^|\.)bund\.de$/;
const BANK_LABEL = /(^|[.-])[a-z0-9]*bank(ing)?[a-z0-9]*\./;
const HEALTH_LABEL = /(^|\.)(mychart|patient(portal)?|myhealth)[.-]/;
const SIGNIN_LABEL = /^(login|signin|auth|accounts?|sso|id|secure|passport)\./;
/** Dev servers, LAN hosts and private ranges: local-only pages, never ranked. */
const LOCAL_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$|\.(local|localhost|internal|test|invalid|lan|home\.arpa)$/;
const SIGNIN_PATH =
  /\/(log-?in|sign-?in|sign-?up|register|auth|oauth2?|sso|account|accounts|my-?account|password|reset-password|checkout|payment|billing|wallet)(\/|$|\.|\?)/i;

function suffixMatch(host: string, site: string): boolean {
  return host === site || host.endsWith(`.${site}`);
}

/**
 * Returns the never-run category for a URL, or null when focal may run.
 * `focalHosts` are focal's own site hosts (never ranked).
 */
export function matchNeverRun(url: URL, focalHosts: string[] = []): NeverRunCategory | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (focalHosts.some((f) => suffixMatch(host, f.toLowerCase().replace(/^www\./, "")))) return "focal";
  for (const [category, sites] of Object.entries(SITES) as [NeverRunCategory, string[]][]) {
    if (sites.some((s) => suffixMatch(host, s))) return category;
  }
  // After the category loop, so the more specific Google hosts already listed
  // there keep their own reason (gemini → assistant, mail → email,
  // docs/drive → documents, accounts → sign-in). The rest is search.
  if (GOOGLE_HOST.test(host)) return "search-engine";
  if (LOCAL_HOST.test(host)) return "developer";
  if (GOV_SUFFIX.test(host)) return "government";
  if (BANK_LABEL.test(`${host}.`)) return "banking";
  if (HEALTH_LABEL.test(`${host}.`)) return "health";
  if (SIGNIN_LABEL.test(host) || SIGNIN_PATH.test(url.pathname)) return "sign-in";
  return null;
}
