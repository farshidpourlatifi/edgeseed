import { describe, it, expect } from "vitest";
import { createFakeRateLimiters, type FakeRateLimiter } from "@starter/testing/fake-rate-limit";
import type { EmailSender } from "@starter/email";
import { createAuth } from "../server";
import {
  AUTH_RATE_LIMIT_CUSTOM_RULES,
  createRateLimitStorage,
  RATE_LIMIT_RULES,
  rateLimitClassFor,
  rateLimitKey,
} from "../rate-limit";

/**
 * Audit #4. The limiter is configuration plus one adapter, so the tests come in
 * two halves: the policy table asserted directly, and the *vector* — requests
 * driven through Better Auth's real handler until a 429 comes back.
 *
 * The vector half is the one that matters. Every part of #4 was a config that
 * looked present and did nothing (`enabled` keyed on an unset `NODE_ENV`,
 * counters in a Map that no isolate shares with another), and no assertion on
 * `auth.options` would have caught any of it.
 */

const NOOP_EMAIL: EmailSender = { send: async () => {} };
const IP = "203.0.113.7";
const OTHER_IP = "198.51.100.4";

function build(limits?: { default?: number; credentials?: number; mail?: number }) {
  const limiters = createFakeRateLimiters(limits);
  const auth = createAuth({
    db: {} as never,
    secret: "x".repeat(32),
    baseURL: "http://localhost:5173",
    email: NOOP_EMAIL,
    rateLimiters: {
      default: limiters.RATE_LIMIT_DEFAULT,
      credentials: limiters.RATE_LIMIT_CREDENTIALS,
      mail: limiters.RATE_LIMIT_MAIL,
    },
  });
  return { auth, limiters };
}

/**
 * An empty JSON body on purpose: Better Auth validates it inside the endpoint
 * and answers 400 without touching the database, while the rate limiter runs
 * earlier still, in the router's `onRequest` hook. So a request is either 400
 * (counted, allowed through) or 429 (refused) — and no D1 is needed to tell
 * those apart.
 */
function post(path: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:5173/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": IP, ...headers },
    body: "{}",
  });
}

async function statusesFor(
  auth: ReturnType<typeof build>["auth"],
  path: string,
  times: number,
  headers: (attempt: number) => Record<string, string> = () => ({}),
) {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < times; attempt++) {
    statuses.push((await auth.handler(post(path, headers(attempt)))).status);
  }
  return statuses;
}

describe("rate limit policy", () => {
  it("counts sign-in against the credentials class", () => {
    expect(rateLimitClassFor("/sign-in/email")).toBe("credentials");
    expect(rateLimitClassFor("/sign-in/social")).toBe("credentials");
  });

  /**
   * The widened half of #4. Sign-up is not merely a credential endpoint: since
   * verification became mandatory it *sends a message*, so it belongs in the
   * strictest bucket alongside the explicit resend and reset endpoints.
   */
  it("counts every way to make the app send mail against the mail class", () => {
    expect(rateLimitClassFor("/sign-up/email")).toBe("mail");
    expect(rateLimitClassFor("/send-verification-email")).toBe("mail");
    expect(rateLimitClassFor("/request-password-reset")).toBe("mail");
    expect(rateLimitClassFor("/forget-password")).toBe("mail");
    // Behind a session, and still here: the cost being bounded is the message.
    expect(rateLimitClassFor("/change-email")).toBe("mail");
  });

  /**
   * Every remaining entry in `CLASSIFIERS`, stated independently of the table.
   * Without these, a classifier can be deleted outright and nothing goes red —
   * which is how `/change-email` came to be missing from the audit's own
   * summary of the shipped policy.
   */
  it("counts the other credential-bearing endpoints against the credentials class", () => {
    expect(rateLimitClassFor("/reset-password")).toBe("credentials");
    expect(rateLimitClassFor("/change-password")).toBe("credentials");
  });

  // Not "unlimited": an endpoint a future Better Auth version adds arrives
  // limited, the same way a new API route arrives denied.
  it("puts an unrecognised path in the default class rather than leaving it unlimited", () => {
    expect(rateLimitClassFor("/get-session")).toBe("default");
    expect(rateLimitClassFor("/some/endpoint/added/later")).toBe("default");
  });

  it("keeps mail the strictest class and default the loosest", () => {
    expect(RATE_LIMIT_RULES.mail.max).toBeLessThan(RATE_LIMIT_RULES.credentials.max);
    expect(RATE_LIMIT_RULES.credentials.max).toBeLessThan(RATE_LIMIT_RULES.default.max);
  });

  // A binding's period may only be 10 or 60 seconds, so a window that is
  // neither cannot be enforced by the thing that actually enforces.
  it("uses windows a Workers rate-limit binding can express", () => {
    for (const rule of Object.values(RATE_LIMIT_RULES)) {
      expect([10, 60]).toContain(rule.window);
    }
  });

  it("publishes the policy to Better Auth for both bare and nested paths", () => {
    expect(AUTH_RATE_LIMIT_CUSTOM_RULES["/sign-in"]).toEqual(RATE_LIMIT_RULES.credentials);
    expect(AUTH_RATE_LIMIT_CUSTOM_RULES["/sign-in/**"]).toEqual(RATE_LIMIT_RULES.credentials);
    expect(AUTH_RATE_LIMIT_CUSTOM_RULES["/send-verification-email"]).toEqual(RATE_LIMIT_RULES.mail);
  });
});

