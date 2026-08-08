/**
 * In-memory stand-in for a Workers `[[ratelimits]]` binding.
 *
 * Counts per key and refuses past `limit`, which is the whole of the real
 * binding's observable behaviour inside a test. The one thing it does not model
 * is the time window: no test waits 60 seconds, so a request can never observe
 * a bucket resetting on its own. `reset()` is the seam for a test that needs a
 * fresh bucket — reach for it deliberately, rather than assuming expiry.
 *
 * Deliberately a real counter and not a stub that always succeeds: a fake that
 * cannot refuse would let a rate-limit deny-path test pass against nothing.
 */
export interface FakeRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
  /** Keys seen, in call order — for asserting *how* a caller was keyed. */
  readonly keys: string[];
  /** Drop all counters. */
  reset(): void;
}

export function createFakeRateLimiter(limit = Number.POSITIVE_INFINITY): FakeRateLimiter {
  const counts = new Map<string, number>();
  const keys: string[] = [];

  return {
    keys,
    reset: () => {
      counts.clear();
      keys.length = 0;
    },
    limit: async ({ key }) => {
      keys.push(key);
      const used = counts.get(key) ?? 0;
      if (used >= limit) return { success: false };
      counts.set(key, used + 1);
      return { success: true };
    },
  };
}

/**
 * The three rate-limit bindings an env needs, unlimited by default.
 *
 * Unlimited is the right default for the many tests that are not about rate
 * limiting: a limit there would make an unrelated suite fail once it grew past
 * some request count. Tests that *are* about the limiter pass their own.
 */
export function createFakeRateLimiters(limits?: {
  default?: number;
  credentials?: number;
  mail?: number;
}) {
  return {
    RATE_LIMIT_DEFAULT: createFakeRateLimiter(limits?.default),
    RATE_LIMIT_CREDENTIALS: createFakeRateLimiter(limits?.credentials),
    RATE_LIMIT_MAIL: createFakeRateLimiter(limits?.mail),
  };
}
