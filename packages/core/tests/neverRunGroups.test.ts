import { describe, expect, it } from "vitest";
import { matchNeverRun } from "../src/neverRun";
import { NEVER_RUN_GROUPS } from "../src/neverRunGroups";

describe("never-run settings rows", () => {
  it("covers every category exactly once", () => {
    const categories = NEVER_RUN_GROUPS.map((g) => g.category);
    expect(new Set(categories).size).toBe(categories.length);
    expect(categories).toContain("focal");
  });

  it("every host shown is the category the guard actually returns", () => {
    // Without this, a host can sit under one heading on the settings page
    // while an earlier category claims it (stripe.com catching
    // dashboard.stripe.com, for example) and the page quietly lies.
    for (const group of NEVER_RUN_GROUPS) {
      for (const host of group.sites) {
        expect(matchNeverRun(new URL(`https://${host}/`)), `${host} under ${group.category}`).toBe(group.category);
      }
    }
  });

  it("gives every category a label and description", () => {
    for (const group of NEVER_RUN_GROUPS) {
      expect(group.label.length, group.category).toBeGreaterThan(0);
      expect(group.description.length, group.category).toBeGreaterThan(0);
    }
  });
});
