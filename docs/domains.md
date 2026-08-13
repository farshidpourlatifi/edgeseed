# Domain Topology

Two supported shapes. The starter defaults to the simpler one, and moving
between them is a configuration change — no code edits.

|                                    | Single origin (default) | Split origin                |
| ---------------------------------- | ----------------------- | --------------------------- |
| Landing page                       | `example.com/`          | `example.com/`              |
| App (login, dashboard, API)        | `example.com/login`     | `app.example.com/login`     |
| `MARKETING_URL`                    | unset                   | `https://example.com`       |
| `BETTER_AUTH_URL`                  | `https://example.com`   | `https://app.example.com`   |
| Custom domains in `wrangler.jsonc` | one                     | two                         |
| OAuth callbacks to register        | one origin              | app origin only             |
| Hostnames the Worker answers on    | any that routes to it   | those two; the rest are 404 |

(Static assets are matched ahead of the Worker, so they answer on any hostname
in either shape — see "Why a third hostname is refused".)

Local development is always single-origin: `pnpm dev` serves everything on
`http://localhost:5173`, `MARKETING_URL` stays empty, and the split logic is
inert. You do not need a second hostname to work on the app.

---

## Single origin — the default

Nothing to configure. One Worker, one hostname, landing page at `/` and the
product behind `/login`. `MARKETING_URL` unset means `resolveOriginRequest()`
answers `serve` for every request and the middleware is a pass-through — no
redirects, and no opinion about which hostname a request arrived on.

```jsonc
// apps/web/wrangler.jsonc
"routes": [{ "pattern": "example.com", "custom_domain": true }],
```

```bash
wrangler secret put BETTER_AUTH_URL   # https://example.com
```

Choose this unless you have a reason not to. It is one DNS record, one OAuth
registration, and one cookie domain to reason about.

---

## Split origin

Worth it when the marketing site and the product genuinely diverge — a CMS, a
separate release cadence, a marketing team who should not be able to break the
app. It also buys a real security property: **the session cookie is scoped to
the app host and the marketing site can never read it.**

### 1. Both hostnames on the Worker

```jsonc
// apps/web/wrangler.jsonc
"routes": [
  { "pattern": "app.example.com", "custom_domain": true },
  { "pattern": "example.com", "custom_domain": true },
],
```

`custom_domain: true` makes `wrangler deploy` create the DNS record itself.
Do not pre-create an A/CNAME for either hostname — a manual record collides
with the one wrangler creates. Both zones must be on the same Cloudflare
account.

### 2. Environment

```bash
wrangler secret put BETTER_AUTH_URL   # https://app.example.com  — the APP origin
wrangler secret put MARKETING_URL     # https://example.com
```

**Both are required once `routes` declares two hostnames.** The split is driven
by `MARKETING_URL`, not by the route list: declare both hostnames and leave it
unset and the resolver serves every request where it arrived, so the app answers
`/login`, `/register`, `/dashboard` and `/api/auth` on the marketing origin too.
Nothing fails loudly — the guarantees below just do not hold.

This is the one part that stays a thing to remember, and deliberately so. A
Worker cannot read its own `routes` list at runtime, so the code cannot tell
"single origin" from "split origin that was never configured" — the two look
identical from inside. Setting `MARKETING_URL` is what **declares** the topology;
everything below is the code then enforcing it.

`MARKETING_URL` is not sensitive, so a `vars` entry looks tempting. Don't: that
block is shared with local dev, so the value reaches `pnpm dev` and, because
`localhost:5173` is then neither origin, bounces the local landing page to the
production marketing host. `ENVIRONMENT` is corrected with `--var` at deploy
time for exactly this reason. Use the secret. (And a `var` **shadows** a
same-named secret at deploy time, so never set both.)

### 3. What the middleware then does

`apps/web/server/origins.ts`, mounted before the auth middleware:

- an app path on the **marketing** origin → 302 to the app origin, path and
  query preserved
- `/` on the **app** origin → 302 to the marketing origin, so the landing page
  has one canonical URL
