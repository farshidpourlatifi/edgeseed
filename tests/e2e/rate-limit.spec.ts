import { test, expect, type APIRequestContext } from "@playwright/test";
import { clientIp } from "./helpers";

/**
 * Auth rate limiting, at the vector — `docs/security-audit.md` #4.
 *
 * The unit tests in `packages/auth/src/__tests__/rate-limit.test.ts` prove the
 * policy and the adapter. This proves the *wiring*: that the Worker really
 * declares the `[[ratelimits]]` bindings, that `authMiddleware` really hands
 * them to `createAuth`, and that a 429 therefore reaches a real HTTP caller.
 * None of that is visible to a unit test, and all of it is one renamed binding
 * away from silently doing nothing.
 *
 * Driven through `request` rather than a browser: these are unauthenticated
 * POSTs, and the point is the status code, not a rendered page.
 *
 * Each test uses its own client address, so one test tripping a limit cannot
 * throttle another — and so a re-run against a reused dev server starts fresh.
 */

/** Matches `RATE_LIMIT_RULES` in `packages/auth/src/rate-limit.ts`. */
const CREDENTIALS_LIMIT = 10;
const MAIL_LIMIT = 3;

function attempt(
  request: APIRequestContext,
  path: string,
  ip: string,
  headers: Record<string, string> = {},
) {
  return request.post(`/api/auth${path}`, {
    headers: { "cf-connecting-ip": ip, ...headers },
    // An address that does not exist. Better Auth answers these the same way
    // whether or not the account is real — it does not leak existence — so the
    // status under test is the limiter's, never the account's.
    data: { email: "rate-limit-probe@example.com", password: "not-the-password" },
    failOnStatusCode: false,
  });
}

async function statuses(
  request: APIRequestContext,
  path: string,
  times: number,
  ip: string,
  headers: (attemptIndex: number) => Record<string, string> = () => ({}),
) {
  const collected: number[] = [];
  for (let i = 0; i < times; i++) {
    collected.push((await attempt(request, path, ip, headers(i))).status());
  }
  return collected;
}

/**
 * The half the audit widened to once verification became mandatory: this
 * endpoint needs no credentials and makes the app send mail, so unlimited
 * access to it spends the Resend quota on inboxes that never asked.
 */
test("the verification resend endpoint stops sending past its limit", async ({ request }) => {
  const ip = clientIp();

  const collected = await statuses(request, "/send-verification-email", MAIL_LIMIT + 1, ip);

  expect(collected.slice(0, MAIL_LIMIT)).not.toContain(429);
  expect(collected[MAIL_LIMIT]).toBe(429);
});

test("password reset requests stop past the same limit", async ({ request }) => {
  const ip = clientIp();

  const collected = await statuses(request, "/request-password-reset", MAIL_LIMIT + 1, ip);

  expect(collected[MAIL_LIMIT]).toBe(429);
});

test("sign-in stops past its limit", async ({ request }) => {
  const ip = clientIp();

  const collected = await statuses(request, "/sign-in/email", CREDENTIALS_LIMIT + 1, ip);

  expect(collected.slice(0, CREDENTIALS_LIMIT)).not.toContain(429);
  expect(collected[CREDENTIALS_LIMIT]).toBe(429);
});

/**
 * Audit #11's regression guard, asserted where it bites. Cloudflare *appends*
 * to a client-supplied `X-Forwarded-For`, so if `ipAddressHeaders` ever grows a
 * fallback entry this caller starts getting a fresh bucket per request and the
 * limiter above becomes decorative.
 */
test("rotating a spoofed x-forwarded-for does not buy more attempts", async ({ request }) => {
  const ip = clientIp();

  const collected = await statuses(request, "/sign-in/email", CREDENTIALS_LIMIT + 1, ip, (i) => ({
    "x-forwarded-for": `10.0.0.${i}`,
  }));

  expect(collected[CREDENTIALS_LIMIT]).toBe(429);
});

test("one throttled client does not lock out everyone else", async ({ request }) => {
  const throttled = clientIp();
  await statuses(request, "/sign-in/email", CREDENTIALS_LIMIT + 1, throttled);

  const bystander = await attempt(request, "/sign-in/email", clientIp());

  expect(bystander.status()).not.toBe(429);
});

test("the mail budget is separate from the sign-in budget", async ({ request }) => {
  const ip = clientIp();
  await statuses(request, "/send-verification-email", MAIL_LIMIT + 1, ip);

  // Same caller, different class: exhausting the strict mail bucket must not
  // cost them their sign-in attempts.
  const signIn = await attempt(request, "/sign-in/email", ip);

  expect(signIn.status()).not.toBe(429);
});
