# Sentry setup

Error reporting is **opt-in**. With no `SENTRY_DSN` set, `withSentry()` is a
pass-through and everything still works — structured logs keep flowing to
Cloudflare Workers Logs. Follow this only when you want error grouping,
alerting, and release tracking on top. Design rationale: [ADR 002](./adr/002-observability.md).

## Project topology

**One Sentry project per Worker. Environments live inside a project.**

| Sentry project  | Worker     | Environments                           |
| --------------- | ---------- | -------------------------------------- |
| `<product>-web` | `apps/web` | `development`, `staging`, `production` |
| `<product>-mcp` | `apps/mcp` | `development`, `staging`, `production` |

Why not a project per environment: Sentry's `environment` tag is built for this.
Keeping environments in one project preserves issue grouping, regression
detection ("resolved in staging, reappeared in prod"), and release history
across them. Splitting fragments all three and saves nothing — quota is
org-wide, not per project.

Why split web from MCP: they are separate deploy units with different failure
modes and different audiences (end users vs. LLM clients), so they want separate
alert routing and ownership. The `environment` value comes from `ENVIRONMENT`
automatically, so you do not configure environments anywhere — they appear as
events arrive.

> Prefer a single project for both Workers? That works too, but add a
> distinguishing tag first or you cannot tell the Workers apart in the issue
> stream — ask and I'll wire an `app` tag into `sentryOptions`.

## 1. Create the projects

In Sentry: **Projects → Create Project → platform `Cloudflare Workers`**. Do it
twice, once per Worker. Copy each project's **DSN** (Settings → Client Keys).

A DSN looks like `https://<key>@o<org>.ingest.sentry.io/<project>`. It is not a
password — it only permits _writing_ events — but treat it as a secret anyway so
strangers cannot flood your quota.

## 2. Local development

Each Worker has its own `.dev.vars` (gitignored, merged by wrangler on `pnpm dev`).

`apps/web/.dev.vars`:

```
SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<web-project>
SENTRY_TRACES_SAMPLE_RATE=1
```

`apps/mcp/.dev.vars`:

```
SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<mcp-project>
SENTRY_TRACES_SAMPLE_RATE=1
```

`ENVIRONMENT` is already `development` in both `wrangler.jsonc`, so these events
land under the `development` environment. `tracesSampleRate: 1` is fine locally;
see step 5 before doing that in production.

Restart the dev servers — `.dev.vars` is read at startup, not per request.

## 3. Production

Secrets never go in `wrangler.jsonc`. Set them per Worker:

```bash
cd apps/web
npx wrangler secret put SENTRY_DSN
```

```bash
cd apps/mcp
npx wrangler secret put SENTRY_DSN
```

Each prompts for the value and stores it encrypted. Repeat for any of the
optional vars below you want to override in production.

Non-secret tuning can go in `wrangler.jsonc` under `vars` — a sample rate is not
sensitive:

```jsonc
"vars": {
  "SENTRY_TRACES_SAMPLE_RATE": "0.1",
},
```

**Do not put `ENVIRONMENT` there.** That block is shared with local development,
so setting it to `production` would make `pnpm dev` report itself as production —
tagging local events `production` and dropping `LOG_LEVEL` from `debug` to
`info`. It stays `development` in the file, and `pnpm deploy:web` overrides it
with `--var ENVIRONMENT:production` at deploy time. If you deploy by any other
route, pass that flag yourself or production will report as `development`.

List what is already set with `npx wrangler secret list` in each app directory.

## 4. Verify it works

