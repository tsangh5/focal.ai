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
      <CardContent className="flex flex-col gap-4">
        {NEVER_RUN_GROUPS.map((group) => (
          <section key={group.category} className="flex flex-col gap-1.5" data-category={group.category}>
            <div className="flex flex-col gap-0.5">
              <h3 className="text-sm font-medium text-ink">{group.label}</h3>
              <p className="text-xs text-muted">{group.description}</p>
            </div>
            {group.sites.length > 0 ? (
              <ul className="flex flex-wrap gap-1">
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
            ) : null}
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
