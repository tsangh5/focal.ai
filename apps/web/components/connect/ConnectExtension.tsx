"use client";

import { useState } from "react";

type ChromeRuntime = {
  sendMessage(extensionId: string, message: unknown, callback: (reply: unknown) => void): void;
  lastError?: { message?: string };
};

function runtime(): ChromeRuntime | undefined {
  return (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
}

type State = { kind: "idle" } | { kind: "working" } | { kind: "done"; email: string } | { kind: "error"; message: string };

/**
 * The id the extension published on this page (content.ts), preferred over the
 * build-time constant: it is what Chrome actually assigned, so it cannot drift
 * from the deployment's configuration the way a hardcoded value can.
 */
export function announcedId(): string {
  const el = globalThis.document?.documentElement;
  return el?.dataset?.focalExtensionId ?? "";
}

/** Issues an extension session and hands it over through externally_connectable. */
export function ConnectExtension({ extensionId }: { extensionId: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function connect() {
    const rt = runtime();
    const id = announcedId() || extensionId;
    // Three distinct failures that used to share one message. Telling someone
    // to install an extension they already have cost real debugging time.
    if (!rt?.sendMessage) {
      setState({
        kind: "error",
        message: "No extension detected on this page. Install focal in a Chromium browser and reload. If it is installed, it was built for a different site — rebuild it with this site as FOCAL_ORIGIN.",
      });
      return;
    }
    if (!id) {
      setState({
        kind: "error",
        message: "The extension is installed but did not announce itself. Reload this page; if that does not help, update the extension — older builds need NEXT_PUBLIC_FOCAL_EXTENSION_ID set on this site.",
      });
      return;
    }
    setState({ kind: "working" });
    const res = await fetch("/api/extension/session", { method: "POST" });
    if (!res.ok) {
      setState({ kind: "error", message: "Could not create a session. Try signing in again." });
      return;
    }
    const { token, email } = (await res.json()) as { token: string; email: string };
    rt.sendMessage(id, { type: "focal:session", token, email }, (reply) => {
      const ok = (reply as { ok?: boolean } | undefined)?.ok === true;
      setState(ok ? { kind: "done", email } : { kind: "error", message: rt.lastError?.message ?? "The extension did not answer." });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={connect}
        disabled={state.kind === "working"}
        className="rounded-md bg-ink px-4 py-2 text-canvas disabled:opacity-50"
      >
        {state.kind === "working" ? "Connecting…" : "Connect extension"}
      </button>
      {state.kind === "done" && <p className="text-sm">Connected as {state.email}. You can close this tab.</p>}
      {state.kind === "error" && <p className="text-sm text-red-700">{state.message}</p>}
    </div>
  );
}
