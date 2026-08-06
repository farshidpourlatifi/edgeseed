# Cloudflare costs and guardrails

Last verified: 2026-08-04. Prices are in USD and exclude tax and currency-conversion costs.

This is a code-based estimate, not a quote from Cloudflare. Cloudflare can change pricing, so
recheck the linked official pages before a production launch or when this file is more than three
months old.

## Short answer

The database is unlikely to be the expensive part of this starter.

- Cloudflare D1 has no per-database, per-instance, or idle compute charge. It scales to zero and has
  no data-transfer/egress fee.
- The current web app can run for **$0/month** on the Workers Free plan while it stays within the
  daily Workers and D1 limits. The free limits are hard service limits: requests or queries fail
  after a limit is reached instead of creating an overage bill.
- The Workers Paid plan has a **$5/month account minimum**, not $5 for each Worker or each D1
  database. Its included usage is normally enough for a small production app.
- D1 reads are cheap on Paid. Writes, Worker request volume, and Worker CPU are the metrics most
  likely to matter. Unindexed reads are primarily a performance problem until they become very
  large.
- Static asset requests and asset storage are free and unlimited. This app uses SSR, however, so
  HTML page requests execute the web Worker unless a route is explicitly prerendered.

The safest experiment profile is therefore: use the Free plan, deploy only the web Worker, create a
fresh D1 database for the project, and leave the MCP Worker undeployed until it is needed. This is a
real $0 billing cap, with the tradeoff that the app fails closed if it exceeds a daily quota.

## What this repository actually uses

| Resource             | Evidence                                                      | Current cost surface                                                  |
| -------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| Web Worker           | `apps/web/worker.ts` and `apps/web/wrangler.jsonc`            | Dynamic requests and CPU time                                         |
| Worker static assets | `assets.directory` in `apps/web/wrangler.jsonc`               | $0 for asset requests and storage                                     |
| D1                   | `DB` binding in both Wrangler files; Drizzle in `packages/db` | Rows read, rows written, and stored GB                                |
| MCP Worker           | `apps/mcp/src/index.ts`                                       | Worker requests; conditionally Durable Objects, described below       |
| Better Auth          | `packages/auth`                                               | Uses D1 and Worker CPU; no separate managed-service fee in this code  |
| GitHub/Google OAuth  | Optional environment variables                                | No paid API is configured by the repo; provider terms remain external |

The code does **not** currently configure KV, R2, Queues, Workflows, Cron Triggers, Workers AI,
Vectorize, Hyperdrive, Browser Rendering, Images, Analytics Engine, Containers, or service bindings.
Their current cost contribution is $0. A comment mentioning “D1, KV, etc.” is descriptive, not a
deployed binding.

Domain registration, paid Cloudflare zone plans, transactional email/SMS, payment processing, and
third-party APIs are also outside this repository and are not included in the estimates.

### Important deployment findings

1. **Both** `apps/web/wrangler.jsonc` and `apps/mcp/wrangler.jsonc` contain a specific D1 database
   ID, and they must stay identical — `apps/mcp` runs its own Better Auth instance against
   `apps/web`'s users. Every project copied from this starter must create its own database and set
   the new id in both files. Reusing the checked-in ID would mix project data, security boundaries,
   and usage. `pnpm init:product` resets both to `"local"`.
2. `StarterMcpAgent` is backed by a Durable Object. The binding (`MCP_OBJECT`) and its
   `new_sqlite_classes` migration now exist, so the Worker is deployable — but Durable Object usage
   must be included in the MCP cost model. A stateless `createMcpHandler` would be cheaper if
   session state is never needed.
3. `apps/mcp` still ships `OAUTH_KV` with `id: "local"`. Run `wrangler kv namespace create OAUTH_KV`
   and set the real id before deploying, or the OAuth grant store has nowhere to live.

**Resolved since this document was written (2026-08-05):**

