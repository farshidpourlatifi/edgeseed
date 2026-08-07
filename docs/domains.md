# Domain Topology

Two supported shapes. The starter defaults to the simpler one, and moving
between them is a configuration change — no code edits.

|                                    | Single origin (default) | Split origin              |
| ---------------------------------- | ----------------------- | ------------------------- |
| Landing page                       | `example.com/`          | `example.com/`            |
| App (login, dashboard, API)        | `example.com/login`     | `app.example.com/login`   |
| `MARKETING_URL`                    | unset                   | `https://example.com`     |
| `BETTER_AUTH_URL`                  | `https://example.com`   | `https://app.example.com` |
| Custom domains in `wrangler.jsonc` | one                     | two                       |
| OAuth callbacks to register        | one origin              | app origin only           |

Local development is always single-origin: `pnpm dev` serves everything on
`http://localhost:5173`, `MARKETING_URL` stays empty, and the split logic is
inert. You do not need a second hostname to work on the app.

---

## Single origin — the default

Nothing to configure. One Worker, one hostname, landing page at `/` and the
product behind `/login`. `MARKETING_URL` unset means
`resolveOriginRedirect()` returns `null` for every request and the middleware
is a pass-through.

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

`MARKETING_URL` is not sensitive, so it can be a `vars` entry in
`wrangler.jsonc` instead. A `var` **shadows** a same-named secret at deploy
time — pick one place, not both.

### 3. What the middleware then does

`apps/web/server/origins.ts`, mounted before the auth middleware:

- an app path on the **marketing** origin → 302 to the app origin, path and
  query preserved
- `/` on the **app** origin → 302 to the marketing origin, so the landing page
  has one canonical URL
- everything else is served where it arrived

App paths are an allowlist — `APP_PATH_PREFIXES` in that file, currently
`/login`, `/register`, `/dashboard`, `/api`. Add to it when you add a route
that belongs to the product rather than the marketing site.

An **allowlist of things to move**, deliberately, not a denylist of things to
keep: the landing page's assets (`/assets/*`, favicons, images) are never
enumerated, so no future route can accidentally redirect them out from under
the page.

### 4. OAuth callbacks

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

**A malformed URL in either variable.** Ignored, single-origin behaviour. A bad
binding should not take the site down per request.

**The landing page's own links.** `Sign in` and `Get started` use relative
paths, so from the marketing origin they take one redirect hop to the app.
Correct, just not free. A product that cares can pass the app origin through the
root loader and link absolutely.

**`init:product` strips `routes`** from a clone, because they name hostnames the
clone does not own. It does not touch `MARKETING_URL` — that lives in
environment configuration, which a clone sets up for itself anyway.
