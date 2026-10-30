import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, "dist");
/**
 * Website and API origin, baked in at build time. Defaults to the deployed
 * site, not localhost: this value decides where the popup's links go *and*
 * where every API call goes, so a default of localhost meant `pnpm build` —
 * and `pnpm zip`, which produces the Chrome Web Store artifact — silently
 * shipped an extension that talks to a dev server.
 *
 * For local development, set it explicitly:
 *   FOCAL_ORIGIN=http://localhost:3000 pnpm build
 */
const DEFAULT_ORIGIN = "https://focal-ai.vercel.app";
const origin = (process.env.FOCAL_ORIGIN ?? DEFAULT_ORIGIN).replace(/\/$/, "");
/** Shipped sites, always trusted for the /connect handoff regardless of build origin. */
const PUBLIC_ORIGINS = ["https://focal-ai.vercel.app/*", "https://focal.ai/*"];
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "popup"), { recursive: true });

const common = {
  bundle: true,
  target: "chrome120",
  define: { __FOCAL_ORIGIN__: JSON.stringify(origin) },
  logLevel: "info",
  minify: process.env.NODE_ENV === "production",
};

await build({ ...common, entryPoints: [join(root, "src/background.ts")], outfile: join(out, "background.js"), format: "esm" });
await build({ ...common, entryPoints: [join(root, "src/content.ts")], outfile: join(out, "content.js"), format: "iife" });
await build({ ...common, entryPoints: [join(root, "src/popup/popup.ts")], outfile: join(out, "popup/popup.js"), format: "esm" });
copyFileSync(join(root, "src/popup/popup.html"), join(out, "popup/popup.html"));

/**
 * Pins the extension id to `aekphmehgdiggfigdljomnmhgkjlanpj`.
 *
 * Without this, Chrome derives an unpacked extension's id from its absolute
 * install path, so it differs per worktree, per machine and per checkout —
 * and `/connect` has to be told which id to talk to. That mismatch is not
 * diagnosable from the page: it looks exactly like "no extension installed".
 *
 * This is a public key; it is not a secret, and it only fixes the id. The
 * matching private key (`crx-key.pem`, gitignored) is needed only to
 * self-host a signed `.crx` under the same id.
 */
const PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvAUeTFWW3CrxI03ze0t3ZARFqgz/in+tmoP88L1VNtDKOaN0tEtmD0Ied004kzWyv/xMYzTSDDsRsMBjrHs0euky89I3LkXKaW4/0NQDc0mXMo4F70sGQyusUzfOJSjcGV4slzzyk6MuYXP60pT2YHi2JwQrgaIRnKErMAeZk90EUABj7/L/VRgIqvfrvq/Vmo9ZZDOmhyOOSGfg1fvLEJRd+jb2PU+1NSEu0H2v9pc7KvlOR9rsu7RBlhACjeD32Dgdx70mqVjuf4zz4eqNoEHh6B4DS5djCTQgJvYTrV9mm6PDLTWwoq/VCt6LC+xW4g4GBFNMfDlPT8kezVW/TQIDAQAB";

const manifest = {
  manifest_version: 3,
  key: PUBLIC_KEY,
  name: "focal",
  description: "Lifts the items that match your taste to the top of any list.",
  version: pkg.version,
  minimum_chrome_version: "120",
  permissions: ["storage", "tabs"],
  host_permissions: ["<all_urls>"],
  background: { service_worker: "background.js", type: "module" },
  content_scripts: [{ matches: ["http://*/*", "https://*/*"], js: ["content.js"], run_at: "document_idle" }],
  action: { default_title: "focal", default_popup: "popup/popup.html" },
  // The build origin plus the deployed sites. A local build would otherwise
  // trust only localhost, so /connect on the real site could never hand the
  // extension a session. background.ts still checks sender.origin per message.
  externally_connectable: { matches: [...new Set([`${origin}/*`, ...PUBLIC_ORIGINS])] },
  incognito: "spanning",
};
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

if (process.argv.includes("--zip")) {
  const zip = join(root, `focal-extension-${pkg.version}.zip`);
  rmSync(zip, { force: true });
  execFileSync("zip", ["-qr", zip, "."], { cwd: out, stdio: "inherit" });
  console.log(`wrote ${zip}`);
}
