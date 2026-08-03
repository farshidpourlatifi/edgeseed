import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDb } from "@starter/db";
import { createAuth } from "@starter/auth/server";
import { registerTools } from "./tools";

interface Env {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  ENVIRONMENT: string;
}

export class StarterMcpAgent extends McpAgent<Env> {
  server = new McpServer({
    name: "Starter MCP Server",
    version: "1.0.0",
  });

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

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return StarterMcpAgent.serve("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp") {
      return StarterMcpAgent.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Starter MCP Server", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
