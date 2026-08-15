import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
  createApiToken,
  getPrincipal,
  listApiTokens,
  requireInteractivePrincipal,
  requirePrincipal,
  revokeApiToken,
  type PrincipalEnv,
} from "@starter/auth";
import { PRODUCT_NAME } from "@starter/config/product";
import { APP_VERSION } from "@starter/config/version";
import { organizationApp } from "./api-organization";

export const apiApp = new OpenAPIHono<PrincipalEnv>();

/**
 * Where this app is mounted, so `server/index.ts` and the guard below cannot
 * disagree. `c.req.path` inside a routed sub-app is the *full* path, but tests
 * exercise `apiApp` directly where it is not — the guard normalises using this.
 */
export const API_BASE_PATH = "/api/v1";

/**
 * The only operations that answer without a principal. Everything else needs one.
 *
 * An allowlist, so a route added later is guarded by default rather than needing
 * someone to remember. That is the whole point: the per-handler
 * `requirePrincipal` calls below already cover today's routes — this covers the
 * ones nobody has written yet. See `docs/security-audit.md` #15.
 *
 * Keyed by **method and path**, not path alone. A path-only allowlist would make
 * `POST /health` public the moment someone registered it, which is the opposite
 * of default deny — and nothing would have failed, because no such route exists
 * to notice today.
 */
const PUBLIC_OPERATIONS = new Set(["GET /health", "GET /doc"]);

/** The request path relative to this app, whether mounted or exercised directly. */
function pathWithinApi(path: string): string {
  return path.startsWith(API_BASE_PATH) ? path.slice(API_BASE_PATH.length) || "/" : path;
}

/** Methods that cannot change state, so CSRF does not apply to them. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Did the browser say this request came from our own page?
 *
 * `Sec-Fetch-Site` is the primary signal and is unforgeable by page script;
 * `Origin` is the fallback for browsers that do not send it (Safari before
 * 16.4). Neither present means no browser vouched for the request, which for a
 * cookie-authenticated write is a refusal, not a maybe.
 */
function isSameOriginRequest(c: Context<PrincipalEnv>): boolean {
  const secFetchSite = c.req.header("sec-fetch-site");
  if (secFetchSite !== undefined) return secFetchSite === "same-origin";

  const origin = c.req.header("origin");
  if (origin !== undefined) return origin === new URL(c.req.url).origin;

  return false;
}

/** Default deny. Public operations opt out by name; everything else needs a principal. */
apiApp.use(async (c, next) => {
  const operation = `${c.req.method} ${pathWithinApi(c.req.path)}`;
  if (!PUBLIC_OPERATIONS.has(operation)) requirePrincipal(c);
  await next();
});

/**
 * CSRF, for cookie-authenticated callers only.
 *
 * Runs *after* the deny check on purpose. CSRF is only meaningful when the
 * request carries an ambient credential the browser attached by itself — an
 * anonymous caller has no privilege to abuse, and should hear 401 rather than a
 * confusing 403.
 *
 * Bearer tokens are exempt for the same reason: nothing attaches them
 * automatically, so no cross-site page can cause one to be sent. Exempting them
 * also keeps the CLI working, which sends neither `Origin` nor `Sec-Fetch-Site`.
 *
 * **Deliberately not `hono/csrf`.** That middleware only checks requests whose
 * `Content-Type` is form-shaped (`application/x-www-form-urlencoded`,
 * `multipart/form-data`, `text/plain`) or absent — the shapes a cross-origin
 * `<form>` can produce without a CORS preflight. It is therefore a **no-op on
 * `application/json`**, which is exactly what this API's only cookie-authenticated
 * write sends. That is safe today only because no CORS policy is configured, so
 * the preflight fails; it would become a real hole the day someone adds one, and
 * nothing would fail to say so. Checking every unsafe method regardless of
 * content type costs one comparison and does not depend on that assumption.
 */
apiApp.use(async (c, next) => {
  if (getPrincipal(c)?.via !== "session") return next();
  if (SAFE_METHODS.has(c.req.method)) return next();

  if (!isSameOriginRequest(c)) {
    return c.json({ error: "Cross-origin request refused" }, 403);
  }

  await next();
});

const ErrorSchema = z.object({ error: z.string() });

const unauthorized = {
  401: {
    content: { "application/json": { schema: ErrorSchema } },
    description: "Missing or invalid credentials",
  },
} as const;

const forbidden = {
  403: {
    content: { "application/json": { schema: ErrorSchema } },
    description: "Not permitted for this credential type",
  },
} as const;

// --- Health check ---
const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            status: z.string(),
            version: z.string(),
          }),
        },
      },
      description: "Health check response",
    },
  },
});

apiApp.openapi(healthRoute, (c) => {
  return c.json({ status: "ok", version: APP_VERSION }, 200);
});

