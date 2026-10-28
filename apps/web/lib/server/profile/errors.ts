import { ProfileError } from "@focal-ai/core";
import { DbError } from "@focal-ai/db";

const STATUS: Record<ProfileError["code"], number> = { NOT_FOUND: 404, INVALID: 400, NOT_UNDOABLE: 409 };

/** HTTP mapping for profile write failures; undefined for anything else. */
export function profileErrorResponse(e: unknown): Response | undefined {
  if (e instanceof ProfileError) {
    return Response.json({ error: { code: e.code, message: e.message } }, { status: STATUS[e.code] });
  }
  if (e instanceof DbError && e.code === "CONFLICT") {
    return Response.json(
      { error: { code: "CONFLICT", message: "Your profile changed in the meantime. Reload and try again." } },
      { status: 409 },
    );
  }
  return undefined;
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

export function badRequest(message = "invalid request body"): Response {
  return Response.json({ error: { code: "BAD_REQUEST", message } }, { status: 400 });
}
