import type { BetterAuthRateLimitOptions, RateLimit as RateLimitRecord } from "better-auth";

/**
 * Rate limiting for Better Auth, backed by Workers' native rate-limit bindings.
 *
 * Closes `docs/security-audit.md` #4. Three things had to be true at once for
 * that finding to exist, and each is answered here:
 *
 * 1. Better Auth's default is `enabled: isProduction`, which keys on `NODE_ENV`
 *    — never set on Workers. So `enabled` is pinned `true`, unconditionally.
 *    Do not make it environment-dependent; that is the original defect.
 * 2. Its default `memory` storage is a module-level `Map` — so it survives
 *    `createAuth()` being rebuilt per request, but not the isolate. Counts are
 *    per-isolate and ephemeral: they never aggregate across the isolates
 *    serving one attacker, and vanish whenever one is evicted. (The audit says
 *    the per-request rebuild discards them; that was true of better-auth 1.5.6
 *    and is not true of the pinned 1.6.26. The conclusion is unchanged.)
 * 3. `storage: "database"` needs a `rateLimit` table that does not exist.
 *
 * ## Why a rate-limit binding and not KV
 *
 * The plan (`docs/security-plan.md` §2.3) proposed KV as `secondaryStorage`.
 * Both halves of that turned out to be wrong for this job:
 *
 * - Setting `secondaryStorage` **moves sessions out of D1** (better-auth's
 *   `internal-adapter.mjs`: `databaseStoresSessions = !secondaryStorage || …`),
 *   so revocation and sign-out would inherit KV's eventual consistency. Session
 *   storage is not something a rate-limiting change should touch.
 * - KV allows **one write per second per key** and returns 429 beyond that,
 *   and it caches negative lookups. A counter is a hot key by definition, so a
 *   read-modify-write limiter on KV advances roughly one increment per second
 *   under attack — it converges to a ~6× reduction, not a limit. Cloudflare's
 *   own KV docs rule out workloads where "values must be read and written in a
 *   single transaction".
 *
 * The `[[ratelimits]]` binding is the primitive built for this: atomic, no
 * storage operations, no hot-key ceiling. Its two constraints are that a period
 * must be 10 or 60 seconds — hence every window here is 60 — and that counters
 * are per Cloudflare location, which for an IP-keyed limit is wherever that IP's
 * traffic already lands.
 *
 * ## What this does not cover
 *
 * A limit is per IP **and** path, and only bounds what one address can do. It
 * is not a defence against a distributed botnet; a Cloudflare WAF rate-limiting
 * rule on `/api/auth/*` is the complementary volumetric control.
 */

/**
 * Enforcement classes. One Workers binding each, because a binding carries
 * exactly one limit/period pair.
 */
export type RateLimitClass = "credentials" | "mail" | "default";

/** The bindings, resolved from the env by the caller. */
export type RateLimiters = Readonly<Record<RateLimitClass, RateLimit>>;

/**
 * The policy. These numbers must match `simple.limit` / `simple.period` on the
 * matching `[[ratelimits]]` binding in **both** wrangler.jsonc files — the
 * binding is what enforces; this table is what the app reports and tests.
 *
 * `credentials` is 10/60s rather than Better Auth's own 3/10s default: the same
 * order of magnitude per minute, without the burst-then-wait window that 3/10s
 * leaves open. `mail` is deliberately the strictest — since #2 made
 * verification mandatory, an unauthenticated caller can drive outbound mail,
 * which costs money and burns sender reputation on inboxes that never asked.
 */
export const RATE_LIMIT_RULES = {
  credentials: { window: 60, max: 10 },
  mail: { window: 60, max: 3 },
  /**
   * Everything under `/api/auth` that is not named below, so an endpoint added
   * by a future Better Auth version or plugin arrives limited rather than
   * unlimited. Loose on purpose: `/get-session` and OAuth callbacks land here,
   * and shared-NAT offices share one address.
   */
  default: { window: 60, max: 120 },
} as const satisfies Record<RateLimitClass, { window: number; max: number }>;