> **`pnpm dev` does not initialise Sentry.** `withSentry()` lives in
> `apps/web/worker.ts`, the _Worker_ entry. The Vite dev server mounts
> `server/index.ts` directly (`vite.config.ts` → `serverAdapter({ entry })`), so
> `worker.ts` is never imported on :5173 and `captureError` no-ops against an
> uninitialised client. Errors still log to the console there; they just do not
> reach Sentry.
>
> Smoke-test against the **built** Worker (`wrangler dev`) or a deployed
> environment. Setting `SENTRY_DSN` in `.dev.vars` and curling :5173 will look
> like a silent failure — because it is a code path where Sentry is switched off.
>
> Known blocker: `wrangler dev` currently fails to boot on a zod 3/4 conflict
> (see `docs/security-audit.md` #1 and #6). Until that is fixed there is no local
> path to verify Sentry end to end.

Structured logs are easy to confirm (`wrangler tail`, or the dev server output).
Sentry needs an actual error, so make one **temporarily**:

Add to `apps/web/server/api.ts`, below the health route:

```ts
apiApp.get("/boom", () => {
  throw new Error("Sentry smoke test");
});
```

`apiApp` is mounted at `/api/v1` in `server/index.ts`, so paths declared here are
served **under that prefix** — the route above answers at `/api/v1/boom`, not
`/boom`. Build and run the actual Worker, then hit it:

```bash
pnpm --filter @starter/web build
cd apps/web && npx wrangler dev --port 8790
```

```bash
curl -i http://localhost:8790/api/v1/boom
```

You should get:

- a `500` with `{ "error": "Internal Server Error", "requestId": "..." }`
- a `request.failed` log line carrying the same `requestId` and the stack
- an issue in Sentry within a few seconds, tagged `request_id` with that value

That `request_id` tag is the point of the whole setup: a user quotes the id from
their error page, and it takes you straight to both the log line and the Sentry
issue.

**Delete the route once you have seen the issue.** It is an unauthenticated
500 generator.

## 5. Tuning

| Variable                    | Default                             | Notes                                                        |
| --------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| `SENTRY_DSN`                | unset — Sentry disabled             | Absent means full pass-through                               |
| `SENTRY_TRACES_SAMPLE_RATE` | `0`                                 | `0`..`1`. Errors are always sent; this only gates _tracing_  |
| `SENTRY_ENVIRONMENT`        | falls back to `ENVIRONMENT`         | Override only if you need a name like `canary`               |
| `SENTRY_RELEASE`            | falls back to `APP_VERSION`         | Bumped by `pnpm version:bump`                                |
| `LOG_LEVEL`                 | `debug` in development, else `info` | Gates logs, breadcrumbs and Sentry Logs; never error capture |

Start production at `SENTRY_TRACES_SAMPLE_RATE=0` (errors only). Raise to
`0.05`–`0.1` if you want performance data; `1` in production will burn quota
fast on a busy Worker.

`sendDefaultPii` is hardcoded `false` — no IPs, headers, or bodies are sent.
Turn it on only after a privacy review, and never as a starter default.

## What you get

- **Errors** — `request.failed` and SSR/loader failures, grouped, with the
  request's log trail attached as breadcrumbs
- **Logs** — the same structured entries as a searchable stream in Sentry Logs,
  attributes and all. Breadcrumbs only exist attached to an error; this is how
  you search a request that succeeded. It costs quota per log line, so keep
  `LOG_LEVEL` at `info` in production unless you are actively debugging
- **`request_id` tag** on every event, matching the `x-request-id` response
  header and the log lines
- **MCP tool spans** — `wrapMcpServerWithSentry` traces each tool call
- **D1 instrumentation** — automatic via `withSentry()`

Expected 4xx (`HTTPException` — a 401 from a bad token, a 403 from token
management) are logged at `warn` and deliberately **never** reach Sentry. Only
genuine 5xx are captured.

## Notes and gotchas

- **Durable Objects need separate instrumentation.** `apps/mcp` already wraps its
  Agent with `instrumentAgentWithSentry`; `withSentry()` on the outer handler
  does not initialise Sentry inside the DO context. Any new DO needs the same.
- **Source maps** are not uploaded, so production stack traces point at bundled
  output. Add `@sentry/cli` to the deploy step if you want readable frames.
- **Cloudflare Workers Logs retains 3 days (free) / 7 days (paid).** Sentry is
  what gives you history beyond that window — the two are complementary, not
  alternatives.
- **A Cloudflare-only setup is valid.** Leave `SENTRY_DSN` unset and you still get
  full structured logging; just confirm `observability.enabled` is set in each
  `wrangler.jsonc` or nothing is retained.
