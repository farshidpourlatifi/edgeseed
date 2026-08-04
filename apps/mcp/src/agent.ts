import { instrumentAgentWithSentry, wrapMcpServerWithSentry } from "@sentry/cloudflare";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDb } from "@starter/db";
import { APP_VERSION } from "@starter/config/version";
import { sentryOptionsOrDisabled } from "@starter/observability";
import { registerTools, type McpProps } from "./tools";
import type { Env } from "./env";

class StarterMcpAgentBase extends McpAgent<Env, unknown, McpProps> {
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

    // `props` is always populated in practice — OAuthProvider only routes to
    // the Agent after a valid access token — but the SDK types it optional.
    const user = this.props;
    if (!user) throw new Error("MCP agent started without an authenticated principal");

    registerTools(this.server, { db, user });
  }
}

/**
 * The Durable Object bound as MCP_OBJECT in wrangler.jsonc.
 *
 * Instrumented separately from the fetch handler: the Agent runs in its own
 * context, so `withSentry` on the outer handler does not initialise Sentry
 * inside it and tool errors would otherwise never be reported. The callback is
 * annotated with `Env` so TS infers the agent's env rather than `SentryEnv`.
 */
export const StarterMcpAgent = instrumentAgentWithSentry(
  (env: Env) => sentryOptionsOrDisabled(env),
  StarterMcpAgentBase,
);
