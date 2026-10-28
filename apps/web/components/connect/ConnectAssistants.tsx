"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{value}</code>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}

interface Path {
  name: string;
  steps: string[];
  commands?: { label: string; value: string }[];
}

/** Setup steps for each assistant that can reach focal's hosted MCP server. */
export function ConnectAssistants({ mcpUrl }: { mcpUrl: string }) {
  const paths: Path[] = [
    {
      name: "Claude (claude.ai and Claude Desktop)",
      steps: [
        "Open Settings → Connectors and choose Add custom connector.",
        "Name it focal and paste the server URL above.",
        "Click Connect and sign in to focal when asked.",
      ],
    },
    {
      name: "ChatGPT",
      steps: [
        "Open chatgpt.com/plugins, select +, then Add custom MCP server.",
        "Name it focal, paste the server URL above, choose OAuth, and select Create as a plugin.",
        "Install it, sign in to focal when asked, then type @focal in a chat.",
      ],
    },
    {
      name: "Claude Code",
      steps: ["Run this in a terminal, then type /mcp in Claude Code and pick focal to sign in."],
      commands: [{ label: "Claude Code command", value: `claude mcp add --transport http focal ${mcpUrl}` }],
    },
    {
      name: "Claude Code plugin",
      steps: ["Adds the server plus a skill that tells Claude when to use your taste profile. Run inside Claude Code:"],
      commands: [
        { label: "marketplace command", value: "/plugin marketplace add tsangh5/focal.ai" },
        { label: "install command", value: "/plugin install focal@focal" },
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <CopyField value={mcpUrl} label="server URL" />
      <p className="text-sm text-muted-foreground">
        Assistants can read your profile, save things and vibes, and propose rules. Every change shows in{" "}
        <Link href="/profile" className="underline underline-offset-2">
          your activity
        </Link>{" "}
        as{" "}
        <Badge variant="secondary">via Claude</Badge> or <Badge variant="secondary">via ChatGPT</Badge> and can be undone.
        Rules stay pending until you approve them, and assistants can&apos;t change your settings.
      </p>
      {paths.map((p) => (
        <Card key={p.name} size="sm">
          <CardHeader>
            <CardTitle>{p.name}</CardTitle>
            <CardDescription>
              <ol className="list-decimal space-y-1 pl-4">
                {p.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </CardDescription>
          </CardHeader>
          {p.commands && (
            <CardContent className="flex flex-col gap-2">
              {p.commands.map((c) => (
                <CopyField key={c.value} value={c.value} label={c.label} />
              ))}
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
