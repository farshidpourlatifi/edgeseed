# Secret Scanning with Gitleaks

[Gitleaks](https://github.com/gitleaks/gitleaks) scans git history and staged
changes for committed credentials. It runs at three layers in this repo, so a
secret has to slip past all of them to land on a remote:

| Layer                                             | When                        | What it scans            |
| ------------------------------------------------- | --------------------------- | ------------------------ |
| Pre-commit hook (`.githooks/pre-commit`)          | Every `git commit`          | Staged changes only      |
| GitHub Actions (`.github/workflows/gitleaks.yml`) | Every PR and push to `main` | Full history             |
| Manual scan                                       | On demand                   | Whatever you point it at |

Configuration lives in [`.gitleaks.toml`](../.gitleaks.toml) — the default
ruleset plus a narrow allowlist for the well-known local-dev placeholder
secret. Both the hook and CI pick it up automatically.

## Setup (once per machine)

```bash
brew install gitleaks   # macOS; see the gitleaks README for other platforms
pnpm install            # the root "prepare" script wires .githooks as hooksPath
```

The hook **fails closed**: if gitleaks isn't installed, commits are refused
rather than silently skipping the scan.

## Everyday commands

```bash
# What the hook runs — scan staged changes before committing
gitleaks git --pre-commit --staged --redact --verbose

# Scan the entire git history (do this before making a repo public)
gitleaks git --redact --verbose

# Scan the working tree, including untracked/ignored files (e.g. .dev.vars is
# supposed to hold secrets — this tells you what else does)
gitleaks dir --redact
```

## When gitleaks finds a real secret

1. **Rotate it first.** Once committed, treat the credential as compromised —
   even if the commit never left your machine, rotation is cheap and certainty
   is not. Revoke the key at its provider (GitHub OAuth app, Google Cloud
   console, `wrangler secret put` a fresh `BETTER_AUTH_SECRET`, …).
2. **Then clean history** with [git-filter-repo](https://github.com/newren/git-filter-repo)
   or BFG if the commit was pushed. Deleting the file in a _new_ commit does
   nothing — the secret stays in history and in every clone and fork.
3. **Never skip step 1.** History rewriting without rotation is theater.

## Handling false positives

Prefer the narrowest suppression that works, in this order:

1. **Inline comment** on the flagged line — best for one-offs, visible in review:

   ```ts
   const example = "sk-this-is-documentation-not-a-key"; // gitleaks:allow
   ```

2. **Allowlist entry** in `.gitleaks.toml` — for values or paths that recur
   (like the dev placeholder). Scope it with `regexes` + `paths` rather than
   allowlisting a whole directory.

3. **Baseline file** — only for adopting gitleaks in a repo with existing
   accepted findings: `gitleaks git --baseline-path baseline.json`. Not needed
   here; the history scans clean.

Do **not** commit with `git commit --no-verify` to get past the hook — CI runs
the same scan on full history and will fail the PR anyway.

## CI notes

- The workflow checks out with `fetch-depth: 0` so the action scans every
  commit, not just the PR diff.
- `gitleaks-action` is free for personal accounts. If this repo moves into a
  GitHub **organization**, generate a license key (free for small teams) at
  gitleaks.io and add it as the `GITLEAKS_LICENSE` repo secret — the commented
  line in the workflow shows where it goes.
- Layer, don't replace: GitHub's own push protection / secret scanning is
  worth enabling too once the repo is public — different rulesets catch
  different leaks.