- The MCP app now typecheck**s** — `agents` is declared and locked, and repository-wide
  `pnpm typecheck` passes. `pnpm check:boot` additionally proves both built Workers start.
- `/mcp` is no longer unauthenticated: it sits behind OAuth 2.1 and rejects requests
  without a bearer token (security-audit #8). The `/sse` route was removed — it never actually
  served SSE (see the comment in `apps/mcp/src/index.ts`). The abuse and cost risk from future
  database tools is correspondingly reduced, though an authenticated caller can still drive usage.

These findings mean the base cost table below represents the web Worker and D1. Conditional MCP
costs are listed separately.

## Current Cloudflare price sheet

Official pricing checked on the date at the top of this file:

### Workers and static assets

| Metric                   |                        Workers Free |                                               Workers Paid / Standard |
| ------------------------ | ----------------------------------: | --------------------------------------------------------------------: |
| Account minimum          |                                  $0 |                                                              $5/month |
| Dynamic Worker requests  |                         100,000/day |                         10 million/month included, then $0.30/million |
| CPU                      |        10 ms maximum per invocation |           30 million CPU-ms/month included, then $0.02/million CPU-ms |
| Static asset requests    |                  Free and unlimited |                                                    Free and unlimited |
| Static asset storage     |                  No additional cost |                                                    No additional cost |
| Data transfer/egress     |                           No charge |                                                             No charge |
| Workers Logs, if enabled | 200,000 events/day, 3-day retention | 20 million events/month included, then $0.60/million; 7-day retention |

The Paid allowance and $5 minimum are account-wide. Adding the second Worker does not create a
second subscription, but requests and CPU from both Workers consume the same allowance.

Only requests that invoke Worker code count as dynamic requests. The built JS, CSS, images, and
other matching static files are free. Because `apps/web/react-router.config.ts` sets `ssr: true`,
the landing, login, registration, dashboard, API, and other HTML/data requests currently invoke the
Worker. The asset files those pages load do not.

Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/),
and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

### D1

| Metric                           |          Workers Free |                                   Workers Paid |
| -------------------------------- | --------------------: | ---------------------------------------------: |
| Rows read                        |         5 million/day | 25 billion/month included, then $0.001/million |
| Rows written                     |           100,000/day |  50 million/month included, then $1.00/million |
| Stored data                      | 5 GB/account included |             5 GB included, then $0.75/GB-month |
| Maximum size of one database     |                500 MB |                                          10 GB |
| Databases per account            |                    10 |                                         50,000 |
| D1 queries per Worker invocation |                    50 |                                          1,000 |
| Egress                           |                    $0 |                                             $0 |

Free limits reset at 00:00 UTC. When a Free read, write, or storage limit is hit, D1 operations fail;
there is no paid overage. Paid usage beyond the included amounts is billed.

D1 meters rows scanned, not just rows returned. An indexed point lookup normally reads very few
rows; a query filtering on an unindexed field can read the entire table. Inserts, updates, and
deletes count as written rows. Updating an indexed column also writes the index, so one logical
write can produce multiple metered row writes. Migrations, imports, dashboard queries, and Wrangler
commands also count.

Sources: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

### Conditional Durable Object cost for the legacy MCP Worker

`McpAgent` automatically uses a SQLite-backed Durable Object and supports hibernation. If it is
properly configured and deployed in its current stateful form, the following additional metrics
apply:

| Metric                  |            Free |                                                  Paid |
| ----------------------- | --------------: | ----------------------------------------------------: |
| Durable Object requests |     100,000/day |          1 million/month included, then $0.15/million |
| Active duration         | 13,000 GB-s/day | 400,000 GB-s/month included, then $12.50/million GB-s |
| SQLite rows read        |   5 million/day |        25 billion/month included, then $0.001/million |
| SQLite rows written     |     100,000/day |         50 million/month included, then $1.00/million |
| SQLite stored data      |      5 GB total |              5 GB-month included, then $0.20/GB-month |