/**
 * Path prefixes that leave the `default` class, relative to `basePath`
 * (`/api/auth`), matching Better Auth's own normalised pathnames.
 *
 * `mail` covers every endpoint that makes the app send a message. The
 * **unauthenticated** ones are why the bucket is this strict — `/sign-up/email`
 * sits here rather than with the credential endpoints for exactly that reason,
 * since it sends the verification mail. `/change-email` needs a session and is
 * here anyway: the cost being bounded is the message, not the credential.
 *
 * `/organization/invite-member` is the same judgement made a second time. It is
 * authenticated and permission-checked, so it is not the unauthenticated abuse
 * `mail` was built for — but a compromised admin session pointed at a list of
 * addresses spends the product's sending reputation exactly as fast, and that
 * cost is what this class exists to bound. **One prefix covers invite and
 * resend both**, because they are the same endpoint: `resend: true` reuses the
 * existing invitation and only extends its expiry (`crud-invites.mjs`).
 *
 * Order matters: the first matching prefix wins, so a longer path must precede
 * any prefix of it.
 */
const CLASSIFIERS: ReadonlyArray<{ prefix: string; class: RateLimitClass }> = [
  { prefix: "/sign-up", class: "mail" },
  { prefix: "/send-verification-email", class: "mail" },
  { prefix: "/request-password-reset", class: "mail" },
  { prefix: "/forget-password", class: "mail" },
  { prefix: "/change-email", class: "mail" },
  { prefix: "/organization/invite-member", class: "mail" },
  { prefix: "/sign-in", class: "credentials" },
  { prefix: "/reset-password", class: "credentials" },
  { prefix: "/change-password", class: "credentials" },
];

/**
 * Which class a Better Auth path falls into.
 *
 * Exported because `apps/mcp` needs the same answer for its `/authorize` login
 * form, which reaches `signInEmail` through `auth.api.*` and therefore never
 * passes through the router hook this storage is wired into.
 */
export function rateLimitClassFor(path: string): RateLimitClass {
  const match = CLASSIFIERS.find((c) => path === c.prefix || path.startsWith(`${c.prefix}/`));
  return match?.class ?? "default";
}

/**
 * `customRules` for `betterAuth()`, derived from the same table so the policy
 * cannot be stated twice and drift.
 *
 * With a `customStorage` that implements `consume`, these rules no longer decide
 * whether a request is allowed — the binding does. They still earn their place:
 * they set the `X-Retry-After` Better Auth reports, and they put the policy
 * where a reader of `auth.options` can see it. Two keys per prefix because
 * Better Auth matches `customRules` by exact path or glob, and `/sign-in/**`
 * does not match a bare `/sign-in`.
 */
export const AUTH_RATE_LIMIT_CUSTOM_RULES: NonNullable<BetterAuthRateLimitOptions["customRules"]> =
  Object.fromEntries(
    CLASSIFIERS.flatMap(({ prefix, class: cls }) => [
      [prefix, RATE_LIMIT_RULES[cls]],
      [`${prefix}/**`, RATE_LIMIT_RULES[cls]],
    ]),
  );

type RateLimitStorage = NonNullable<BetterAuthRateLimitOptions["customStorage"]>;

/**
 * Better Auth's own sentinel for a request whose client IP could not be
 * resolved. Reused so an unidentifiable caller lands in one shared bucket
 * rather than an unlimited one.
 */
const NO_TRUSTED_IP = "no-trusted-ip";

/**
 * Collapse an IPv6 address to its /64 prefix, mirroring Better Auth's default
 * `ipv6Subnet: 64`.
 *
 * Load-bearing, not tidiness: a client with an IPv6 /64 allocation can vary the
 * low 64 bits at will, so keying on the full address hands them a fresh bucket
 * per request. IPv4 (including the IPv4-mapped form) is returned as-is — there
 * is nothing to collapse.
 */
