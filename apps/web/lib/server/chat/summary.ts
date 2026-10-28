import { createProviderChain, providersFromEnv } from "./providers";

/**
 * The prose half of Taste Context: a short read on the person, written only
 * from the Qloo tags behind their profile. The model gets the tag list and the
 * entry names and nothing else, and is told not to add facts — the tags are
 * the evidence, so an invented claim would be ungrounded.
 *
 * Returns null when no chat provider is configured; the page then shows the
 * tags alone rather than failing.
 */
const INSTRUCTIONS = `You describe a person's cultural taste from Qloo data.

You are given: the things they like, and the tags Qloo associates with that combination.

Write 2-3 sentences, second person ("you"), describing the throughline in their taste.
Rules:
- Use ONLY the supplied tags and names. Never invent a genre, place, era or trait.
- Name the cross-domain pattern when the tags span domains (e.g. music and food).
- No preamble, no bullet points, no quotes, no emoji. Plain sentences.
- Do not flatter. Describe, do not compliment.
- If you mention a real person, use they/them unless their pronouns are given.`;

export async function runSummary(names: string[], tags: string[]): Promise<string | null> {
  const providers = providersFromEnv();
  if (providers.length === 0 || tags.length === 0) return null;
  try {
    const complete = createProviderChain(providers);
    const res = await complete(
      [
        { role: "system", content: INSTRUCTIONS },
        {
          role: "user",
          content: `Things they like: ${names.join(", ")}\nQloo tags: ${tags.join(", ")}`,
        },
      ],
      [],
    );
    const text = res.message.content?.trim();
    return text ? text : null;
  } catch {
    return null;
  }
}
