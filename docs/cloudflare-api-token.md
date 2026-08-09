# Cloudflare API token for CI

The release workflow (`.github/workflows/release.yml`) deploys with
`wrangler deploy`, which needs credentials the runner does not have. Locally
wrangler uses your browser OAuth login; CI has no browser, so it authenticates
with an API token instead.

You need exactly two GitHub Actions secrets:

| Secret                  | What                                     |
| ----------------------- | ---------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | The token created below                  |
| `CLOUDFLARE_ACCOUNT_ID` | The account the Workers live in (step 5) |

Both go on a **`production` environment**, not on the repository — step 4.

Nothing else. Worker secrets (`BETTER_AUTH_SECRET`, OAuth credentials,
`RESEND_API_KEY`) ship through `wrangler secret put` on a separate channel and
never touch GitHub — see the Secrets section of `AGENTS.md`.

## 1. Account token, not user token

Cloudflare has two kinds and they live in different places:

| Kind        | Where                           | Tied to                                 |
| ----------- | ------------------------------- | --------------------------------------- |
| **Account** | Manage Account → **API Tokens** | The account. Survives a person leaving. |
| User        | My Profile → API Tokens         | Your login. Dies with the user.         |

**Use an account token.** This one authenticates a pipeline, not a person: a
user token would take production deploys down the day that user's access is
removed, and it carries that user's full reach rather than the deploy's.

The page reading _"Account API tokens — Manage account API tokens. User API
tokens are found in the 'My Profile' section"_ is the right one. Click
**Create Token**.

The two flows are not the same screen. The user flow offers ready-made
templates; the account flow gives you a policy builder and no templates. Most
Workers CI guides — Cloudflare's included — describe the template, so they are
quietly documenting the _user_ token. Step 2 covers what to do on the screen
you actually get.

## 2. Pick the permissions

**There is no "Edit Cloudflare Workers" template on this screen.** Templates
belong to the _user_ token flow; the account token flow drops you straight into
a policy builder — a search box, thirteen collapsed permission groups
(`Developer Platform`, `Account & Billing`, `DNS & Zones`, …), and an
**Add policy** button. Expect to choose permissions yourself.

Use the **search box** rather than expanding groups. The grouping is Cloudflare's
and it gets reshuffled; the permission names are stable.

This needs **two policies**, because a policy's resource scope decides which
permissions its search box will even offer.

The workflow deploys **only the web Worker**. Grant for that, not for the repo
in general:

**Policy 1 — resource `Entire Account`:**

| Search for         | Level    | Why this repo needs it |
| ------------------ | -------- | ---------------------- |
| `Workers Scripts`  | **Edit** | Upload the Worker      |
| `D1`               | **Edit** | The `DB` binding       |
| `Account Settings` | **Read** | Resolve the account    |

**Not `Workers KV Storage`.** `apps/web/wrangler.jsonc` declares no
`kv_namespaces`, and a deploy prints its bindings — `DB`, three rate limits,
`ENVIRONMENT`, no KV. `OAUTH_KV` belongs to the **MCP** Worker, which this
workflow does not deploy. Add it only if that changes.

**Policy 2 — `Add policy`, resource set to the zone —** only if you keep it:

| Search for       | Level    | Why it might be needed                  |
| ---------------- | -------- | --------------------------------------- |
| `Workers Routes` | **Edit** | The `custom_domain` routes              |
| `Zone`           | **Read** | Resolve the zone those routes belong to |

**Searching for a zone permission inside an account-scoped policy returns "No
permission groups found."** That is the resource scope filtering the list, not
the permission being unavailable to account tokens — an easy misread, since the
message says nothing about scope. Add the second policy first, then search.

The summary screen confirms it worked: two blocks, one reading
_"Entire <account>"_ and one _"…zones in <account>"_.

**Never `Select all 273 permissions`.** That is an account-takeover credential,
and it would be sitting in GitHub.

Name it for the job, not the person: `github-actions-deploy` beats the
auto-generated `curly-lake-a0cc`. That name is what you read in the audit log a
year from now, and the random default tells you nothing.

> **Start without policy 2, and add it only if a deploy fails.** `routes` here
> are `custom_domain: true`, and Workers Custom Domains attach through
> **`PUT /accounts/{account_id}/workers/domains`** — an _account_-scoped
> endpoint. The zone-scoped `/zones/{zone_id}/workers/routes` API serves the
> other route form, `pattern` + `zone_name`.
>
> Cloudflare's reference page for that endpoint lists **no** required
> permissions, so "Workers Scripts is enough" cannot be taken on their
> authority — it is checked, not cited. And a deploy that succeeds with both
> policies present proves only that the pair works, never which half carried
> it. One experiment settles it: create the token with policy 1 alone,
> redeploy, and see whether both custom domains still attach. Redeploying the
> same commit is harmless, so this is cheap — and least privilege says do it
> before the token goes anywhere near CI.
>
> A product using `pattern`/`zone_name` routes needs the zone-scoped API and
> keeps policy 2 regardless.

## 3. Scope it down

Every one of these defaults to the wide answer. Check them on the summary screen
before creating — it spells out what you actually granted.

- **Policy 1 resource** → the account holding these Workers.
- **Policy 2 resource** → **specific zones**, not `All zones`. The zone picker
  defaults to all of them, and the summary then reads _"All zones in
  <account>"_ — a leaked token could repoint every domain on the account, not
  just this product's. For this repo that is `edgeseed.dev` and nothing else.
