import type { Context } from "hono";
import type { Database } from "@starter/db";
import type { Auth } from "@starter/auth";
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
  };
}
