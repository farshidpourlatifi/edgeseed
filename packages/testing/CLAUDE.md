# @starter/testing

## Why this exists

Shared test helpers, in a package of their own so any workspace can devDepend
on them. They used to live in `@starter/cli`, which created a circular package
dependency (`config → cli → config`) — that is exactly what this package must
never re-introduce.

## Layout

- `factory.ts` — `buildUser` / `buildOrganization` / `buildMember` row factories (unique ids per call)
- `fake-env.ts` — `createFakeEnv()` for Worker env objects in unit tests
- `fake-rate-limit.ts` — `createFakeRateLimiter()` / `createFakeRateLimiters()`, an in-memory stand-in for a Workers `[[ratelimits]]` binding. A real counter, not an always-succeed stub: a fake that cannot refuse would let a rate-limit deny-path test pass against nothing. It models no time window, because no test waits 60 seconds — use `reset()` rather than assuming expiry

## Rules

- **Zero runtime workspace dependencies, permanently.** Packages under test
  devDepend on this one; if this package imported `@starter/db` (say, to type
  factories against the schema), the cycle would be back. Keep factory shapes
  structurally compatible instead of importing the types.
- Add a factory here rather than inlining row literals in a test.
- Consumers declare `"@starter/testing": "workspace:*"` as a devDependency and
  import subpaths (`@starter/testing/fake-env`).

## Testing

- No coverage target — these helpers are validated by every suite that uses them.