- **Token expiration** → defaults to **No expiration**. Change it. `1 year` is
  the pragmatic pick: an expired token fails a deploy loudly, a never-expiring
  one leaks quietly and stays valid forever. Diary the renewal — the failure
  lands on a tagged release, which is a bad moment to be surprised.
- **Client IP address filtering** → leave **empty** for GitHub-hosted runners.
  Their egress IPs are a large, rotating range, so pinning it breaks deploys at
  random. Only set this if you move to self-hosted runners with a fixed IP.

## 4. Copy it once

The value is shown **exactly once** and is unrecoverable afterwards. Modern
tokens carry a scannable prefix — that is what lets gitleaks and Cloudflare's
own detection catch one that reaches a repository. An **account** token starts
`cfat_`; `cfut_` is the **user** token form, and it is the only one Cloudflare's
own "create a token" page names, so a guide showing `cfut_` is describing the
other flow.

Go straight to GitHub without a detour through a file, a note, or a chat
message. **Store it on the `production` environment, not on the repository** —
repository secrets are readable by every workflow in the repo, while an
environment secret is readable only by a job that names that environment, which
is the `deploy` job and nothing else:

**Repo → Settings → Environments → `production` → Add environment secret**
(create the environment if it does not exist)

- Name: `CLOUDFLARE_API_TOKEN`
- Value: the token

While you are there, protect it: set **Deployment branches and tags** to the
`v*` tag pattern, so a workflow run from some other ref cannot reach these
credentials at all. Required reviewers are optional and turn every release into
a manual approval — worth it once the product has users.

If you lose it before saving, delete the token and create another. Do not
"temporarily" paste it anywhere — `docs/secret-scanning.md` covers why a
credential that has been written down is already a rotation job.

## 5. Account ID

Dashboard → **Workers & Pages** → any Worker → the **Account ID** in the right
sidebar. Or from the URL: `dash.cloudflare.com/<account-id>/...`.

Add it as a second **environment** secret on `production`, named
`CLOUDFLARE_ACCOUNT_ID`, alongside the token.

It is not a credential — it identifies, it does not authorise — but it goes in
Secrets rather than Variables because the audit already flags committed account
identifiers as avoidable exposure ("Real account identifiers committed to a
public-facing starter", `docs/security-audit.md`): harmless alone, but they name
a concrete production target next to everything else an attacker collects.

## 6. Verify

The first real use of this token would otherwise be a tagged release — a bad
moment to discover a missing permission, since the tag is already pushed. Prove
it from your machine first, with the same credentials CI will use.

Start with the cheap check:

```bash
CLOUDFLARE_API_TOKEN='cfat_...' pnpm --filter @starter/web exec wrangler whoami
```

That prints the account and the token's permission list, so a typo or a missing
`Workers Scripts: Edit` surfaces immediately.

**Not `npx wrangler`.** It is a devDependency of `apps/web` and `apps/mcp`, not
of the root, so there is no `wrangler` in the root `node_modules/.bin` — `npx`
finds nothing, falls through to `PATH`, and reports
`sh: wrangler: command not found`, which reads like a missing install rather
than a workspace lookup. Go through `pnpm --filter`, the same way `deploy:web`
does.

**`wrangler deploy --dry-run` proves nothing here.** It builds the bundle
locally and never calls the API, so it passes with an invalid token. The only
thing that tests the permissions — including whether an account token can
attach the custom domains (step 2) — is a real deploy:

```bash
CLOUDFLARE_API_TOKEN='cfat_...' CLOUDFLARE_ACCOUNT_ID='...' \
  pnpm --filter @starter/web exec wrangler deploy --var ENVIRONMENT:production
```

Deploying the current commit twice is harmless: same code, a new Cloudflare
version id, no user-visible change. Cheap insurance against finding out during
a release.

Unset those variables afterwards, or run them in a shell you close — an
exported token outlives the command that needed it.

## Rotation, and what a leak costs

This token can deploy code to your production Workers. Treat it accordingly.

- **A leaked token is revoked first, cleaned second.** Delete it in the
  dashboard (Manage Account → API Tokens → **Delete**), then create a
  replacement, then deal with wherever it leaked. Rewriting git history without
  revoking is theatre — the credential was compromised the moment it was
  written somewhere it should not have been. Same rule as
  `docs/secret-scanning.md`.
- **Rotation is two steps, no downtime**: create the new token, update the
  GitHub secret, then delete the old one. Deploys read the secret at run time,
  so nothing needs redeploying.
- Revoking it stops future deploys. It does **not** roll back what is live, and
  it does not touch Worker secrets — those live in Cloudflare, keyed by Worker
  name.

## What CI deliberately does not do

Remote D1 migrations are **not** run by the workflow (see `AGENTS.md` § Schema
changes: additive migration before the tag, destructive cleanup in a later
release). You run `wrangler d1 migrations apply --remote` yourself.

Be clear about what enforces that: it is the **workflow**, not the token. With
`D1: Edit` granted the token could drop a table if a step told it to; the
boundary is that no step does.

`D1: Edit` is in the table above for the `DB` **binding**, not for migrations —
the Worker declares `d1_databases`, and the upload carries that binding. Whether
the upload actually requires the permission is untested, which makes it the same
kind of question as policy 2, and it settles the same way: drop it, redeploy the
same commit, and see. If the deploy still succeeds, the release pipeline
genuinely cannot touch your data, and that is a boundary worth having rather
than a convention worth documenting.

Do not assume either direction because it sounds right — Cloudflare documents no
permission list for these endpoints, so the deploy is the only oracle.