describe("rate limit storage", () => {
  function storageWith(limits?: { default?: number; credentials?: number; mail?: number }) {
    const limiters = createFakeRateLimiters(limits);
    const storage = createRateLimitStorage({
      default: limiters.RATE_LIMIT_DEFAULT,
      credentials: limiters.RATE_LIMIT_CREDENTIALS,
      mail: limiters.RATE_LIMIT_MAIL,
    });
    return { storage, limiters };
  }

  it("sends each key to the binding for its class", async () => {
    const { storage, limiters } = storageWith();

    await storage.consume!(`${IP}|/sign-in/email`, RATE_LIMIT_RULES.credentials);
    await storage.consume!(`${IP}|/send-verification-email`, RATE_LIMIT_RULES.mail);
    await storage.consume!(`${IP}|/get-session`, RATE_LIMIT_RULES.default);

    expect(limiters.RATE_LIMIT_CREDENTIALS.keys).toEqual([`${IP}|/sign-in/email`]);
    expect(limiters.RATE_LIMIT_MAIL.keys).toEqual([`${IP}|/send-verification-email`]);
    expect(limiters.RATE_LIMIT_DEFAULT.keys).toEqual([`${IP}|/get-session`]);
  });

  it("reports the window as the retry hint once the limit is reached", async () => {
    const { storage } = storageWith({ credentials: 1 });
    const key = `${IP}|/sign-in/email`;

    await expect(storage.consume!(key, RATE_LIMIT_RULES.credentials)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
    await expect(storage.consume!(key, RATE_LIMIT_RULES.credentials)).resolves.toEqual({
      allowed: false,
      retryAfter: RATE_LIMIT_RULES.credentials.window,
    });
  });

  /**
   * Unreachable while Better Auth builds every key as `${ip}|${path}`, and
   * charged to the strictest class for that reason: if the format ever changes,
   * over-throttling is noticed, whereas falling back to the loosest bucket
   * would quietly stop enforcing on the endpoints that most need it.
   */
  it("charges a key in an unrecognised format to the strictest class", async () => {
    const { storage, limiters } = storageWith();

    await storage.consume!("no-separator-here", RATE_LIMIT_RULES.default);

    expect(limiters.RATE_LIMIT_MAIL.keys).toEqual(["no-separator-here"]);
    expect(limiters.RATE_LIMIT_DEFAULT.keys).toEqual([]);
  });

  // The IP half of the key is full of colons for an IPv6 caller, so the path
  // has to be found by the pipe and nothing else.
  it("finds the path in a key whose IP is IPv6", async () => {
    const { storage, limiters } = storageWith();

    await storage.consume!("2001:db8:1:2|/send-verification-email", RATE_LIMIT_RULES.mail);

    expect(limiters.RATE_LIMIT_MAIL.keys).toEqual(["2001:db8:1:2|/send-verification-email"]);
  });

  /**
   * The deny path for the storage contract itself. `get`/`set` are Better
   * Auth's non-atomic fallback, used only when a storage has no `consume`.
   * Returning "no record" from them would silently disable rate limiting if a
   * future version stopped calling `consume` — which is audit #4 all over
   * again. Refusing turns that into a loud 500 instead.
   */
  it("refuses the non-atomic fallback rather than reporting an empty bucket", async () => {
    const { storage } = storageWith();

    await expect(storage.get("anything")).rejects.toThrow(/consume/);
    await expect(
      storage.set("anything", { key: "anything", count: 1, lastRequest: 0 }),
    ).rejects.toThrow(/consume/);
  });
});

describe("rateLimitKey", () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it("keys on the edge-set client IP", () => {
    expect(rateLimitKey(headers({ "cf-connecting-ip": IP }), "/authorize:sign-in")).toBe(
      `${IP}|/authorize:sign-in`,
    );
  });

  /**
   * Audit #11 in a second place. Cloudflare appends to a client-supplied
   * `X-Forwarded-For`, so reading it would hand an attacker a fresh bucket per
   * request just by varying a header they control.
   */
  it("ignores a client-supplied x-forwarded-for", () => {
    const spoofed = headers({ "cf-connecting-ip": IP, "x-forwarded-for": "10.0.0.1" });
    expect(rateLimitKey(spoofed, "/p")).toBe(`${IP}|/p`);
  });

  /**
   * An IPv6 client is routinely handed a whole /64 and can vary the low bits at
   * will, so keying on the full address is the same bypass as trusting a
   * spoofable header. Better Auth collapses to /64 by default; this must match.
   */
  it("collapses IPv6 addresses in the same /64 to one bucket", () => {
    const a = rateLimitKey(headers({ "cf-connecting-ip": "2001:db8:1:2::1" }), "/p");
    const b = rateLimitKey(
      headers({ "cf-connecting-ip": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" }),
      "/p",
    );

    expect(a).toBe(b);
  });

  // The same address written both ways must land in one bucket, or spelling it
  // out in full is the bypass that collapsing exists to prevent.
  it("treats a compressed and a fully written address as the same client", () => {
    const compressed = rateLimitKey(headers({ "cf-connecting-ip": "2001:db8:1:2::5" }), "/p");
    const written = rateLimitKey(
      headers({ "cf-connecting-ip": "2001:0db8:0001:0002:0000:0000:0000:0005" }),
      "/p",
    );

    expect(compressed).toBe(written);
  });

  // Collapsing this to a /64 would put every IPv4-mapped client — potentially
  // all of them, behind some proxies — into one shared bucket.
  it("keeps the address of an IPv4-mapped client", () => {
    expect(rateLimitKey(headers({ "cf-connecting-ip": "::ffff:203.0.113.7" }), "/p")).toBe(
      `${IP}|/p`,
    );
  });

  it("handles a loopback address without losing the caller", () => {
    expect(rateLimitKey(headers({ "cf-connecting-ip": "::1" }), "/p")).toBe(
      "0000:0000:0000:0000|/p",
    );
  });

  /**
   * The case where `::` sits early and the groups after it reach into the /64.
   * `2001:db8::1:2:3:4:5` expands to a single zero group, so the fourth group
   * is `1` and not a zero — get the gap arithmetic wrong and this address
   * collapses onto every other `2001:db8::` client, handing them one shared
   * bucket. The obvious inputs (`::1`, `2001:db8:1:2::1`) cannot catch it,
   * because their zeros run past the fourth group either way.
   */
  it("keeps groups that follow :: when they land inside the /64", () => {
    const withTail = rateLimitKey(headers({ "cf-connecting-ip": "2001:db8::1:2:3:4:5" }), "/p");
    const allZeros = rateLimitKey(headers({ "cf-connecting-ip": "2001:db8::5" }), "/p");

    expect(withTail).toBe("2001:0db8:0000:0001|/p");
    expect(withTail).not.toBe(allZeros);
  });

  it("keeps different /64s apart", () => {
    const a = rateLimitKey(headers({ "cf-connecting-ip": "2001:db8:1:2::1" }), "/p");
    const b = rateLimitKey(headers({ "cf-connecting-ip": "2001:db8:1:3::1" }), "/p");

    expect(a).not.toBe(b);
  });

  // Not a per-request bucket: an unidentifiable caller shares one, so absence
  // of the trusted header cannot be used to escape the limit.
  it("falls back to a single shared bucket when no trusted IP is present", () => {
    expect(rateLimitKey(headers({}), "/p")).toBe("no-trusted-ip|/p");
  });
});

describe("through the Better Auth handler", () => {
  it("answers 429 once the credentials limit is reached", async () => {
    const { auth } = build({ credentials: 2 });

    const statuses = await statusesFor(auth, "/sign-in/email", 4);

    expect(statuses.slice(0, 2)).not.toContain(429);
    expect(statuses.slice(2)).toEqual([429, 429]);
  });

  it("tells the caller how long to wait", async () => {
    const { auth } = build({ credentials: 1 });
    await auth.handler(post("/sign-in/email"));

    const res = await auth.handler(post("/sign-in/email"));

    expect(res.status).toBe(429);
    expect(res.headers.get("x-retry-after")).toBe(String(RATE_LIMIT_RULES.credentials.window));
  });

  it("does not throttle a different client", async () => {
    const { auth } = build({ credentials: 1 });
    await auth.handler(post("/sign-in/email"));

    expect((await auth.handler(post("/sign-in/email"))).status).toBe(429);
    expect(
      (await auth.handler(post("/sign-in/email", { "cf-connecting-ip": OTHER_IP }))).status,
    ).not.toBe(429);
  });

  /**
   * The regression guard audit #11 exists for, asserted at the vector rather
   * than on the config. If `ipAddressHeaders` ever grows a fallback entry, this
   * caller starts getting a fresh bucket per request and this test goes red.
   */
  it("stays throttled while the caller rotates a spoofed x-forwarded-for", async () => {
    const { auth } = build({ credentials: 2 });

    const statuses = await statusesFor(auth, "/sign-in/email", 4, (attempt) => ({
      "x-forwarded-for": `10.0.0.${attempt}`,
    }));

    expect(statuses.slice(2)).toEqual([429, 429]);
  });

  /**
   * The half the audit widened to on 2026-08-08. These endpoints need no
   * credentials at all — they take an address and send it a message, so leaving
   * them unlimited spends the Resend quota and delivers to inboxes that never
   * asked for it.
   */
  it.each(["/send-verification-email", "/request-password-reset", "/sign-up/email"])(
    "throttles %s on the stricter mail limit",
    async (path) => {
      const { auth } = build({ mail: 1, credentials: 50, default: 50 });

      const statuses = await statusesFor(auth, path, 3);

      expect(statuses[0]).not.toBe(429);
      expect(statuses.slice(1)).toEqual([429, 429]);
    },
  );

  it("counts the mail endpoints separately from sign-in", async () => {
    const { auth } = build({ mail: 1, credentials: 1 });
    await auth.handler(post("/send-verification-email"));

    expect((await auth.handler(post("/send-verification-email"))).status).toBe(429);
    expect((await auth.handler(post("/sign-in/email"))).status).not.toBe(429);
  });
});

describe("the fake limiter itself", () => {
  // The suite above is only worth anything if the double can actually refuse.
  it("refuses past its limit", async () => {
    const limiter: FakeRateLimiter = createFakeRateLimiters({ mail: 1 }).RATE_LIMIT_MAIL;

    await expect(limiter.limit({ key: "k" })).resolves.toEqual({ success: true });
    await expect(limiter.limit({ key: "k" })).resolves.toEqual({ success: false });
    await expect(limiter.limit({ key: "other" })).resolves.toEqual({ success: true });
  });
});
