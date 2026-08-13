import { describe, it, expect, vi } from "vitest";
import { createFakeRateLimiters } from "@starter/testing/fake-rate-limit";
import type { EmailMessage, EmailSender } from "@starter/email";
import { createAuth } from "../server";
import { RATE_LIMIT_RULES } from "../rate-limit";

/**
 * These assert on `auth.options` rather than on live HTTP because the settings
 * under test ARE the security boundary — audit #2 is a configuration defect,
 * not a code defect. A change to any of them should fail loudly here.
 */

function fakeSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    send: async (message) => {
      sent.push(message);
    },
  };
}

function build(email: EmailSender = fakeSender()) {
  const limiters = createFakeRateLimiters();
  return createAuth({
    db: {} as never,
    secret: "x".repeat(32),
    baseURL: "http://localhost:5173",
    email,
    rateLimiters: {
      default: limiters.RATE_LIMIT_DEFAULT,
      credentials: limiters.RATE_LIMIT_CREDENTIALS,
      mail: limiters.RATE_LIMIT_MAIL,
    },
  });
}

const USER = { email: "user@example.com", name: "User" };
const URL_WITH_CALLBACK = "http://localhost:5173/api/auth/verify-email?token=t0ken&callbackURL=%2F";

describe("createAuth — email verification", () => {
  it("should refuse sign-in until the address is verified", () => {
    expect(build().options.emailAndPassword?.requireEmailVerification).toBe(true);
  });

  it("should send a verification email on sign-up", () => {
    expect(build().options.emailVerification?.sendOnSignUp).toBe(true);
  });

  it("should sign the user in once they follow the link", () => {
    expect(build().options.emailVerification?.autoSignInAfterVerification).toBe(true);
  });

  it("should deliver the verification link to the registering address", async () => {
    const email = fakeSender();
    await build(email).options.emailVerification?.sendVerificationEmail?.(
      { user: USER as never, url: URL_WITH_CALLBACK, token: "t0ken" },
      undefined as never,
    );

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].to).toBe(USER.email);
    expect(email.sent[0].text).toContain(URL_WITH_CALLBACK);
  });

  it("should deliver the reset link to the requesting address", async () => {
    const email = fakeSender();
    await build(email).options.emailAndPassword?.sendResetPassword?.(
      { user: USER as never, url: URL_WITH_CALLBACK, token: "t0ken" },
      undefined as never,
    );

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].to).toBe(USER.email);
    expect(email.sent[0].subject.toLowerCase()).toContain("reset");
  });

  /**
   * Scope note: this asserts the callback we hand Better Auth rejects — it does
   * NOT prove a failed send fails the sign-up request. `/sign-up/email` wraps
   * the callback in `runInBackgroundOrAwait`, which logs and returns normally,
   * so sign-up still answers 200 (ADR 003, "A send failure at sign-up is
   * swallowed"). The rejection does surface on `/send-verification-email`,
   * which awaits the callback directly — that path is what this guarantees.
   */
  it("should reject rather than resolve when the transport fails", async () => {
    const failing: EmailSender = { send: vi.fn(async () => Promise.reject(new Error("502"))) };

    await expect(
      build(failing).options.emailVerification?.sendVerificationEmail?.(
        { user: USER as never, url: URL_WITH_CALLBACK, token: "t0ken" },
        undefined as never,
      ),
    ).rejects.toThrow("502");
  });
});

describe("createAuth — password reset", () => {
  /**
   * Better Auth defaults this to `false`. A reset is what someone reaches for
   * when they think another person is in their account, so a cookie minted
   * with the old password outliving it defeats the whole flow.
   */
  it("should revoke every existing session when the password is reset", () => {
    expect(build().options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true);
  });

  /**
   * Pins the deliberate half of the same decision: completing a reset proves
   * inbox control but does NOT satisfy `requireEmailVerification`, which is
   * audit #2's gate. An unverified user who resets is refused at sign-in and
   * gets the verification notice instead — see the e2e cohort test in
   * `tests/e2e/password-reset.spec.ts`. Widening what counts as verified is a
   * security decision, so this fails if someone wires it up in passing.
   */
  it("should not treat a completed reset as proof of the address", () => {
    expect(build().options.emailAndPassword?.onPasswordReset).toBeUndefined();
    expect(build().options.emailAndPassword?.requireEmailVerification).toBe(true);
  });
});

