import type { Context } from "hono";
import type { Database } from "@starter/db";
import type { Auth } from "@starter/auth";
import type { Logger } from "@starter/observability/logger";
import { CSP_NONCE_KEY } from "./server/security-headers";
import type { ServerEnv } from "./server";

declare module "react-router" {
  interface AppLoadContext {
    hono: { context: Context<ServerEnv> };
    cloudflare: {
      env: ServerEnv["Bindings"];
      cf?: unknown;
      ctx?: ExecutionContext;
    };
    db: Database;
    auth: Auth;
    /** Request-scoped logger — already stamped with requestId, method and path. */
    logger: Logger;
    /** Correlation id, also returned to the client as `x-request-id`. */
    requestId: string;
    /**
     * Per-request CSP nonce. React Router's inline scripts must carry it or the
     * policy blocks them.
     *
     * `entry.server.tsx` is the only consumer: it hands the value to
     * `ServerRouter`, which is the documented default for every nonce-aware
     * component *and* for the mid-stream loader-data chunks that `root.tsx`
     * cannot reach — and to `renderToReadableStream` for React's own bootstrap
     * scripts. `root.tsx` deliberately threads no nonce of its own.
     */
    cspNonce: string | undefined;
  }
}

/**
 * Build the React Router load context from the adapter args.
 * The hono-react-router-adapter passes { context: { cloudflare, hono }, request }.
 */
export function getLoadContext(args: {
  context: {
    cloudflare: { env: ServerEnv["Bindings"]; cf?: unknown; ctx?: ExecutionContext };
    hono: { context: Context<ServerEnv> };
  };
  request: Request;
}) {
  const c = args.context.hono.context;
  return {
    ...args.context,
    db: c.get("db"),
    auth: c.get("auth"),
    logger: c.get("logger"),
    requestId: c.get("requestId"),
    // Set by `securityHeaders` before it calls next(), so it is already on the
    // context by the time React Router runs. Untyped on ServerEnv because the
    // key belongs to hono/secure-headers, not to this app.
    cspNonce: c.get(CSP_NONCE_KEY as never) as string | undefined,
  };
}
