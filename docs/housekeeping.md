# Docs housekeeping

Documentation here is load-bearing: `AGENTS.md` is what every coding agent reads, the
README is what every adopter trusts, and both make specific claims about how the code
behaves. Docs that contradict the code are worse than missing docs, because they get
believed. This file is the routine that keeps that from rotting.

## What is already automatic

`pnpm check:docs-sync` runs on every PR and in the weekly CI cron, and fails on:

1. A root `package.json` script missing from `README.md`, `docs/README.md` or `AGENTS.md`.
2. A `.dev.vars.example` that has drifted from the env schema in `packages/config`.
3. A relative link in the public docs whose target does not exist.
4. An MCP tool or API path that ships but is not named in the README.

CI separately regenerates the OpenAPI spec and fails if the committed copy differs.

**Everything below is what those checks cannot judge.** A machine can prove a link
resolves; it cannot prove a sentence is still true.

## The sweep

Run it **quarterly**, and the version-sensitive parts (§3) **after each release**. The
scheduled workflow in `.github/workflows/docs-housekeeping.yml` opens a tracking issue so
this happens on a calendar rather than on remembering.

Work through it in order — later sections depend on earlier answers.

### 1. Standing concerns

`AGENTS.md` § "Top ten standing concerns" carries a date and the note that statuses were
verified against the code that day. That date is the whole warranty.

- [ ] Re-verify each of the ten against the current code, not against the last sweep.
- [ ] Anything resolved: update **both** the concern and the doc it cites, then say so in
      the PR. A concern that quietly stays "open" after the fix trains readers to ignore
      the list.
- [ ] Anything newly true: add it, and remove whatever it displaced — the list is ten
      items because a list of forty is not read.
- [ ] Update the "distilled on" date to the day you actually re-verified.

### 2. Public claims

- [ ] Walk the README capability matrix row by row against the running app. Every row is
      either demonstrably true or marked partial/not-shipped.
- [ ] Walk the "Known limitations" list. Anything fixed comes out; anything newly known
      goes in. This list is the one that protects an adopter from a nasty surprise, so err
      toward saying more.
- [ ] Open the landing page and compare it to the README's opening claim. They are written
      by different hands at different times and are the two things a visitor sees first.
- [ ] Check the screenshots in `docs/assets/` still look like the app. Recapture against
      **seeded** data (`admin@example.com`), never a real account — a public README must
      not carry someone's address.

### 3. Release and deployment truth

- [ ] `curl https://app.edgeseed.dev/api/v1/health` — does the live version match the
      latest GitHub release? A gap means a release deployed and something later broke, or
      a deploy happened outside the tag flow.
- [ ] `SECURITY.md` § Supported versions still describes reality (latest release only).
- [ ] The deploy and release instructions still match `.github/workflows/release.yml`.
      The workflow is the source of truth; the docs are the copy.

### 4. Repository surface

Settings drift silently and nothing in CI can see them.

```bash
GH_TOKEN=$(gh auth token --user <personal-account>) gh repo view farshidpourlatifi/edgeseed \
  --json description,homepageUrl,repositoryTopics,isTemplate,securityAndAnalysis
```

- [ ] Description, homepage and topics still describe what this is.
- [ ] **`isTemplate` is still `false`** — deliberately. A template repository severs git
      history, and history is how adopters take upstream fixes (`git merge upstream/main`).
      If someone turned it on, turn it back off and find out why.
- [ ] Private vulnerability reporting still enabled, and `SECURITY.md` still points at a
      form that exists.
- [ ] Branch rulesets on `main` intact, and their required checks still name the **exact**
      CI job names (`quality`, `e2e`, `drift`, `scan`). Renaming a job blocks every merge
      until the ruleset is updated.
- [ ] Issue templates still reference labels that exist.

### 5. Security posture

- [ ] Any open security advisories, and any report that never got an answer.
- [ ] Dependabot status. It is currently **disabled**, and both `SECURITY.md` and the
      README say so — if that changes, change the docs in the same PR.
- [ ] Skim `docs/security-audit.md` for items whose status is now wrong.

### 6. Cross-references

- [ ] Pick two or three claims changed since the last sweep and grep for their other
      homes. The same fact lives in `README.md`, `docs/`, `AGENTS.md`, the per-package
      `CLAUDE.md` files and `.github/skills/code-review/SKILL.md` by design; a partial
      update leaves the stale copy to be trusted.

## Finishing

Close the tracking issue with a one-line note per section — what changed, or "verified, no
change". "No change" is a real result and worth recording: it is what makes the next
sweep's diff meaningful.

Then run `pnpm verify`, because docs changes can break the drift checks.
