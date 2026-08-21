import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { expect, type Page } from "@playwright/test";

/**
 * An OAuth 2.1 client for the MCP Worker, driven the way a real MCP client
 * drives it.
 *
 * `apps/mcp` is a **second Worker**, on its own origin, running its own Better
 * Auth against the same D1 as the web app. {@link startMcpWorker} boots it —
 * see that function for why it is not a `webServer` entry.
 *
 * Why this exists at all: MCP is the one surface in this repo where an
 * organization id arrives as a **tool argument** rather than from the
 * credential (`apps/mcp/CLAUDE.md`, "An organization id _is_ a legal tool
 * argument, as a target"). The unit tests in `apps/mcp/src/__tests__` prove the
 * membership check refuses a foreign id, but they hand the tool a `ctx.user`
 * they wrote themselves. What they cannot reach is the step before it — that a
 * grant issued to one person resolves to *that* person's `userId` when a tool
 * runs. Only the full walk proves that, and until this file existed the walk
 * was hand-verified once and written down as a date.
 *
 * The flow is the spec's, not a shortcut through it: dynamic registration →
 * `/authorize` with PKCE → the login form → the consent screen → code exchange
 * → `initialize` → `tools/call`. The two screens are driven in a browser
 * because they are screens; everything else is plain HTTP, on Node's `fetch`
 * rather than Playwright's request fixture, so the MCP origin's session cookie
 * never lands in a jar the web-app assertions share.
 */

/**
 * The port the MCP Worker listens on under test.
 *
 * One constant for both halves of this file — the Worker `startMcpWorker` boots
 * and the origin every request below addresses — so they cannot drift onto
 * different ports. It matches the `mcp` entry in `.claude/launch.json`, which is
 * what a developer's own preview uses, which is also why `startMcpWorker`
 * refuses to run when something is already listening here.
 */
export const MCP_PORT = 8788;

/**
 * `localhost`, not `127.0.0.1`, for the same reason `baseURL` is: Better Auth
 * rejects a request whose `Origin` is not a trusted origin, and this Worker
 * derives its `baseURL` from the request origin — so the name the browser uses
 * has to be the name the Worker sees.
 *
 * The two halves of this file reach that name by different routes, and only one
 * of them is covered by the config. `page.goto` is Chromium's, so the
 * `--host-resolver-rules` launch arg in `playwright.config.ts` pins it to the
 * address wrangler bound. **Every other call here is Node's `fetch`, which that
 * flag never touches** — it lands because Node 20+ enables Happy Eyeballs
 * (`autoSelectFamily`) by default, so a `localhost` that resolves to `::1`
 * first falls straight through to the `127.0.0.1` wrangler is listening on.
 * Do not "simplify" this to `127.0.0.1`: the browser leg would then hand Better
 * Auth an origin its `baseURL` does not match.
 */
export const MCP_ORIGIN = `http://localhost:${MCP_PORT}`;

/**
 * Where the authorization code comes back to.
 *
 * The MCP Worker's own root, which answers a two-line JSON document. A real
 * client redirects to a loopback listener of its own; anything registered will
 * do, and choosing this origin keeps the whole grant on one host — no dependency
 * on the web app being up, and no landing page to render before the URL can be
 * read.
 */
const REDIRECT_URI = `${MCP_ORIGIN}/`;

/**
 * The protocol version this client implements.
 *
 * Pinned rather than imported: `@modelcontextprotocol/sdk` is a dependency of
 * `apps/mcp`, not of the test suite, and a client that tracked whatever the
 * server happened to ship would negotiate with itself. The server answers with
 * the version it settled on, and `callTool` sends *that* back in
 * `MCP-Protocol-Version` — so a server that stops supporting this one fails
 * here loudly instead of being quietly followed.
 */
const CLIENT_PROTOCOL_VERSION = "2025-06-18";

/* ------------------------------ worker lifecycle ----------------------------- */

let worker: ChildProcess | undefined;