function normalizeIp(ip: string): string {
  if (!ip.includes(":")) return ip;
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);

  const [head = "", tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::")
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
    : ip.split(":");

  return groups
    .slice(0, 4)
    .map((group) => group.padStart(4, "0"))
    .join(":")
    .toLowerCase();
}

/**
 * Build a limiter key the way Better Auth does — `${ip}|${path}`.
 *
 * For endpoints that authenticate outside Better Auth's HTTP router, where the
 * router hook that normally applies the limiter never runs. `apps/mcp`'s
 * `/authorize` login form is the one such endpoint today: it reaches
 * `signInEmail` through `auth.api.*`.
 *
 * `cf-connecting-ip` and nothing else, for the reason `ipAddressHeaders` holds
 * exactly one entry (audit #11): Cloudflare appends to a client-supplied
 * `X-Forwarded-For`, so any fallback restores a spoofable path.
 */
export function rateLimitKey(headers: Headers, path: string): string {
  const ip = headers.get("cf-connecting-ip");
  return `${ip ? normalizeIp(ip) : NO_TRUSTED_IP}|${path}`;
}

/**
 * Which class a Better Auth storage key is charged to.
 *
 * The key is `${ip}|${path}` (`createRateLimitKey`). The IP never contains a
 * pipe, so everything after the **first** one is the path — splitting on the
 * first rather than the last means a path that somehow contains a pipe cannot
 * shift which class it is judged under.
 *
 * A key in no recognisable form should not be reachable, since Better Auth
 * builds every one of them. If the format ever changes, charging it to the
 * strictest class throttles legitimate traffic, which is noticed; the
 * alternative — falling back to the loosest — would quietly stop enforcing on
 * the endpoints that most need it.
 */
function classForKey(key: string): RateLimitClass {
  const separator = key.indexOf("|");
  return separator === -1 ? STRICTEST_CLASS : rateLimitClassFor(key.slice(separator + 1));
}

const STRICTEST_CLASS: RateLimitClass = "mail";

/**
 * Refusing rather than returning nothing is the point. `get`/`set` are the
 * non-atomic legacy path Better Auth falls back to when a storage has no
 * `consume`; this one has `consume`, so they are unreachable today. If a future
 * version stops calling `consume`, a no-op pair here would silently disable
 * rate limiting — the exact shape of audit #4. A throw surfaces as a 500 on the
 * auth route instead, which is loud, and fails closed.
 */
function unreachable(member: string): never {
  throw new Error(
    `rate-limit storage: ${member}() was called, but this storage enforces through consume(). ` +
      `Better Auth only uses ${member}() on its non-atomic fallback path — refusing rather ` +
      `than silently disabling rate limiting. See packages/auth/src/rate-limit.ts.`,
  );
}

/**
 * Adapt the Workers rate-limit bindings to Better Auth's storage contract.
 *
 * `consume` is the atomic check-and-increment Better Auth prefers; a binding
 * gives it natively, so there is no read-decide-write gap to lose requests
 * through. `retryAfter` comes from the rule's window because the binding
 * reports only success or failure — it is an upper bound, which is the safe
 * direction to be wrong in.
 */
export function createRateLimitStorage(limiters: RateLimiters): RateLimitStorage {
  return {
    // `async` so the refusal arrives as a rejected promise, the way every other
    // member of this contract reports failure — a synchronous throw would slip
    // past a caller that inspects the promise instead of awaiting it.
    get: async (): Promise<RateLimitRecord | null> => unreachable("get"),
    set: async (): Promise<void> => unreachable("set"),
    consume: async (key, rule) => {
      const limiter = limiters[classForKey(key)];
      const { success } = await limiter.limit({ key });
      return success
        ? { allowed: true, retryAfter: null }
        : { allowed: false, retryAfter: rule.window };
    },
  };
}
