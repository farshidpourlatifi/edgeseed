# @starter/testing

## Why this exists

Shared test helpers, in a package of their own so any workspace can devDepend
on them. They used to live in `@starter/cli`, which created a circular package
dependency (`config → cli → config`) — that is exactly what this package must
never re-introduce.

## Layout

- `factory.ts` — `buildUser` / `buildOrganization` / `buildMember` row factories (unique ids per call)
- `fake-env.ts` — `createFakeEnv()` for Worker env objects in unit tests
- `fake-kv.ts` — `createFakeKv()`, an in-memory KV namespace. Small but real: `put` stores and `get` returns it, because a stub that discarded writes would let a storage test pass against nothing. It models no expiry, metadata, `list` pagination or eventual consistency — the doc comment lists what to reach elsewhere for
- `fake-d1.ts` — `createFakeD1()`, a `D1Database` over in-memory SQLite (`node:sqlite`) with `packages/db/migrations` applied in order. Real for the same reason the two above are: the org-scoped reads in `@starter/auth` are guarded by `WHERE` clauses, and a mocked store returning `null` because a test said so is not evidence that a real id from another tenant reads as absent. The schema comes from the migrations rather than a fixture, so it cannot drift — and a downstream product's own migrations are applied too. `epochSeconds()` ships with it, because `mode: "timestamp"` is **seconds**. It models no `batch()`, transactions, `meta` counters or D1 size limits; the doc comment lists what to reach elsewhere for
- `fake-rate-limit.ts` — `createFakeRateLimiter()` / `createFakeRateLimiters()`, an in-memory stand-in for a Workers `[[ratelimits]]` binding. A real counter, not an always-succeed stub: a fake that cannot refuse would let a rate-limit deny-path test pass against nothing. It models no time window, because no test waits 60 seconds — use `reset()` rather than assuming expiry

## Rules

- **Zero runtime workspace dependencies, permanently.** Packages under test
  devDepend on this one; if this package imported `@starter/db` (say, to type
  factories against the schema), the cycle would be back. Keep factory shapes
  structurally compatible instead of importing the types. `fake-d1.ts` reaches
  the migrations by **relative path** for exactly this reason — importing
  `@starter/db` to find them would rebuild the cycle.
- Add a factory here rather than inlining row literals in a test.
- Consumers declare `"@starter/testing": "workspace:*"` as a devDependency and
  import subpaths (`@starter/testing/fake-env`).

## Testing

- No coverage target — these helpers are validated by every suite that uses them.
