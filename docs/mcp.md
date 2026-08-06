# MCP server

`apps/mcp` exposes your app to LLM clients over the Model Context Protocol,
behind OAuth 2.1. It is a **separate Worker** from `apps/web` that talks to the
**same** D1 database, so it sees the same users — and it is deliberately left
undeployed until a product actually needs it.

Design rationale and the threat model behind the auth flow:
[security-audit.md](./security-audit.md) #8. Cost implications of the Durable
Object: [costs-and-limits.md](./costs-and-limits.md).

---

## What a client gets

Two tools today, matching `/api/v1`:

| Tool           | Matches              | Returns                                            |
| -------------- | -------------------- | -------------------------------------------------- |
| `health_check` | `GET /api/v1/health` | `{ status, version }`                              |
| `whoami`       | `GET /api/v1/me`     | `{ userId, email }` of the authenticated principal |

`whoami` reads identity from the OAuth grant (`ctx.user`), never from a tool
argument — a tool must not take the caller's word for who they are. Every tool
you add follows that rule; see [Adding a tool](#adding-a-tool).

**Transport is Streamable HTTP only**, served at `/mcp`. There is no `/sse`
endpoint — an earlier one never actually served SSE and was removed. If a client
needs it, add it back with `serve(path, { transport: "sse" })`.

---

## Connecting a client

The server implements OAuth 2.1 with **dynamic client registration**, so you do
not create credentials by hand. Point a client at the `/mcp` URL and it
discovers the rest: the unauthenticated request returns `401` with a
`WWW-Authenticate` challenge, the client follows that to discovery, registers
itself at `/register`, and opens a browser for you to sign in and approve.

Local dev URL is `http://localhost:8788/mcp`; deployed it is
`https://<your-mcp-worker>.workers.dev/mcp`.

### Claude Code

```bash
claude mcp add --transport http starter https://<your-mcp-worker>.workers.dev/mcp
```

### Claude Desktop / Cursor

Both read a JSON config (`claude_desktop_config.json`, or Cursor's
`~/.cursor/mcp.json`). Clients without native remote-MCP support need the
`mcp-remote` bridge, which handles the OAuth dance and caches the token:

```json
{
  "mcpServers": {
    "starter": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-mcp-worker>.workers.dev/mcp"]
    }
  }
}
```

Restart the client after editing. On first use a browser window opens for
sign-in and consent; the grant is stored in `OAUTH_KV` and the client keeps a
refreshable token, so this happens once.

### What you will see

1. **Sign in** — email/password, plus GitHub/Google if those credentials are set
   on **this** Worker. It runs its own Better Auth against the same D1, so your
   web-app account works here; the session cookie is separate because it is a
   separate origin.
2. **Consent** — names the client, the account, the `mcp` scope, and the redirect
   URI it will return to.
3. **Approve** — the client receives its token and the tools appear.

---

## Local development

The MCP Worker is a separate Worker with its **own** `.dev.vars` — the web app's
does not cover it. Copy the template and fill it in:

```bash
cp apps/mcp/.dev.vars.example apps/mcp/.dev.vars
```

It needs `BETTER_AUTH_SECRET` (32+ chars). It deliberately has **no**
`BETTER_AUTH_URL`: `auth-app.ts` derives its origin from each request, so dev
and production both work without one.

```bash
pnpm dev --filter @starter/mcp
```

That runs `wrangler dev --persist-to ../web/.wrangler/state`, which is what makes
both Workers share one local D1 — without it you would sign in against an empty
database. Run `pnpm db:migrate` and `pnpm db:seed` from the repo root first.

To exercise it without an LLM client:

```bash
curl -i http://localhost:8788/mcp
```

Expect `401` with a `WWW-Authenticate` header — that challenge is the entry point
to the whole flow, so seeing it means the server is wired correctly.

---

## Deploying

**Leave it undeployed until a product needs it.** The Agent is a Durable Object,
which bills for duration rather than requests.

Before the first deploy:

1. **Create a real KV namespace.** `apps/mcp/wrangler.jsonc` ships
   `id: "local"`, a placeholder with nowhere to store grants:

   ```bash
   cd apps/mcp && npx wrangler kv namespace create OAUTH_KV
   ```

   Paste the returned id into `kv_namespaces[0].id`.

2. **Check the D1 id matches `apps/web`.** Both files must name the same
   `database_id`. A different id is a different set of users, and sign-in here
   would fail against accounts that exist in the web app.

3. **Set the secret.** Never in `wrangler.jsonc` — a `var` shadows a same-named
   secret at deploy time, so a committed value silently wins:

   ```bash
   cd apps/mcp && npx wrangler secret put BETTER_AUTH_SECRET
   ```

4. **Register OAuth callbacks for this origin** if you want social login here.
   Each origin needs its own: the web app's registration does not cover this
   Worker.
   - GitHub: `{mcp-origin}/api/auth/callback/github`
   - Google: `{mcp-origin}/api/auth/callback/google`

5. **Sentry (optional)** — its own project and DSN, per
   [sentry-setup.md](./sentry-setup.md). One project per Worker.

---

## Adding a tool

The convention is one tool per public `/api/v1` route ("MCP parity"). Adding one
is additive — a new file registered in `registerTools`, never an edit to a
working tool:

1. Create `apps/mcp/src/tools/<name>.ts` exporting
   `register<Name>Tool(server, ctx)`.
2. Register it in `apps/mcp/src/tools/index.ts`.
3. Scope every query by `ctx.user.userId` — the OAuth grant, never an argument.
4. Add a test in `apps/mcp/src/__tests__/` against the stubbed `McpServer`.

---

## Security notes

These are the non-obvious guarantees, each with a reason it exists:

- **PKCE is enforced for every client**, in `auth-app.ts` rather than by the
  library. `OAuthProvider` only mandates a code challenge when
  `tokenEndpointAuthMethod === "none"`, and dynamic registration defaults to
  `client_secret_basic` — so a client could otherwise skip PKCE, which OAuth 2.1
  does not permit.
- **Scopes are validated at authorization.** `scopesSupported` only populates
  discovery metadata; without the explicit check, any requested scope would be
  granted verbatim, including invented ones.
- **A session id is bound to its principal in KV.** The MCP spec treats
  `mcp-session-id` as non-secret, and the Agent's `props` are written once to
  Durable Object storage — so without this, anyone who learned a session id could
  present their own valid token with a victim's session id and have every tool
  resolve to the victim's account. A mismatch is `403`.
- **Rejection happens before consent.** A request this server would not honour
  is refused without asking a user to approve it.
- **The consent POST is CSRF-protected** by Better Auth's session cookie and its
  form CSRF middleware — which is armed only because a header-only `request` copy
  is passed through `auth.api.*`. Removing that silently disarms it.

---

## Troubleshooting

| Symptom                                      | Cause                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401` on every request, client never prompts | Expected without a token — the client must follow the `WWW-Authenticate` challenge. Check it supports remote MCP, or use the `mcp-remote` bridge. |
| Sign-in rejects a known-good account         | The two Workers point at different `database_id` values, so this is a different user set.                                                         |
| `403 session_principal_mismatch`             | A session id is being reused across principals. Reconnect the client to get a fresh session.                                                      |
| Grants do not survive a restart              | `OAUTH_KV` is still the `"local"` placeholder — create a real namespace.                                                                          |
| Social buttons missing on the login page     | Those provider credentials are not set on **this** Worker; it reads its own `.dev.vars`/secrets.                                                  |
| Tools appear but every call fails            | Usually a missing local D1 — run `pnpm db:migrate`, and confirm `--persist-to` is in the dev script.                                              |
