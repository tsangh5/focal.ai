import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { WhyItem, WhyView as View } from "@/lib/why";

const STATUS_COPY: Record<string, string> = {
  ranked: "Clear matches were lifted to the top. Everything else kept the site's order.",
  no_signals: "Nothing in your profile applies to this kind of page, so the order was left as is.",
  nothing_scored: "Qloo couldn't score any items on this page, so nothing moved.",
};

const OUTCOME: Record<WhyItem["outcome"], { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  lifted: { label: "Lifted", variant: "default" },
  kept: { label: "Site order", variant: "outline" },
  folded: { label: "Folded", variant: "secondary" },
  disliked: { label: "You dislike this", variant: "destructive" },
  unscored: { label: "Not scored", variant: "outline" },
  skipped: { label: "Skipped", variant: "outline" },
};

function outcomeLabel(item: WhyItem): string {
  if (item.outcome === "kept" && item.moved < 0) return "Below your picks";
  return OUTCOME[item.outcome].label;
}

function Movement({ moved }: { moved: number }) {
  if (moved > 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-positive">
        <ArrowUp className="size-3" />
        {moved}
      </span>
    );
  if (moved < 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-muted">
        <ArrowDown className="size-3" />
        {-moved}
      </span>
    );
  return <Minus className="size-3 text-muted" aria-label="no change" />;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-line bg-surface-2 px-3 py-2">
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <span className="text-lg font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}

export function WhyView({ view }: { view: View }) {
  const likes = [...view.signals.entities, ...view.signals.tags, ...view.signals.localBoosts];
  // Products are scored from style facets rather than resolved entities (§5.11),
  // so "not recognised by Qloo" would be the wrong thing to say about them.
  const isProduct = view.pageType === "product";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Why this order?</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{view.hostname}</h1>
        <p className="text-sm text-muted">
          {view.status === "ranked" && view.counts.lifted === 0
            ? "Nothing stood out clearly enough to move, so the site's order was kept."
            : (STATUS_COPY[view.status] ?? `Status: ${view.status}`)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Items" value={view.items.length} />
        <Stat label="Lifted" value={view.counts.lifted} />
        <Stat label="Scored by Qloo" value={view.stats.scored} />
        <Stat label="Not recognised" value={view.counts.unresolved} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your likes behind this</CardTitle>
          <CardDescription>What focal sent to Qloo from your profile. Nothing else from the page or your profile was used.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {likes.length === 0 ? (
            <p className="text-sm text-muted">None of your likes apply here.</p>
          ) : (
            likes.map((s) => (
              <Badge key={s.id} variant={s.strength === "love" ? "default" : "secondary"}>
                {s.name} · {s.strength}
              </Badge>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items, in the order you saw them</CardTitle>
          <CardDescription>Affinity is Qloo&apos;s exact score for you; only clear standouts on this page are lifted.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="w-16">Was</TableHead>
                <TableHead className="w-16">Moved</TableHead>
                <TableHead className="w-24 text-right">Affinity</TableHead>
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.items.map((item) => (
                <TableRow key={item.clientId} data-outcome={item.outcome}>
                  <TableCell className="tabular-nums text-muted">{item.finalPosition}</TableCell>
                  <TableCell className="max-w-[320px] whitespace-normal">
                    <div className="font-medium text-ink">{item.name}</div>
                    {item.entityName && item.entityName !== item.name ? (
                      <div className="text-xs text-muted">Matched to {item.entityName}</div>
                    ) : null}
                    {item.disambiguation ? <div className="text-xs text-muted">{item.disambiguation}</div> : null}
                    {item.status !== "resolved" && item.status !== "skipped" ? (
                      <div className="text-xs text-muted">
                        {isProduct
                          ? "No facet matched your taste"
                          : item.status === "ambiguous"
                            ? "Ambiguous match"
                            : "Not recognised by Qloo"}
                      </div>
                    ) : null}
                    {/* A product's score has no entity behind it, so the facet sum is the explanation. */}
                    {item.facets.length > 0 ? (
                      <div className="mt-1 text-xs text-muted">
                        {item.facets.map((f) => `${f.valueName} (${f.tagName} ${f.affinity.toFixed(2)})`).join(" + ")}
                      </div>
                    ) : null}
                    {item.label ? <div className="mt-1 text-xs text-ink/90">{item.label.text}</div> : null}
                    {item.foldedBy.length > 0 ? (
                      <div className="mt-1 text-xs text-muted">Folded by your rule: never {item.foldedBy.join(", ")}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted">{item.originalPosition}</TableCell>
                  <TableCell className="tabular-nums">
                    <Movement moved={item.moved} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {item.affinity === undefined ? <span className="text-muted">—</span> : item.affinity.toFixed(3)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={OUTCOME[item.outcome].variant}>{outcomeLabel(item)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {view.qlooRequest ? (
        <details className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink">What was sent to Qloo</summary>
          <p className="mt-2 text-xs text-muted">
            One request to <code className="font-mono">{view.qlooRequest.path}</code>
            {view.durationMs !== undefined ? ` · ranked in ${(view.durationMs / 1000).toFixed(1)} s` : ""}
          </p>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-xs">
            {Object.entries(view.qlooRequest.params).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="break-all text-ink/90">{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      <p className="text-xs text-muted">
        This explanation is private to you and expires {new Date(view.expiresAt).toUTCString()}.
      </p>
    </div>
  );
}
