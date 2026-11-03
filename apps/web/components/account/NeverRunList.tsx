import { ChevronDown } from "lucide-react";
import { NEVER_RUN_GROUPS } from "@focal-ai/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The built-in never-run list, read-only.
 *
 * Rendered from the same table the extension's guard uses, so what a user
 * reads here is what actually runs. It is deliberately not editable: these
 * are the categories focal refuses to touch, as opposed to "sites to skip",
 * which is the user's own list.
 */
export function NeverRunList() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Always skipped</CardTitle>
        <CardDescription>
          focal never runs on these, and it cannot be turned on for them. Nothing from these pages is read or sent
          anywhere. This is in addition to the sites you skip above.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        {/* Collapsed per category: the full list is long, especially on a phone. */}
        {NEVER_RUN_GROUPS.map((group) => {
          const heading = (
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium text-ink">{group.label}</span>
              <span className="text-xs text-muted">{group.description}</span>
            </span>
          );
          if (group.sites.length === 0) {
            return (
              <div key={group.category} className="flex border-b border-line py-2 last:border-0" data-category={group.category}>
                {heading}
              </div>
            );
          }
          return (
            <details key={group.category} className="group border-b border-line last:border-0" data-category={group.category}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 py-2 [&::-webkit-details-marker]:hidden">
                {heading}
                <span className="shrink-0 text-xs text-muted">
                  {group.sites.length}
                  {group.pattern ? "+" : ""} sites
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <ul className="flex flex-wrap gap-1 pb-3">
                {group.sites.map((host) => (
                  <li key={host} className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted">
                    {host}
                  </li>
                ))}
                {group.pattern ? (
                  <li className="rounded border border-dashed border-line px-1.5 py-0.5 text-[11px] text-muted">
                    …and others matched by pattern
                  </li>
                ) : null}
              </ul>
            </details>
          );
        })}
      </CardContent>
    </Card>
  );
}
