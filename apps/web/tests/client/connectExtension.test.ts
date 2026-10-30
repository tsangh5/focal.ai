import { afterEach, describe, expect, it, vi } from "vitest";
import { announcedId } from "@/components/connect/ConnectExtension";

const withDocument = (dataset: Record<string, string> | undefined) =>
  vi.stubGlobal("document", dataset === undefined ? {} : { documentElement: { dataset } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("announcedId", () => {
  it("reads the id the extension published on the page", () => {
    withDocument({ focalExtensionId: "aekphmehgdiggfigdljomnmhgkjlanpj" });
    expect(announcedId()).toBe("aekphmehgdiggfigdljomnmhgkjlanpj");
  });

  it("is empty when no extension announced itself, so the caller can say so", () => {
    withDocument({});
    expect(announcedId()).toBe("");
    withDocument(undefined);
    expect(announcedId()).toBe("");
  });

  // Server-rendered: there is no document at all during SSR.
  it("is empty with no document rather than throwing", () => {
    vi.stubGlobal("document", undefined);
    expect(announcedId()).toBe("");
  });
});
