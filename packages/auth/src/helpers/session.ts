import type { Context } from "hono";
import type { AuthEnv } from "../middleware";

/** Get the current session from request headers (returns null if not authenticated) */
export async function getSession(c: Context<AuthEnv>) {
  const auth = c.get("auth");
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session;
}

/** Get the current session or throw 401 */
export async function requireSession(c: Context<AuthEnv>) {
  const session = await getSession(c);
  if (!session) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return session;
}
