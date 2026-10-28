import { summarizeProfile, type ActivityEvent, type ProfileV2 } from "@focal-ai/core";
import type { QlooClient } from "@focal-ai/qloo";
import type { ChatMessage, CompleteFn } from "./providers";
import { CHAT_TOOLS, runTool } from "./tools";

export const MAX_TOOL_ROUNDS = 5;
export const MAX_HISTORY = 12;

const INSTRUCTIONS = `You are Iris, focal's taste assistant — named for the iris of an eye, the part that sets the focal point. If asked who you are, say that briefly. Learn what the user likes so focal can reorder lists on websites for them.
Qloo covers ten kinds of thing and you can save any of them: places (restaurants, bars, hotels, shops, museums), films, TV shows, music artists, books, podcasts, video games, brands, travel destinations, and public figures.
Ask short, friendly questions, and vary which kind you ask about rather than always reaching for music and restaurants.
Save things with add_thing (love / like / dislike). If a tool returns choices, ask the user which one they mean; never guess.
Vibes (styles like "natural wine", "minimalist") go through add_vibe. Hard "never" rules go through propose_rule and stay pending until approved on the website.
Keep replies under 60 words. Never invent that something was saved; only report what tools confirmed.`;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentDeps {
  complete: CompleteFn;
  qloo: QlooClient;
  loadProfile(): Promise<ProfileV2>;
  commit(next: ProfileV2, event: ActivityEvent): Promise<void>;
}

export interface AgentResult {
  reply: string;
  events: ActivityEvent[];
  provider?: string;
  toolCalls: { name: string; result: unknown }[];
}

export async function runChat(history: ChatTurn[], deps: AgentDeps): Promise<AgentResult> {
  let profile = await deps.loadProfile();
  const events: ActivityEvent[] = [];
  const toolCalls: AgentResult["toolCalls"] = [];
  const ctx = {
    qloo: deps.qloo,
    events,
    getProfile: () => profile,
    commit: async (next: ProfileV2, event: ActivityEvent) => {
      await deps.commit(next, event);
      profile = next;
    },
  };
  const messages: ChatMessage[] = [
    { role: "system", content: `${INSTRUCTIONS}\n\nCurrent profile:\n${summarizeProfile(profile) || "(empty)"}` },
    ...history.slice(-MAX_HISTORY).map((t) => ({ role: t.role, content: t.content })),
  ];
  let provider: string | undefined;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const tools = round < MAX_TOOL_ROUNDS ? CHAT_TOOLS : [];
    const res = await deps.complete(messages, tools);
    provider = res.provider;
    const calls = res.message.tool_calls ?? [];
    if (calls.length === 0) return { reply: res.message.content?.trim() ?? "", events, provider, toolCalls };
    messages.push({ role: "assistant", content: res.message.content ?? null, tool_calls: calls });
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        // Invalid JSON from the model: the tool reports missing fields.
      }
      const result = await runTool(ctx, call.function.name, args);
      toolCalls.push({ name: call.function.name, result });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return { reply: "", events, provider, toolCalls };
}