/**
 * Boot the MCP Worker, and resolve once it answers.
 *
 * **Why this is not a `webServer` entry in `playwright.config.ts`.** Two
 * miniflare instances cannot initialise the same `--persist-to` root
 * concurrently, and this Worker deliberately shares
 * `apps/web/.wrangler/state` so it reads the D1 the browser just wrote to.
 * Playwright starts every `webServer` entry in parallel, so declared there it
 * raced the web app and died at boot with `Directory named "cache:storage" not
 * found` — about a directory that exists — followed by `The Workers runtime
 * failed to start`. Started after the web server is serving, it is reliable.
 *
 * It also keeps the cost where it belongs: `webServer` is not scoped to a
 * project or a `-g` filter, so declaring it there made `pnpm test:e2e -g
 * favicon` compile a Worker and open a Durable Object namespace.
 *
 * `--var SENTRY_DSN:` pins the Worker's env rather than inheriting whatever
 * `apps/mcp/.dev.vars` holds, and it is **not** optional. With a real DSN
 * configured locally, this Worker alternates between ~10s responses and 30s
 * `503`s, so the OAuth grant fails about half the time.
 *
 * **It is the Sentry flush, not KV**, and the two timings say so plainly — the
 * handler's own `durationMs` against what wrangler measures for the same
 * request:
 *
 *     real DSN            durationMs: 3–5      POST /register 201 (9927ms)
 *                         durationMs: 4        POST /register 503 (29992ms)
 *     --var SENTRY_DSN:   durationMs: 1–3      POST /register 201 (3ms)
 *
 * The KV write finishes in single-digit milliseconds; everything after that is
 * spent *after* the handler returned, with `withSentry` holding the response on
 * a flush that `enableLogs: true` (`packages/observability/src/sentry.ts`) turns
 * into a network round trip per log line. The `Network connection lost` that
 * surfaces at the KV call is the request context being torn down around it, not
 * the put failing.
 *
 * So this is a **local-dev configuration artifact, not a defect** in the MCP
 * surface, in `withSentry`, or in the wrangler/workerd version skew — each of
 * which was tested and cleared. CI never sees it: the `.dev.vars` it writes
 * names no DSN, `sentryOptions` returns `undefined`, and `withSentry` really is
 * the pass-through the docs describe. Do not "fix" `withSentry` on the strength
 * of this.
 *
 * The override earns its place anyway: a test run must not inherit a
 * developer's local configuration, and must not ship its deliberate deny-path
 * failures into a real Sentry project. `--var` does beat `.dev.vars` — wrangler
 * spreads the CLI's bindings last — so overriding the one key works.
 *
 * `check:boot` no longer relies on that precedence: it passes `--env-file` at
 * an empty fixture and suppresses the file wholesale, because its Worker must
 * run on a minimum env that is identical on a laptop and in CI.
 *
 * This suite deliberately does **not** do the same, and the difference is worth
 * stating so it is not "tidied" into consistency. `.dev.vars` is this suite's
 * intended configuration channel — the spawn below passes exactly one `--var`,
 * so `BETTER_AUTH_SECRET` and the rest arrive from the file, and the CI e2e job
 * writes a throwaway one precisely to supply them. Suppressing it here would
 * leave the Worker with no secret and every request refused. e2e needs a
 * realistic env; `check:boot` needs a minimal one. Same mechanism, opposite
 * requirement.
 */
