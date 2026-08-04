import { instrumentAgentWithSentry, withSentry, wrapMcpServerWithSentry } from "@sentry/cloudflare";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDb } from "@starter/db";
import { createAuth } from "@starter/auth/server";
import { APP_VERSION } from "@starter/config/version";
import {
  bindSentryRequestScope,
  consoleWriter,
  createLogger,
  REQUEST_ID_HEADER,
  resolveLogLevel,
  resolveRequestId,
  sentryOptions,
  sentryOptionsOrDisabled,
  withSentryBreadcrumbs,
  type SentryEnv,
} from "@starter/observability";
import { registerTools } from "./tools";

interface Env extends SentryEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  ENVIRONMENT: string;
  LOG_LEVEL?: string;
}

class StarterMcpAgentBase extends McpAgent<Env> {
  // Wrapping the server instruments every tool call as a Sentry span and
  // captures tool handler errors. No-op when Sentry is not configured.
  server = wrapMcpServerWithSentry(
    new McpServer({
      name: "Starter MCP Server",
      version: APP_VERSION,
    }),
  );

  async init() {
    const db = createDb(this.env.DB);
    const auth = createAuth({
      db,
      secret: this.env.BETTER_AUTH_SECRET,
      baseURL: this.env.BETTER_AUTH_URL,
    });

    registerTools(this.server, { db, auth });
  }
}

/**
 * The Durable Object bound as MCP_OBJECT in wrangler.jsonc.
 *
 * Instrumented separately from the fetch handler below: the Agent runs in its
 * own context, so `withSentry` on the outer handler does not initialise Sentry
 * inside it and tool errors would otherwise never be reported.
 */
// The callback is annotated with `Env` (rather than passing
// `sentryOptionsOrDisabled` directly) so TS infers the agent's own env type
// instead of narrowing it to `SentryEnv`.
export const StarterMcpAgent = instrumentAgentWithSentry(
  (env: Env) => sentryOptionsOrDisabled(env),
  StarterMcpAgentBase,
);

const handler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const requestId = resolveRequestId(request.headers);
    const logger = createLogger({
      level: resolveLogLevel(env),
      base: {
        requestId,
        env: env.ENVIRONMENT ?? "development",
        version: APP_VERSION,
        app: "mcp",
      },
      write: withSentryBreadcrumbs(consoleWriter),
    }).child({ method: request.method, path: url.pathname });

    bindSentryRequestScope({ requestId, method: request.method, path: url.pathname });

    const start = Date.now();
    logger.debug("request.start");

    const respond = (response: Response) => {
      const durationMs = Date.now() - start;
      const fields = { status: response.status, durationMs };
      if (response.status >= 500) logger.error("request.complete", fields);
      else if (response.status >= 400) logger.warn("request.complete", fields);
      else logger.info("request.complete", fields);
      return response;
    };

    try {
      if (url.pathname === "/sse" || url.pathname === "/sse/message") {
        return respond(await StarterMcpAgent.serve("/sse").fetch(request, env, ctx));
      }

      if (url.pathname === "/mcp") {
        return respond(await StarterMcpAgent.serve("/mcp").fetch(request, env, ctx));
      }

      return respond(
        new Response("Starter MCP Server", {
          status: 200,
          headers: { [REQUEST_ID_HEADER]: requestId },
        }),
      );
    } catch (error) {
      logger.error("request.failed", { durationMs: Date.now() - start, error });
      // Rethrow so withSentry captures it with the scope bound above.
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;

export default withSentry<Env>(sentryOptions, handler);
