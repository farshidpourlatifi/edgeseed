import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import { apiToken, type Database } from "@starter/db";
import type { Auth } from "../server";
import { extractBearerToken, hashApiToken, isApiTokenFormat, isApiTokenUsable } from "./api-token";

/** Who is making this request, and how they proved it. */
export interface ApiPrincipal {
  userId: string;
  organizationId: string | null;
  via: "session" | "token";
  /** Present only for `via: "token"`. */
  tokenId?: string;
}

export interface PrincipalEnv {
  Variables: {
    db: Database;
    auth: Auth;
    principal: ApiPrincipal | null;
  };
}

/**
 * Resolve the caller into a principal, from either a bearer token or a session.
 *
 * Deliberately does NOT reject anonymous requests — public routes (`/health`)
 * live on the same mount. Guard protected routes with `requirePrincipal`.
 *
 * A *present but invalid* bearer token is rejected outright rather than falling
 * through to session auth: silently downgrading a bad credential hides
 * revoked-token bugs and lets a stale CI token look like it still works.
 */
export const principalMiddleware = createMiddleware<PrincipalEnv>(async (c, next) => {
  const bearer = extractBearerToken(c.req.header("authorization"));

  if (bearer !== null) {
    const principal = await principalFromToken(c.get("db"), bearer);
    if (!principal) return c.json({ error: "Invalid API token" }, 401);

    c.set("principal", principal);
    touchLastUsed(c, principal.tokenId);
    await next();
    return;
  }

  c.set("principal", await principalFromSession(c));
  await next();
});

async function principalFromToken(db: Database, bearer: string): Promise<ApiPrincipal | null> {
  // Shape check first so a malformed header never costs a database round trip.
  if (!isApiTokenFormat(bearer)) return null;

  const tokenHash = await hashApiToken(bearer);
  const [record] = await db
    .select()
    .from(apiToken)
    .where(eq(apiToken.tokenHash, tokenHash))
    .limit(1);

  if (!record || !isApiTokenUsable(record)) return null;

  return {
    userId: record.userId,
    organizationId: record.organizationId ?? null,
    via: "token",
    tokenId: record.id,
  };
}

async function principalFromSession(c: Context<PrincipalEnv>): Promise<ApiPrincipal | null> {
  const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
  if (!session) return null;

  return {
    userId: session.user.id,
    organizationId: session.session.activeOrganizationId ?? null,
    via: "session",
  };
}

/**
 * Record token usage without making the caller wait on the write.
 * Best-effort: `lastUsedAt` is an operator convenience, not an audit guarantee.
 */
function touchLastUsed(c: Context<PrincipalEnv>, tokenId: string | undefined): void {
  if (!tokenId) return;

  const write = c
    .get("db")
    .update(apiToken)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiToken.id, tokenId))
    .catch(() => {
      // Never fail a request because a bookkeeping write failed.
    });

  try {
    c.executionCtx.waitUntil(write as unknown as Promise<unknown>);
  } catch {
    // No ExecutionContext (unit tests) — the promise still runs, just unawaited.
  }
}

/** Principal or null. Mirrors `getSession`. */
export function getPrincipal<E extends PrincipalEnv>(c: Context<E>): ApiPrincipal | null {
  return c.get("principal") ?? null;
}

/**
 * Reject with a JSON body Hono will actually surface.
 *
 * `HTTPException` rather than a bare `throw new Response(...)`: Hono's compose()
 * only routes `Error` instances to the error handler, so a thrown `Response`
 * never reaches it. This also lets `observabilityErrorHandler` classify these as
 * expected 4xx rejections — logged at warn, never sent to Sentry.
 *
 * Exported because the refusal envelope is one decision, not one per file. The
 * guards below and every route on `/api/v1/organization/*` answer in the same
 * shape, and a route reaching for its own `new HTTPException` is how a caller
 * ends up parsing two error formats from one API. `code` is the machine-readable
 * half — better-auth's own vocabulary, which
 * `apps/web/app/lib/member-action-errors.ts` already maps to sentences — and is
 * absent where there is nothing but the status to say.
 */
export function rejectRequest(
  status: 400 | 401 | 403 | 404 | 429,
  error: string,
  options?: { code?: string; headers?: Record<string, string> },
): never {
  const body = options?.code ? { error, code: options.code } : { error };

  throw new HTTPException(status, {
    res: new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...options?.headers },
    }),
  });
}

/** Principal or a thrown 401. Mirrors `requireSession`. */
export function requirePrincipal<E extends PrincipalEnv>(c: Context<E>): ApiPrincipal {
  const principal = getPrincipal(c);
  if (!principal) rejectRequest(401, "Unauthorized");
  return principal;
}

/** What a token caller hears on the surface this guard was written for. */
const TOKEN_MANAGEMENT_IS_INTERACTIVE =
  "API tokens can only be managed from an interactive session";

/**
 * Require an interactive (session) caller, not an API token.
 *
 * Guard token *management* with this. A token that can mint further tokens is a
 * privilege-escalation primitive: it turns one leaked CI credential into
 * permanent, self-renewing access that revoking the original does not stop.
 *
 * `reason` is the sentence the refusal carries, because a second caller has
 * since wanted the same rule for a different reason — membership writes
 * (`/api/v1/organization/*`), where a token that can promote its own owner to
 * `owner` is the same escalation shape. Defaulted rather than required so the
 * token routes read exactly as they did, and so the *rule* stays one function:
 * a call site that needed its own wording would otherwise re-implement the
 * check and get to decide the status itself.
 */
export function requireInteractivePrincipal<E extends PrincipalEnv>(
  c: Context<E>,
  reason: string = TOKEN_MANAGEMENT_IS_INTERACTIVE,
): ApiPrincipal {
  const principal = requirePrincipal(c);
  if (principal.via !== "session") rejectRequest(403, reason);
  return principal;
}

/** Scope a query to the caller's organization, or throw if they have none. */
export function requireOrganization<E extends PrincipalEnv>(
  c: Context<E>,
): { principal: ApiPrincipal; organizationId: string } {
  const principal = requirePrincipal(c);
  if (!principal.organizationId) rejectRequest(403, "No active organization");
  return { principal, organizationId: principal.organizationId };
}

/** Filter matching tokens owned by `userId` — the guard for list/revoke routes. */
export function ownedTokenFilter(userId: string, tokenId: string) {
  return and(eq(apiToken.id, tokenId), eq(apiToken.userId, userId));
}