export async function startMcpWorker(timeoutMs = 180_000): Promise<void> {
  if (worker) return;

  /*
   * Refuse to adopt somebody else's Worker.
   *
   * Without this, spawning wrangler against an occupied port fails to bind
   * while the readiness probe below is answered by whatever is already there —
   * so the suite silently adopts it. On a machine with a sibling clone of this
   * starter checked out (`init:product` keeps the `mcp` preview on 8788), or
   * with a developer's own preview running, that is somebody else's Worker
   * against somebody else's database, and the tenant-isolation assertions would
   * pass or fail on rows this suite never wrote — the least debuggable outcome
   * available. Nothing this suite starts survives a run, because
   * `stopMcpWorker` runs in `afterAll`, so anything listening here is foreign
   * by definition.
   */
  // A TCP connect rather than a request: an HTTP probe reads its own timeout as
  // "nothing there", so a wedged listener — what an interrupted run leaves —
  // reads as a free port and gets adopted anyway. Only an explicit refusal
  // counts as free; `packages/cli/src/check-boot.ts` refuses on the same terms.
  const occupied = await new Promise<boolean>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port: MCP_PORT });
    const settle = (busy: boolean) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(2_000);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(true));
    socket.once("error", (error: NodeJS.ErrnoException) => settle(error.code !== "ECONNREFUSED"));
  });

  if (occupied) {
    throw new Error(
      `Something is already listening on ${MCP_ORIGIN}. This suite starts its own ` +
        `MCP Worker and will not adopt one it did not configure — it would run ` +
        `against another Worker's database. Stop it (the \`mcp\` preview in ` +
        `.claude/launch.json, or a sibling clone's) and re-run: ` +
        `lsof -nP -iTCP:${MCP_PORT} -sTCP:LISTEN`,
    );
  }

  worker = spawn(
    "pnpm",
    [
      "--filter",
      "@starter/mcp",
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(MCP_PORT),
      "--var",
      "SENTRY_DSN:",
    ],
    // `detached` makes the child a process-group leader, which is what lets
    // `stopMcpWorker` signal the whole `pnpm → wrangler → workerd` chain by
    // negative pid. The trade is that it outlives this process if nothing kills
    // it, so the exit hook below is the safety net rather than a nicety.
    { stdio: "ignore", detached: true },
  );

  process.once("exit", () => {
    if (worker?.pid) {
      try {
        process.kill(-worker.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  });

  const exited = new Promise<never>((_, reject) => {
    worker!.once("exit", (code) =>
      reject(new Error(`The MCP Worker exited before it served a request (code ${code}).`)),
    );
  });

  const ready = (async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        // `/` answers from static metadata and reaches no binding, which is what
        // makes it a readiness probe rather than a test of anything.
        const response = await fetch(`${MCP_ORIGIN}/`);
        if (response.ok) return;
      } catch {
        // Not listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`The MCP Worker did not answer on ${MCP_ORIGIN} within ${timeoutMs}ms.`);
  })();

  await Promise.race([ready, exited]);
}

/**
 * Stop the MCP Worker.
 *
 * `pnpm` is a wrapper around wrangler, which is a wrapper around workerd, so
 * killing the process this suite spawned is not enough on its own — the
 * negative pid signals the whole group. An orphaned dev server holding this
 * port or the shared D1 is one of the longest-running traps in this repo, and
 * it surfaces on the *next* run as something that looks nothing like a leak.
 */
export async function stopMcpWorker(): Promise<void> {
  if (!worker?.pid) return;

  const stopped = new Promise<void>((resolve) => worker!.once("exit", () => resolve()));
  try {
    process.kill(-worker.pid, "SIGKILL");
  } catch {
    worker.kill("SIGKILL");
  }
  worker = undefined;

  await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

/** RFC 7636 §4.1–4.2 — the verifier, and the S256 challenge derived from it. */
async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const { createHash, randomBytes } = await import("node:crypto");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * Register a public client, the way an MCP client with no pre-shared secret
 * does (RFC 7591).
 *
 * `token_endpoint_auth_method: "none"` is the meaningful field. The provider
 * defaults registration to `client_secret_basic`, and the token endpoint
 * refuses a request whose presented method is not the registered one — so a
 * client that wants to exchange a code with nothing but PKCE has to say so at
 * registration.
 */
async function registerClient(name: string): Promise<string> {
  const response = await fetch(`${MCP_ORIGIN}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });

  const body = (await response.json()) as { client_id?: string };
  expect(response.ok, JSON.stringify(body)).toBe(true);
  expect(body.client_id, "dynamic registration returned no client_id").toBeTruthy();

  return body.client_id!;
}

/** One MCP session: an access token, a session id, and the tool calls made with them. */
export type McpSession = {
  /** The `mcp` access token the grant issued. */
  accessToken: string;
  /**
   * Call a tool and hand back what it answered.
   *
   * `isError` is part of the return value rather than an exception: a refusal
   * is the assertion in half the cases here, and `rejectTool` answers
   * `isError: true` with the `{ error }` envelope `/api/v1` uses
   * (`apps/mcp/src/tools/reject.ts`) rather than failing the transport.
   */
  callTool(name: string, args?: Record<string, unknown>): Promise<McpToolResult>;
};

export type McpToolResult = {
  isError: boolean;
  /** The concatenated `text` blocks, which is what every tool in this repo returns. */
  text: string;
  /** `text` parsed as JSON, or `undefined` when it is a refusal sentence. */
  json?: unknown;
};

type JsonRpcResponse = {
  result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  error?: { code: number; message: string };
};

/**
 * Read one JSON-RPC response out of a streamable-HTTP reply.
 *
 * The transport answers either `application/json` or a `text/event-stream`
 * carrying `data:` frames, and which one is the server's choice — so both are
 * handled rather than one being assumed. Only the first frame matters here:
 * every call this suite makes is a single request/response pair.
 */
async function readRpc(response: Response): Promise<JsonRpcResponse> {
  const body = await response.text();
  expect(response.ok, `${response.status} ${body}`).toBe(true);

  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const frame = body
      .split("\n")
      .find((line) => line.startsWith("data:"))
      ?.slice("data:".length)
      .trim();
    if (!frame) throw new Error(`No data frame in MCP event stream: ${body}`);
    return JSON.parse(frame) as JsonRpcResponse;
  }

  return JSON.parse(body) as JsonRpcResponse;
}

/**
 * Complete an OAuth grant as `email` and open an MCP session on it.
 *
 * The `page` is the caller's, so the grant is charged to whatever
 * `cf-connecting-ip` that context carries — `/authorize`'s login form limits
 * itself in the `credentials` class (`apps/mcp/src/auth-app.ts`), and a shared
 * address would have specs throttling each other exactly as they do on the web
 * origin.
 */
export async function grantMcpAccess(
  page: Page,
  credentials: { email: string; password: string },
  clientName = "EdgeSeed e2e",
): Promise<McpSession> {
  const clientId = await registerClient(clientName);
  const { verifier, challenge } = await pkcePair();
  const state = Math.random().toString(36).slice(2);

  const authorize = new URL(`${MCP_ORIGIN}/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: "mcp",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  // --- The two screens. Signed out, `/authorize` renders the login form; the
  // POST lands back on `/authorize` with a session cookie, which is what turns
  // it into the consent screen.
  await page.goto(authorize.toString());

  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(
    page.getByRole("heading", { name: new RegExp(`Authorize ${clientName}`) }),
  ).toBeVisible({ timeout: 15000 });
  // Named, so a consent screen that stopped saying *who* is about to be
  // connected — the whole point of the screen — fails here.
  await expect(page.getByText(credentials.email)).toBeVisible();

  await page.getByRole("button", { name: "Approve" }).click();
  await page.waitForURL((url) => url.searchParams.has("code") || url.searchParams.has("error"), {
    timeout: 15000,
  });

  const returned = new URL(page.url());
  expect(returned.searchParams.get("error"), returned.toString()).toBeNull();
  // RFC 6749 §10.12: the state that went out has to be the state that came back.
  expect(returned.searchParams.get("state")).toBe(state);

  const code = returned.searchParams.get("code")!;

  // --- Code for token. No client secret: PKCE is the proof, which is the whole
  // reason the client registered as a public one.
  const tokenResponse = await fetch(`${MCP_ORIGIN}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    }).toString(),
  });

  const token = (await tokenResponse.json()) as { access_token?: string };
  expect(tokenResponse.ok, JSON.stringify(token)).toBe(true);
  expect(token.access_token, "token exchange returned no access_token").toBeTruthy();

  return openSession(token.access_token!);
}

/**
 * Bring an MCP session up on an access token: `initialize`, then the
 * `notifications/initialized` the transport waits for before it will serve a
 * tool call.
 */
async function openSession(accessToken: string): Promise<McpSession> {
  const headers = (extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    // Both, because the transport picks: it answers JSON to some requests and
    // an event stream to others, and refuses outright if the client has not
    // said it can read the one it chose.
    accept: "application/json, text/event-stream",
    ...extra,
  });

  const initialize = await fetch(`${MCP_ORIGIN}/mcp`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "edgeseed-e2e", version: "1.0.0" },
      },
    }),
  });

  // Assigned by the server during `initialize` — the request that creates the
  // Durable Object. Every later call carries it, and `enforceSessionOwner` in
  // `apps/mcp/src/index.ts` binds it to this grant's principal.
  const sessionId = initialize.headers.get("mcp-session-id");
  const negotiated = (await readRpc(initialize)).result as { protocolVersion?: string } | undefined;
  expect(sessionId, "initialize returned no mcp-session-id").toBeTruthy();

  const sessionHeaders = () =>
    headers({
      "mcp-session-id": sessionId!,
      "mcp-protocol-version": negotiated?.protocolVersion ?? CLIENT_PROTOCOL_VERSION,
    });

  const initialized = await fetch(`${MCP_ORIGIN}/mcp`, {
    method: "POST",
    headers: sessionHeaders(),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  expect(initialized.ok, `notifications/initialized: ${initialized.status}`).toBe(true);

  let nextId = 2;

  return {
    accessToken,
    async callTool(name, args = {}) {
      const response = await fetch(`${MCP_ORIGIN}/mcp`, {
        method: "POST",
        headers: sessionHeaders(),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: nextId++,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });

      const rpc = await readRpc(response);
      if (rpc.error) throw new Error(`MCP ${name} failed: ${rpc.error.message}`);

      const text = (rpc.result?.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }

      return { isError: rpc.result?.isError === true, text, json };
    },
  };
}
