import { z } from "zod";
import { anyCaller, signInRequired } from "@/lib/server/auth/caller";
import { badRequest, readJson } from "@/lib/server/profile/errors";
import { loadSites, MAX_SITES, saveSites } from "@/lib/server/settings/store";

const putSchema = z
  .object({
    skipSites: z.array(z.string().max(300)).max(MAX_SITES).optional(),
    siteOff: z.array(z.string().max(300)).max(MAX_SITES).optional(),
  })
  .strict();

/** Sites to skip and sites switched off; read and written by the website and the extension. */
export async function GET(req: Request): Promise<Response> {
  const caller = await anyCaller(req);
  if (!caller) return signInRequired();
  return Response.json(await loadSites(caller.userId, caller.persisted), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request): Promise<Response> {
  const caller = await anyCaller(req);
  if (!caller) return signInRequired();
  const parsed = putSchema.safeParse(await readJson(req));
  if (!parsed.success) return badRequest();
  return Response.json(await saveSites(caller.userId, caller.persisted, parsed.data));
}