- a hostname that is **neither origin** → 404, for everything the Worker serves
- everything else is served where it arrived

App paths are an allowlist — `APP_PATH_PREFIXES` in that file, currently
`/login`, `/register`, `/forgot-password`, `/reset-password`, `/dashboard`,
`/api`. Add to it when you add a route that belongs to the product rather than
the marketing site.

Forgetting is not a cosmetic bug. An app route missing from this list is
**served** on the marketing origin instead of redirected, and the page's own
`POST /api/auth/...` then takes a 302 across the split — which downgrades to
GET and drops the body, so the form silently does nothing.

An **allowlist of things to move**, deliberately, not a denylist of things to
keep: the landing page's assets (`/assets/*`, favicons, images) are never
enumerated, so no future route can accidentally redirect them out from under
the page.

### 4. Why a third hostname is refused

Setting `MARKETING_URL` closes the set of hostnames this Worker will answer on.

The reason it needs closing: **`routes` and these two variables are independent
lists, and nothing reconciles them.** Adding a hostname to the Worker is a
one-line edit that no secret has to agree with. So a Worker is reachable on:

- any `custom_domain` in `routes` — including a third one added later for a
  vanity domain, a country TLD, or a hostname being migrated off
- any zone route added in the Cloudflare dashboard rather than in
  `wrangler.jsonc`, which the repo never sees at all
- `*.workers.dev` and per-version preview URLs, **when enabled**. Both are off
  here by inference — wrangler resolves `workers_dev` to `routes.length === 0`
  and `preview_urls` follows it — so declaring two routes turns both off unless
  someone sets them to `true`. Do not treat that as a guarantee: it is a default,
  reversible by one line, and preview URLs are a reasonable thing to want back.
- a legacy record still pointed at the account after a migration
- the same custom domain on one of Cloudflare's alternate HTTPS ports
  (2053, 2083, 2087, 2096, 8443) — a different origin, since `URL.host` carries
  the port

Served, every one of those carries `/login`, `/register` and `/api/auth`: the
full auth surface on a hostname that appears in no OAuth registration and in no
`BETTER_AUTH_URL`. That is also what breaks Better Auth's `trustedOrigins`,
which defaults to the `baseURL` origin alone (`docs/security-audit.md`).
Refusing them is what makes "auth runs on the app origin" structural rather than
a property of which DNS records happen to exist.

**It closes what the Worker serves, which is not the whole hostname.**
Cloudflare matches a static asset before invoking the Worker — `run_worker_first`
defaults to `false` — so `/assets/*`, the favicons and anything else under
`build/client` still answer 200 on a refused host. Those are public bytes,
identical on every origin, with no session and no auth surface, so the gap is
real but not a hole. Setting `run_worker_first` would close it and bill a Worker
invocation for every asset request on every origin, which is a bad trade for
files that are already public; the honest fix is to describe the boundary, which
is what this paragraph is.

**404, not 421 Misdirected Request.** 421 invites an HTTP/2 client to retry the
same request on a fresh connection, which can only produce the same answer. The
signal is the log line — `origin.refused`, at `warn`, with the host and path —
not the status code, because an unconfigured origin answering at all is a routes
or DNS mistake somebody needs to see.

**The refusal only arms in split mode.** With `MARKETING_URL` unset there is no
declared topology to enforce, so any hostname routed to the Worker is served —
which is what keeps `pnpm dev` working on both `localhost:5173` and
`127.0.0.1:5173`, and what keeps a single-origin clone deployable on
`workers.dev` before it owns a domain. Enforcing there would break the default
path, which is worse than the hole it closes.

### 5. OAuth callbacks

Register against the **app** origin only:

- `https://app.example.com/api/auth/callback/github`
- `https://app.example.com/api/auth/callback/google`

`/api` is an app path, so an OAuth callback that lands on the marketing origin
is redirected to the app origin — but the provider's registered URI must still
name the app origin, or the provider rejects the exchange before any redirect
happens.

