"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CircleCheck, Sparkles } from "lucide-react";
import type { ActivityEvent } from "@focal-ai/core";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlaceholdersAndVanishInput } from "@/components/ui/placeholders-and-vanish-input";
import { describeEvent } from "@/lib/client/chatEvents";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
  events?: ActivityEvent[];
}

const PLACEHOLDERS = [
  "I love Fugazi and Radiohead",
  "I like Rintaro in San Francisco",
  "I'm into natural wine bars",
  "Never show me chain restaurants",
];

const SUGGESTIONS = ["I love Fugazi", "I like Rintaro in San Francisco", "What do you know about my taste?"];

/** The API keeps the last 40 turns; older ones drop off the request, not the screen. */
const MAX_TURNS = 40;

function errorCopy(status: number): string {
  switch (status) {
    case 401:
      return "Your session ended. Sign in again to keep chatting.";
    case 429:
      return "You've hit today's chat limit. It resets in 24 hours.";
    case 503:
      return "Chat isn't configured on this server yet.";
    case 502:
      return "The chat model is busy right now. Try again in a moment.";
    default:
      return "Something went wrong. Try again.";
  }
}

export function ChatPanel({ email }: { email: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim().slice(0, 2000);
    if (!content || busy) return;
    const history: Message[] = [...messages, { role: "user", content }];
    setMessages(history);
    setDraft("");
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history.slice(-MAX_TURNS).map(({ role, content: c }) => ({ role, content: c })),
        }),
      });
      if (!res.ok) {
        setError(errorCopy(res.status));
        return;
      }
      const data = (await res.json()) as { reply: string; events: ActivityEvent[] };
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply, events: data.events }]);
    } catch {
      setError(errorCopy(0));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex min-h-[70vh] flex-col gap-4" aria-label="Chat with focal">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Tell focal what you like</h1>
        <p className="text-sm text-muted">
          Name artists, places, books or shows. focal only saves exact matches and asks when it isn&apos;t sure. Signed in as{" "}
          {email}.
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-3 rounded-xl border border-line bg-surface p-4" role="log" aria-live="polite">
        {messages.length === 0 && !busy ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
            <Sparkles className="size-6 text-accent" />
            <p className="text-sm text-muted">Start with a few things you love.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="outline" size="sm" onClick={() => send(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className={cn("flex flex-col gap-1.5", m.role === "user" ? "items-end" : "items-start")}
            >
              <div
                data-role={m.role}
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                  m.role === "user" ? "bg-accent text-white" : "bg-surface-2 text-ink",
                )}
              >
                {m.content}
              </div>
              {m.events && m.events.length > 0 ? (
                <div className="flex max-w-[85%] flex-wrap gap-1.5">
                  {m.events.map((e) => (
                    <Badge key={e.id} variant="secondary" className="gap-1">
                      <CircleCheck className="size-3 text-positive" />
                      {describeEvent(e)}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </motion.div>
          ))}
        </AnimatePresence>

        {busy ? (
          <div className="flex items-center gap-1 self-start rounded-2xl bg-surface-2 px-3.5 py-3" aria-label="focal is typing">
            {[0, 1, 2].map((d) => (
              <span
                key={d}
                className="size-1.5 animate-bounce rounded-full bg-muted"
                style={{ animationDelay: `${d * 120}ms` }}
              />
            ))}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {error}
            {error.startsWith("Your session ended") ? (
              <>
                {" "}
                <a className="underline" href="/sign-in?returnTo=%2Fchat">
                  Sign in
                </a>
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <PlaceholdersAndVanishInput
        placeholders={PLACEHOLDERS}
        onChange={(e) => setDraft(e.target.value)}
        onSubmit={() => void send(draft)}
        label="Tell focal what you like"
        submitLabel="Send message"
      />
    </section>
  );
}
