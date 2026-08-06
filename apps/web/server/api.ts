import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  createApiToken,
  listApiTokens,
  requireInteractivePrincipal,
  requirePrincipal,
  revokeApiToken,
  type PrincipalEnv,
} from "@starter/auth";
import { APP_VERSION } from "@starter/config/version";

export const apiApp = new OpenAPIHono<PrincipalEnv>();

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

// --- OpenAPI spec endpoint ---
apiApp.doc31("/doc", {
  openapi: "3.1.0",
  info: {
    title: "Starter API",
    version: APP_VERSION,
  },
});