The object is allocated 128 MB for duration billing. Hibernating idle connections do not consume
duration, while non-hibernating live connections can make duration the dominant MCP cost. A
stateless MCP handler avoids this entire Durable Object category when session state is not needed.

Sources: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[`McpAgent` behavior](https://developers.cloudflare.com/agents/model-context-protocol/apis/agent-api/),
and [stateless MCP handlers](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/).

## How this schema creates D1 usage

The initial schema has seven auth/organization tables. Normal usage is small:

- Registration typically reads existing identity data and writes a user, credential account, and
  session. Unique indexes on user email and session token add index writes.
- Sign-in reads user/account data and writes or updates session data.
- A dashboard request performs a session lookup and lists organizations.
- Organization creation/invitations add organization, member, and invitation rows.
- Session expiry or deletion creates writes because deletes are billed as row writes.

Exact Better Auth query counts can change by library version. Treat these descriptions as the shape
of the workload, then use D1's `rows_read` and `rows_written` metrics for real measurements.

### Index audit

Existing useful indexes are:

- primary keys on every table;
- unique `user.email`;
- unique `session.token`;
- unique `organization.slug`.

Likely high-value missing indexes, to validate against generated Better Auth SQL, are:

- `member(userId)` for the dashboard's `listOrganizations` call;
- `member(organizationId)` and preferably a unique `(organizationId, userId)` pair;
- `account(userId)` and a provider/account lookup index such as `(providerId, accountId)`;
- `session(userId)` and `session(expiresAt)` for user-session and cleanup operations;
- `verification(identifier)` and possibly `verification(expiresAt)`;
- `invitation(organizationId)`, `invitation(email)`, and possibly `invitation(expiresAt)`.

The most immediate risk is `member(userId)`: the dashboard loader lists organizations on each
dashboard navigation, and without an index that query can scan the membership table. Add indexes
based on observed queries rather than indexing every column—indexes reduce reads but add storage
and row writes.

## Monthly estimates

These examples aggregate both Workers and all D1 access in one Cloudflare account. They exclude
Durable Objects by assuming the MCP app is disabled or migrated to the stateless handler.

Assumptions:

- all request counts below are dynamic Worker invocations; static files are excluded because they
  are free;
- average CPU is 5 ms per invocation;
- D1 usage is illustrative and already includes index maintenance;
- traffic is distributed through the month; a daily Free quota can still fail during a spike;
- no paid log overage or other Cloudflare products;
- storage is the account-wide D1 total.

| Profile    | Dynamic requests/mo | D1 reads/mo | D1 writes/mo | D1 storage | Free outcome                         | Paid estimate |
| ---------- | ------------------: | ----------: | -----------: | ---------: | ------------------------------------ | ------------: |
| Prototype  |             100,000 |   2 million |      100,000 |     0.1 GB | $0, comfortably inside limits        |         $5.00 |
| Small SaaS |           1 million |  20 million |    2 million |       1 GB | $0 if daily peaks stay within limits |         $5.00 |
| Growing    |          10 million | 200 million |   20 million |       4 GB | Not reliable on Free                 |         $5.40 |
| Scale      |          50 million |   1 billion |  100 million |       8 GB | Exceeds Free limits                  |        $73.65 |

The Paid “Scale” estimate is:

```text
$5.00 account minimum
+ $12.00 Worker requests  = (50m - 10m) × $0.30/m
+  $4.40 Worker CPU       = (250m CPU-ms - 30m) × $0.02/m
+  $0.00 D1 reads         = below 25b included
+ $50.00 D1 writes        = (100m - 50m) × $1.00/m
+  $2.25 D1 storage       = (8 GB - 5 GB) × $0.75
= $73.65/month before tax
```

This shows why write amplification and abuse controls matter more than ordinary indexed D1 reads.
For contrast, if those 50 million requests each scanned 1,000 rows, they would read 50 billion
rows. The additional D1 read charge would be about $25/month, while performance and single-database
throughput would probably become a concern first.

### Calculator

For a Paid account, before Durable Objects, logs, tax, and other products:

```text
worker_request_cost = max(0, dynamic_requests - 10,000,000) / 1,000,000 × $0.30
worker_cpu_cost     = max(0, total_cpu_ms - 30,000,000) / 1,000,000 × $0.02
d1_read_cost        = max(0, rows_read - 25,000,000,000) / 1,000,000 × $0.001
d1_write_cost       = max(0, rows_written - 50,000,000) / 1,000,000 × $1.00
d1_storage_cost     = max(0, stored_gb - 5) × $0.75

estimated_total = $5 minimum + the overages above
```

The $5 is a minimum account charge, not $5 plus another fixed D1 fee. Confirm how Cloudflare
presents any included-credit adjustments on the actual account invoice.

## Cost controls, in priority order

### 1. Choose an intentional billing mode

For prototypes, remain on Workers Free. It is the only simple hard monthly cost cap: $0, followed by
service errors instead of overage billing. Move to Paid when traffic spikes make the daily limits an
availability risk. On Paid, Cloudflare budget alerts do **not** stop usage.

For multiple starter-based projects, remember that Free daily limits and Paid monthly allowances
are shared by the Cloudflare account. Create separate accounts only if separate quotas, invoices, or
failure domains are genuinely required; separate D1 databases within one account do not add a fixed
fee.

### 2. Do not deploy unused entry points

Leave `starter-mcp` undeployed until it provides a needed tool. Before deployment:

- consider the stateless handler unless durable session state is a requirement — the Durable Object
  is configured and working, but it is the more expensive shape;
- create the real `OAUTH_KV` namespace (`wrangler kv namespace create OAUTH_KV`) and replace the
  `"local"` placeholder id — the OAuth grant store has nowhere to live otherwise;
- set `database_id` to the same production database as `apps/web`, never a separate one;
- monitor Durable Object duration, request, and storage metrics, which the OAuth session state now
  contributes to.

Authentication is no longer a prerequisite to add — `/mcp` is behind OAuth 2.1 and
rejects unauthenticated requests.

Also delete old Worker deployments, D1 databases, and environments when a project is retired. D1
scales to zero, but old data still consumes storage and free-plan database slots.

### 3. Add account alerts

On Pay-as-you-go accounts, configure budget alerts at thresholds appropriate to the project. A
reasonable starter set is $5, $10, and $25:

1. Cloudflare dashboard → **Manage Account** → **Billing** → **Billable Usage**.
2. Create budget alerts and add more than one recipient.
3. Also enable product usage notifications for Workers where the account plan supports them.

Alerts are informational and can arrive after usage has occurred. They are not a kill switch.

Source: [Cloudflare budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)
and [usage-based billing](https://developers.cloudflare.com/billing/understand/usage-based-billing/).

### 4. Cap per-request CPU on Paid

After measuring legitimate p99 CPU, add a `limits` block to each Paid Worker. Example starting
points—not universal values—are 50 ms for the web Worker and 100 ms for a stateless MCP Worker:

```jsonc
{
  "limits": {
    "cpu_ms": 50,
    "subrequests": 50,
  },
}
```

This terminates pathological individual invocations. It does not impose a monthly dollar cap or
limit the number of invocations. Keep enough headroom for password hashing and SSR. Wrangler CPU
limits apply to the Standard usage model and are enforced on Cloudflare, not local development.

Source: [Wrangler runtime limits](https://developers.cloudflare.com/workers/wrangler/configuration/#limits).

### 5. Stop abuse before expensive application work

- Protect `/api/auth/*` and `/mcp` with appropriate rate limits. Cloudflare's Free zone plan
  includes one IP-based rate-limiting rule with restricted fields and 10-second windows; tune it
  from observed legitimate traffic.
- Add free Cloudflare Turnstile verification to registration and other account-creation endpoints.
- Require MCP OAuth, Cloudflare Access, or an application token before exposing tools.
- Put per-user/per-organization quotas on write-heavy product actions.
- Reject oversized inputs and bound collection sizes before executing D1 queries.
- Use idempotency keys for retried create/write operations.

Sources: [rate-limiting availability](https://developers.cloudflare.com/waf/rate-limiting-rules/)
and [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/).

### 6. Keep D1 queries bounded

- Add and validate the indexes from the audit above.
- Paginate every list and enforce a maximum page size.
- Select only required columns and avoid `SELECT *` on growing tables.
- Do not filter or sort large tables by unindexed columns.
- Batch related statements for latency/atomicity, while remembering that every affected row is
  still billed.
- Cap per-tenant record creation and retain only data the product needs.
- Index expiry columns before cleanup jobs. Run cleanup at a sensible interval rather than on every
  request; deletes count as writes.
- For a successful large product, plan tenant sharding before the shared database approaches the
  hard 10 GB per-database limit or becomes a throughput bottleneck.

### 7. Make public pages static where practical

The landing, login, and registration shells contain no server loader and are candidates for React
Router prerendering. Serving their HTML as matching Worker static assets makes those requests free,
while auth POSTs and dashboard pages remain dynamic. Test routing carefully so a `run_worker_first`
or fallback configuration does not turn static paths back into Worker invocations.

Worker Cache can lower CPU on cache hits, but under Standard pricing cached requests routed through
Worker code still count as Worker requests. Prefer true static assets for public immutable content.

### 8. Measure before extrapolating

At least weekly during launch, inspect:

- Workers & Pages → account usage: dynamic requests and CPU time by Worker;
- D1 → `starter-db` → Metrics → Row Metrics: rows read, rows written, and database size;
- Billing → Billable Usage: current cost by product;
- Durable Object metrics, only if the stateful MCP design is retained;
- Workers Logs usage, only if observability is enabled.

Establish a baseline with a short load test that exercises registration, login, dashboard load,
organization switching, and any new write-heavy route. Divide measured totals by successful user
journeys and update the scenario assumptions in this file.

## Per-project setup checklist

Use this every time the starter is copied:

- [ ] Create a new D1 database; update every production/staging binding to its new ID.
- [ ] Do not commit real secrets; set them with Wrangler/Cloudflare secrets.
- [ ] Decide Free ($0 hard cap) versus Paid ($5 account minimum plus overages).
- [ ] Confirm whether the account's included quotas are already consumed by other projects.
- [ ] Deploy only the Workers the project uses.
- [ ] Keep MCP stateless unless persistent protocol session state is required.
- [ ] Authenticate and rate-limit public auth, API, and MCP endpoints.
- [ ] Add Turnstile to account creation before public launch.
- [ ] Add missing D1 indexes based on real query plans/row metrics.
- [ ] Add pagination and per-user/per-tenant write quotas.
- [ ] On Paid, set measured CPU/subrequest limits in each Wrangler file.
- [ ] Create budget alerts and usage notifications.
- [ ] Record expected monthly dynamic requests, CPU ms, D1 rows read/written, and storage.
- [ ] Recheck official pricing and this estimate before launch.

## Decision guide

| Situation                                        | Recommended plan/action                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| Personal experiment or private demo              | Workers Free; web only; $0 hard cost cap                               |
| Public beta with unpredictable spikes            | Paid for reliability; alerts, rate limits, CPU caps                    |
| MCP is not a product requirement                 | Do not deploy it                                                       |
| MCP tools are stateless request/response calls   | Use `createMcpHandler`; no Durable Object                              |
| MCP genuinely needs durable sessions/push/replay | Keep a stateful design and budget/monitor Durable Objects              |
| Free D1 approaches 500 MB                        | Upgrade or shard before hitting the per-database hard limit            |
| Paid D1 approaches 10 GB or query saturation     | Split by tenant/entity; the per-database 10 GB limit cannot be raised  |
| Writes approach 50 million/month                 | Audit write amplification, session churn, retries, and retention first |