describe("createAuth — account linking (audit #2)", () => {
  const linking = () => build().options.account?.accountLinking;

  it("should allow linking so one person is not split across providers", () => {
    expect(linking()?.enabled).toBe(true);
  });

  it("should trust no provider by name", () => {
    // `trustedProviders` means "link even when the provider says the address is
    // UNVERIFIED". Both providers report verification honestly, so naming one
    // here would discard that signal and reopen the pre-hijacking vector.
    expect(linking()?.trustedProviders).toEqual([]);
  });

  it("should refuse to link into a local account that has not proven its address", () => {
    expect(linking()?.requireLocalEmailVerified).toBe(true);
  });

  it("should refuse to link an identity carrying a different address", () => {
    expect(linking()?.allowDifferentEmails).toBe(false);
  });
});

describe("createAuth — rate limiting (audit #4)", () => {
  const rateLimit = () => build().options.rateLimit;

  /**
   * The defect itself. Better Auth defaults `enabled` to `isProduction`, which
   * reads `NODE_ENV` — a variable Workers never set — so the limiter was off in
   * every environment including production. Pinned to a literal so it can never
   * become environment-dependent again.
   */
  it("is on unconditionally, never derived from the environment", () => {
    expect(rateLimit()?.enabled).toBe(true);
  });

  // Reasons 2 and 3 from the finding: the built-in stores cannot work here.
  // `memory` is a module-level Map, so it outlives the per-request `createAuth`
  // but not the isolate — counts are per-isolate and ephemeral, never
  // aggregating across the isolates serving one caller. `database` wants a
  // `rateLimit` table that does not exist in the Drizzle schema.
  it("enforces through the injected storage, not a built-in one", () => {
    expect(rateLimit()?.customStorage?.consume).toBeTypeOf("function");
    expect(rateLimit()?.storage).toBeUndefined();
  });

  it("applies the default class to anything the rules do not name", () => {
    expect(rateLimit()?.window).toBe(RATE_LIMIT_RULES.default.window);
    expect(rateLimit()?.max).toBe(RATE_LIMIT_RULES.default.max);
  });

  it("names the unauthenticated mail endpoints explicitly", () => {
    const rules = rateLimit()?.customRules ?? {};
    expect(rules["/send-verification-email"]).toEqual(RATE_LIMIT_RULES.mail);
    expect(rules["/request-password-reset"]).toEqual(RATE_LIMIT_RULES.mail);
  });

  /**
   * Session storage must stay in D1. Wiring KV as `secondaryStorage` — which
   * the plan originally proposed — moves sessions out of the database
   * (`databaseStoresSessions = !secondaryStorage || …`), so sign-out and
   * revocation would inherit KV's eventual consistency. Rate limiting is not
   * allowed to drag session storage along with it.
   */
  it("leaves session storage in the database", () => {
    expect(build().options.secondaryStorage).toBeUndefined();
  });
});

describe("createAuth — client IP resolution (audit #11)", () => {
  const ipConfig = () => build().options.advanced?.ipAddress;

  it("should read the client IP from cf-connecting-ip", () => {
    expect(ipConfig()?.ipAddressHeaders).toEqual(["cf-connecting-ip"]);
  });

  // A fallback entry would reinstate the spoofable path whenever the trusted
  // header is absent, which is exactly the state an attacker can arrange.
  it("should trust exactly one header, with no spoofable fallback", () => {
    expect(ipConfig()?.ipAddressHeaders).toHaveLength(1);
    expect(ipConfig()?.ipAddressHeaders).not.toContain("x-forwarded-for");
  });
});