---

## Why the middleware, rather than a Cloudflare Redirect Rule

The same split can be done with Redirect Rules in the Cloudflare dashboard, and
for a single deployment that is a reasonable choice — it runs at the edge and
costs nothing.

It is the wrong default for a _starter_. Dashboard rules exist nowhere in the
repository: nothing tests them, nothing documents them, and a clone inherits
none of them with no hint that they were ever needed. The middleware is
versioned, unit-tested including its failure modes, and travels with the code.

It also makes the security property structural instead of conventional. The
redirect happens before `authMiddleware` constructs anything, so auth code
cannot execute on the marketing origin even if a route is added carelessly.

---

## Failure modes

**Both variables name the same host.** Every rule would redirect a host to
itself — an infinite loop serving nothing. The resolver detects this and falls
back to single-origin behaviour rather than looping. Covered by a test; if you
see the split silently not working, this is the first thing to check.

That fallback is deliberately **whole**: it refuses nothing either. A marketing
apex still declared in `routes` matches neither origin in this state, so
enforcing would 404 the public landing page over one copy-pasted secret — and
`MARKETING_URL` set to a malformed value and `MARKETING_URL` set to the app's
own host are the same mistake. A self-contradictory topology has not been
declared, so there is none to enforce.

**A malformed URL in either variable.** Ignored, single-origin behaviour —
including the refusal, which needs both origins to compare against. A bad
binding should not take the site down one request at a time.

**A hostname 404s after switching to split mode.** Expected, and the point of
the guard: that hostname is neither `BETTER_AUTH_URL` nor `MARKETING_URL`. Look
for `origin.refused` in Workers Logs to see which host was asked for.

Before setting `MARKETING_URL`, list every hostname that reaches this Worker —
`routes` here, zone routes in the dashboard, `workers_dev`/`preview_urls` if
either is on — and check each one is named by one of the two variables. Anything
left over stops serving. If you point an uptime monitor or a smoke test at one
of those, move it to the app origin first; `pnpm check:deployed` requests
`/api/v1/health` on **every** target `wrangler deploy` reports, so a leftover
one fails the release on `HTTP 404` after the deploy has already landed. The fix
is to stop publishing that hostname, not to weaken the guard.

The marketing origin is unaffected: `/api/v1/health` there is an app path, so it
302s to the app origin and `fetch` follows it.

**The comparison is hostname and port, not scheme.** `http://app.example.com`
and `https://app.example.com` are one origin to this guard, so it does not turn
a plaintext request away. Cloudflare's zone-level **Always Use HTTPS** is the
setting for that, and it acts before the Worker ever runs — turn it on.

**A cross-boundary link without `reloadDocument`.** This is the one that will
catch you, because it fails silently and only in split mode.

React Router is a client-side router. Once the landing page has hydrated, a
plain `<Link to="/login">` navigates **without any HTTP request**, so
`server/origins.ts` never runs. The login page then renders on the _marketing_
origin, and its `POST /api/auth/sign-in/email` goes there too — where the
middleware answers with a 302. A 302 on POST downgrades to GET, so sign-in
fails outright, and any cookie that did get set would be scoped to the wrong
host.

The fix is `reloadDocument` on the link, which renders a plain anchor and
forces a document request the middleware can act on:

```tsx
<Link reloadDocument to="/login">
  Sign In
</Link>
```

**Any link crossing the marketing/app boundary needs it** — currently the
landing header and hero (`→ /login`, `/register`) and the logo on the
login/register pages (`→ /`). Links that stay on one side (dashboard → dashboard
settings, login ↔ register) must _not_ have it; they would lose client-side
navigation for nothing.

It costs one document load at the boundary in single-origin mode, where a
client-side transition would have done. That is the deliberate trade: correct
in both topologies, with no origin configuration reaching the client bundle.

**`init:product` strips `routes`** from a clone, because they name hostnames the
clone does not own. It does not touch `MARKETING_URL` — that lives in
environment configuration, which a clone sets up for itself anyway.
