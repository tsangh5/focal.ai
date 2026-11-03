import type { Metadata } from "next";
import { NEVER_RUN_GROUPS } from "@focal-ai/core";
import { SiteHeader } from "@/components/site/SiteHeader";

export const metadata: Metadata = {
  title: "Privacy — focal",
  description: "What focal reads, what leaves your browser, who else sees it, and how to get rid of it.",
};

/**
 * The privacy policy, and a Chrome Web Store requirement.
 *
 * Written from what the code does rather than from a template, and the
 * never-run categories are rendered from the same table the extension
 * enforces, so this page cannot drift from the guard.
 */

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

const THIRD_PARTIES = [
  { name: "Qloo", what: "Item names, their type, and a city string. Powers the ranking itself." },
  { name: "TypeSafe (Jev)", what: "Card text snippets, to work out what each card is. Only on a layout focal has not seen before." },
  { name: "Groq", what: "Your chat messages and the names already in your profile, to run the chat assistant." },
  { name: "WorkOS", what: "Your email address, to sign you in." },
  { name: "Neon", what: "Hosts the database everything above is stored in." },
  { name: "Vercel", what: "Hosts this site and its API." },
];

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Privacy</h1>
          <p className="text-sm text-muted">
            focal re-orders lists on sites you already browse. To do that it has to read a little of those pages. This
            page says exactly how much, who else sees it, and how to delete it.
          </p>
        </div>

        <Section id="off-by-default" title="focal is off until you turn it on">
          <p>
            Ranking is per site and opt-in. On a page with a list it could sort, focal offers to turn itself on for
            that site. Until you accept, it reads nothing and sends nothing — the offer is decided entirely in your
            browser, from the shape of the page.
          </p>
          <p>You can turn a site back off from the extension&apos;s toolbar menu or in settings, at any time.</p>
        </Section>

        <Section id="what-leaves" title="What leaves your browser">
          <p>On a site you have enabled, and only when focal finds a list of things:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="text-ink">Short text snippets from the list cards</strong> — at most six per card, 80
              characters each, from at most 60 cards. Enough to tell that a card says &ldquo;Rintaro&rdquo;.
            </li>
            <li>
              <strong className="text-ink">The site&apos;s hostname and a generalised path</strong>, for example
              <code className="px-1">yelp.com</code> and <code className="px-1">/search</code>.
            </li>
            <li>
              <strong className="text-ink">A city string</strong> if the page names one, so a restaurant in the right
              city is not confused with one elsewhere. This is read from the URL, the page heading, and{" "}
              <strong className="text-ink">the contents of a location or search box</strong> — the one place focal
              reads something you may have typed.
            </li>
            <li>
              <strong className="text-ink">Link targets within each card</strong> — hostname and path, up to four per
              card — which help tell two things with the same name apart.
            </li>
          </ul>
          <p>
            Once focal has learned a site&apos;s layout, later visits send only the item names, their type and the city.
            The snippets are not sent again.
          </p>
        </Section>

        <Section id="never" title="What never leaves your browser">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>The page&apos;s HTML, its appearance, or screenshots of it.</li>
            <li>
              Text you type into the page. Inputs, text areas and dropdowns are excluded from card snippets outright.
              The single exception is the location or search box named above, read only to get the city right.
            </li>
            <li>Your browsing history. focal is told about a page only when it ranks one.</li>
            <li>Cookies, local storage, or anything else belonging to the sites you visit.</li>
          </ul>
          <p>
            API keys for Qloo, TypeSafe and the chat models live on focal&apos;s server only. They are never in the
            extension or in any page.
          </p>
        </Section>

        <Section id="never-run" title="Sites focal refuses to run on">
          <p>
            These are built into the extension and cannot be switched on, in addition to any site you choose to skip.
            focal does not read these pages at all.
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {NEVER_RUN_GROUPS.map((g) => (
              <li key={g.category} className="rounded-full border border-line px-2.5 py-0.5 text-xs">
                {g.label}
              </li>
            ))}
          </ul>
          <p>
            focal also stops on any page showing a password or payment field, and stays off in incognito windows unless
            you turn it on there.
          </p>
        </Section>

        <Section id="stored" title="What is stored, and for how long">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="text-ink">Your account</strong> — the email address you signed in with.
            </li>
            <li>
              <strong className="text-ink">Your taste profile and its history</strong> — what you added, when, and
              which surface added it. Kept until you remove it or delete your account.
            </li>
            <li>
              <strong className="text-ink">Your site settings</strong> — which sites focal is on for, skipped, or
              declined.
            </li>
            <li>
              <strong className="text-ink">Page results</strong> — what a given ranking did, so &ldquo;Why this
              order?&rdquo; can explain it. <strong className="text-ink">Deleted after 24 hours.</strong>
            </li>
            <li>
              <strong className="text-ink">Learned layouts and resolved names</strong> — shared between users to save
              repeat work. These hold page structure and public entity names only, never page content and nothing tied
              to you.
            </li>
          </ul>
        </Section>

        <Section id="third-parties" title="Who else sees it">
          <ul className="flex flex-col gap-2">
            {THIRD_PARTIES.map((p) => (
              <li key={p.name} className="rounded-lg border border-line bg-surface px-3 py-2">
                <span className="text-sm font-medium text-ink">{p.name}</span>
                <p className="text-xs text-muted">{p.what}</p>
              </li>
            ))}
          </ul>
          <p>
            Chat messages are processed by a hosted language model, and model providers may retain prompts under their
            own terms. Do not put anything sensitive in the chat.
          </p>
          <p className="text-ink">focal does not sell your data, and does not use it for advertising.</p>
        </Section>

        <Section id="control" title="Getting it back, or getting rid of it">
          <p>
            From <a className="underline" href="/settings">settings</a> you can download everything focal holds about
            you as JSON, or delete your account. Deleting removes your profile, history, settings and page results.
            Shared layouts and resolved names are not tied to you and stay.
          </p>
          <p>
            Removing the extension stops all collection immediately. Your account keeps whatever you saved until you
            delete it.
          </p>
        </Section>

        <Section id="contact" title="Contact">
          <p>
            Questions, or want your data removed by hand? Open an issue at{" "}
            <a className="underline" href="https://github.com/tsangh5/focal.ai">
              github.com/tsangh5/focal.ai
            </a>
            .
          </p>
          <p className="text-xs">
            focal is a hackathon project and not a commercial service. It runs on a Qloo hackathon key and should not
            be relied on for anything important.
          </p>
        </Section>
      </main>
    </>
  );
}