// --- Current principal ---
// The API twin of the MCP `whoami` tool: both report identity from the
// credential, never from caller input.
const meRoute = createRoute({
  method: "get",
  path: "/me",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            userId: z.string(),
            organizationId: z.string().nullable(),
            via: z.enum(["session", "token"]),
          }),
        },
      },
      description: "The authenticated principal",
    },
    ...unauthorized,
  },
});

apiApp.openapi(meRoute, (c) => {
  const { userId, organizationId, via } = requirePrincipal(c);
  return c.json({ userId, organizationId, via }, 200);
});

// --- API tokens ---
// Management is session-only (see `requireInteractivePrincipal`): a token able
// to mint tokens would outlive revocation of the one that leaked.

const TokenSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});

const listTokensRoute = createRoute({
  method: "get",
  path: "/tokens",
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ tokens: z.array(TokenSummarySchema) }) },
      },
      description: "Active tokens belonging to the caller",
    },
    ...unauthorized,
    ...forbidden,
  },
});

apiApp.openapi(listTokensRoute, async (c) => {
  const principal = requireInteractivePrincipal(c);
  const tokens = await listApiTokens(c.get("db"), principal.userId);
  return c.json({ tokens }, 200);
});

const createTokenRoute = createRoute({
  method: "post",
  path: "/tokens",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().min(1).max(100),
            expiresInDays: z.number().int().positive().max(365).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: TokenSummarySchema.extend({
            token: z.string().describe("Shown once. Not recoverable afterwards."),
          }),
        },
      },
      description: "The created token, including its plaintext (once)",
    },
    ...unauthorized,
    ...forbidden,
  },
});

apiApp.openapi(createTokenRoute, async (c) => {
  const principal = requireInteractivePrincipal(c);
  const { name, expiresInDays } = c.req.valid("json");

  // The only time the plaintext is ever returned.
  const created = await createApiToken(c.get("db"), {
    userId: principal.userId,
    organizationId: principal.organizationId,
    name,
    expiresInDays,
  });

  return c.json(created, 201);
});

const revokeTokenRoute = createRoute({
  method: "delete",
  path: "/tokens/{id}",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ revoked: z.boolean() }) } },
      description: "Whether a token was revoked",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "No such active token belonging to the caller",
    },
    ...unauthorized,
    ...forbidden,
  },
});

apiApp.openapi(revokeTokenRoute, async (c) => {
  const principal = requireInteractivePrincipal(c);
  const { id } = c.req.valid("param");

  const revoked = await revokeApiToken(c.get("db"), { userId: principal.userId, id });

  if (!revoked) return c.json({ error: "Token not found" }, 404);
  return c.json({ revoked: true }, 200);
});

// --- Organizations ---

/**
 * Mounted at the root rather than under a `/organization` prefix, because the
 * sub-app states its own full paths — so what `/doc` advertises is the string
 * written next to each route, with no prefix to reconcile. It must stay **above**
 * the terminal `all("*")` below, which answers anything left.
 *
 * Nothing about these routes is public: they are absent from `PUBLIC_OPERATIONS`
 * and therefore denied to an anonymous caller by the guard at the top of this
 * file, before routing resolves.
 */
apiApp.route("/", organizationApp);

// --- OpenAPI spec endpoint ---

/**
 * The one description of this API's identity.
 *
 * Exported because `pnpm api:spec` writes `docs/api/openapi.json` from the same
 * app and previously declared its own copy — which drifted: the committed file
 * said "Starter API" / `1.0.0` while this endpoint served the real name and
 * version. A generated artifact that disagrees with the endpoint it documents
 * is worse than no artifact.
 *
 * `title` comes from `product.ts` because it is public surface at
 * `/api/v1/doc`, and `init:product` renames the product in one place.
 */
export const OPENAPI_INFO = {
  title: `${PRODUCT_NAME} API`,
  version: APP_VERSION,
} as const;

apiApp.doc31("/doc", {
  openapi: "3.1.0",
  info: OPENAPI_INFO,
});

// --- Terminal 404 ---

/**
 * Nothing under this mount escapes to the page router.
 *
 * Registered **last**, so it only runs when no route above returned: Hono stops
 * composing the moment a handler answers without calling `next()`.
 *
 * Without it, an **authenticated** request to an unknown `/api/v1` path passes
 * the default-deny guard, matches no route here, and falls out of the mount
 * entirely — `hono-react-router-adapter` installs React Router as a middleware
 * after this app, so the request lands on the browser splat and an API client
 * receives an HTML page. That predates the splat (it used to be React Router's
 * default error page instead), which is what made it easy to keep: both answer
 * `404 text/html`, so status and content type look untouched either way.
 *
 * An anonymous caller never reaches here — the deny guard above throws 401
 * first, and that stays true (`docs/security-audit.md` #15). This is only the
 * authenticated miss, and JSON is the shape every other error on this app
 * already uses.
 *
 * It is a plain Hono route, not an `openapi()` one, so it adds no path to the
 * spec — `/doc` still advertises exactly the routes that exist.
 */
apiApp.all("*", (c) => c.json({ error: "Not Found" }, 404));
