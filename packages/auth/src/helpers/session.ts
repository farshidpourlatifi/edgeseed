import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AuthEnv } from "../middleware";

/** Get the current session from request headers (returns null if not authenticated) */
export async function getSession(c: Context<AuthEnv>) {
  const auth = c.get("auth");
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session;
}

/**
 * Get the current session or throw 401.
 *
 * `HTTPException` rather than a bare `throw new Response(...)`: Hono's
 * `compose()` only routes `Error` instances to the error handler, so a thrown
 * `Response` escapes as an unhandled failure and the caller sees 500 instead of
 * 401. This also lets `observabilityErrorHandler` classify it as an expected
 * 4xx — logged at warn, never sent to Sentry. Mirrors `requirePrincipal`.
 */
export async function requireSession(c: Context<AuthEnv>) {
  const session = await getSession(c);
  if (!session) {
    throw new HTTPException(401, {
      res: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    });
  }
  return session;
}
