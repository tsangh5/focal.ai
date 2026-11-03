import { z } from "zod";
import { currentViewer } from "@/lib/server/auth/viewer";
import { runChat } from "@/lib/server/chat/agent";
import { ChatProviderError, createProviderChain, providersFromEnv } from "@/lib/server/chat/providers";
import { dbProfileStore, memoryProfileStore, type ChatProfileStore } from "@/lib/server/chat/store";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/errors";
import { getQlooClient } from "@/lib/server/qloo";
import { checkRateLimit } from "@/lib/server/rateLimit";
import { callerKey, checkQuota, quotaExceeded, spendQuota } from "@/lib/server/quota";

/** Per-user daily cap protecting the shared free-tier allowance. */
const DAILY_CAP = { limit: 200, windowMs: 24 * 60 * 60 * 1000 };

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(40),
});

async function chatSession(): Promise<{ userId: string; store: ChatProfileStore } | null> {
  const viewer = await currentViewer();
  if (!viewer) return null;
  const db = getDb();
  const store = viewer.persisted && db ? dbProfileStore(db, viewer.userId) : memoryProfileStore(viewer.userId);
  return { userId: viewer.userId, store };
}

export async function POST(req: Request): Promise<Response> {
  const session = await chatSession();
  if (!session) return Response.json({ error: { code: "UNAUTHORIZED", message: "sign in to focal" } }, { status: 401 });
  const limit = checkRateLimit(`chat:${session.userId}`, DAILY_CAP);
  if (!limit.ok) {
    return Response.json({ error: { code: "RATE_LIMIT", message: "Daily chat limit reached" } }, { status: 429 });
  }
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: { code: "BAD_REQUEST", message: "invalid request body" } }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return errorResponse(parsed.error);
  // A browser-supplied Groq key replaces the project's for this request only.
  const ownKey = callerKey(req, "x-focal-groq-key");
  const providers = ownKey
    ? [{ name: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: ownKey, model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b" }]
    : providersFromEnv();

  const quota = await checkQuota(session.userId, "chat", ownKey !== undefined);
  if (!quota.allowed) return quotaExceeded("chat", quota);

  if (providers.length === 0) {
    return Response.json({ error: { code: "NOT_CONFIGURED", message: "no chat model configured" } }, { status: 503 });
  }
  try {
    const result = await runChat(parsed.data.messages, {
      complete: createProviderChain(providers),
      qloo: getQlooClient(),
      loadProfile: () => session.store.load(),
      commit: (next, event) => session.store.commit(next, event),
    });
    // Charged only once the model actually answered.
    await spendQuota(session.userId, "chat", ownKey !== undefined);
    return Response.json({ reply: result.reply, events: result.events, provider: result.provider });
  } catch (e) {
    if (e instanceof ChatProviderError) {
      return Response.json({ error: { code: "UPSTREAM", message: "the chat model is unavailable, try again shortly" } }, { status: 502 });
    }
    return errorResponse(e);
  }
}
