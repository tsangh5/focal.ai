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
    const announced = announcedId();
    const id = announced || extensionId;

    // Chromium exposes chrome.runtime.sendMessage to every page whether or not
    // any extension is installed, so its presence says nothing about focal —
    // only that this browser can talk to extensions at all.
    if (!rt?.sendMessage) {
      setState({
        kind: "error",
        message: "This browser can't talk to extensions. focal needs Chrome, Edge, Brave, Arc or Opera.",
      });
      return;
    }
    // An announcement is the only positive proof focal is here: the content
    // script writes its id onto this page on load. Without one, and with no id
    // configured for this site, there is nothing to talk to.
    if (!id) {
      setState({
        kind: "error",
        message:
          "No focal extension detected on this page. Install it and reload. If it is already installed, it was built for a different site — rebuild it with this site as FOCAL_ORIGIN.",
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
      if (ok) {
        setState({ kind: "done", email });
        return;
      }
      // No answer from a configured id usually means that build is not the one
      // installed; an unanswered announced id means it died mid-handshake.
      const fallback = announced
        ? "The extension did not answer. Reload this page and try again."
        : `No extension answered on id ${id}. The installed build may have a different id — reload this page so it can announce itself.`;
      setState({ kind: "error", message: rt.lastError?.message ?? fallback });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-muted sm:hidden">
        On a phone? The extension runs in desktop Chrome, Edge, Brave, Arc or Opera, so connect it from your computer.
        Your taste, activity and settings work here on any device.
      </p>
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
