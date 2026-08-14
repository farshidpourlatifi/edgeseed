# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting, which is enabled on this repository:

**[Report a vulnerability →](https://github.com/farshidpourlatifi/edgeseed/security/advisories/new)**

That opens a private advisory visible only to you and the maintainer. If you cannot use
it, open a public issue containing **no detail** — just ask for a private channel — and
you will be invited to one.

Useful things to include, as far as you have them: the affected version or commit, the
request or steps that trigger it, what an attacker gains, and whether a live deployment
is affected or only the starter's code. A correlation id from an error response
(`x-request-id`) helps if you hit it against the live demo.

### What to expect

This is a single-maintainer open-source project with no bounty program, so timelines are
best-effort rather than contractual: acknowledgement within about a week, and a fix or a
written decision not to fix once the report is understood. You will be credited in the
advisory unless you ask not to be.

## Supported versions

Only the **latest release** receives fixes. The project is pre-1.0 and there are no
maintenance branches — upgrade to the newest tag rather than expecting a backport.

| Version        | Supported |
| -------------- | --------- |
| Latest release | ✅        |
| Anything older | ❌        |

Adopters merge starter fixes into their own repository via `git merge upstream/main`
(see [docs/starter-as-upstream.md](./docs/starter-as-upstream.md)). A vulnerability fixed
here does not reach your deployment until you merge and deploy it.

## Scope

**In scope:** the code in this repository, its default configuration, and the live demo at
`app.edgeseed.dev`.

**Out of scope:** vulnerabilities in a downstream product built on this starter that stem
from that product's own code or configuration; findings that require a misconfiguration
the documentation explicitly warns against (for example deploying with a Worker secret
never set — the app fails closed by design); and issues in third-party dependencies with
no exploitable path through this code, which belong upstream.

## Already-known risks

Please check [`docs/security-audit.md`](./docs/security-audit.md) before reporting.
It records the audit history, and a small number of items are **known and open** rather
than undiscovered — most notably that OAuth provider tokens are stored in plaintext and
that expired rows in the `verification` table are never purged (#12). A report that
re-describes a documented open item is still welcome, but it will be linked to the
existing entry rather than treated as new.

The threat model, guard-by-guard, is in [`docs/security-plan.md`](./docs/security-plan.md).

## Leaked credentials

If you find a live credential in this repository's history, treat it as compromised the
moment it was committed — **report it and rotate it at the provider first**; cleaning
history without rotating is theater. The procedure is in
[`docs/secret-scanning.md`](./docs/secret-scanning.md).

Secret scanning and push protection are enabled on this repository, and a gitleaks scan
runs both as a pre-commit hook and over full history in CI.

## What this project does not have

Stated so you can calibrate rather than assume:

- **No automated dependency patching.** Dependabot security updates are currently
  disabled; dependency bumps are manual.
- **No security releases channel.** Fixes ship in the normal tag-triggered release flow.
- **No bounty.**
