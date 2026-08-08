import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { PRODUCT_NAME } from "@starter/config/product";
import type { Database } from "@starter/db";
import { passwordResetEmail, verificationEmail, type EmailSender } from "@starter/email";
import {
  AUTH_RATE_LIMIT_CUSTOM_RULES,
  createRateLimitStorage,
  RATE_LIMIT_RULES,
  type RateLimiters,
} from "./rate-limit";

export interface CreateAuthOptions {
  db: Database;
  secret: string;
  baseURL: string;
  /**
   * Transport for verification and reset mail. Required rather than optional:
   * every path that mints a single-use link needs somewhere to send it, and a
   * silent default would make a misconfigured deployment look healthy.
   */
  email: EmailSender;
  /**
   * Workers rate-limit bindings, one per enforcement class. Required for the
   * same reason `email` is: an optional limiter is a limiter that a new Worker
   * silently ships without, which is how audit #4 existed at all.
   */
  rateLimiters: RateLimiters;
  githubClientId?: string;
  githubClientSecret?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  waitUntil?: (p: Promise<unknown>) => void;
}

/** Create a Better Auth instance configured for D1 + Drizzle */
export function createAuth(opts: CreateAuthOptions) {
  return betterAuth({
    database: drizzleAdapter(opts.db, { provider: "sqlite" }),
    secret: opts.secret,
    baseURL: opts.baseURL,
    basePath: "/api/auth",
    emailAndPassword: {
      enabled: true,
      /**
       * Sign-up creates the row but grants no session until the address is
       * proven. This is the half of audit #2 that email/password owns: a
       * pre-registered account the attacker cannot verify is inert.
       */
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await opts.email.send({
          to: user.email,
          ...passwordResetEmail({ url, productName: PRODUCT_NAME }),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      /** The click is proof enough; making them retype the password buys nothing. */
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await opts.email.send({
          to: user.email,
          ...verificationEmail({ url, productName: PRODUCT_NAME }),
        });
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        /**
         * Deliberately empty. `trustedProviders` does not mean "providers we
         * like" — it means "link even when the provider says the email is
         * UNVERIFIED" (better-auth `oauth2/link-account.mjs`: the refusal is
         * `!isTrustedProvider && !userInfo.emailVerified`). Google and GitHub
         * both report verification honestly, so naming them here would only
         * discard a signal we are already getting for free.
         */
        trustedProviders: [],
        /**
         * The other half of audit #2: never link a social identity into a
         * local account that has not proven its own address, or pre-registering
         * a victim's email is enough to inherit their OAuth sign-in.
         * Better Auth 1.6 defaults this to true — pinned because the whole
         * defence rests on it.
         */
        requireLocalEmailVerified: true,
        /** Linking is same-address only; a different address is a new account. */
        allowDifferentEmails: false,
      },
    },
    /**
     * Audit #4. `enabled` is pinned rather than derived: Better Auth's default
     * is `isProduction`, which reads `NODE_ENV` — never set on Workers — so the
     * limiter was off everywhere. Never make this conditional again.
     *
     * `storage` is deliberately absent: `customStorage` is consulted first and
     * wins outright, so naming a storage here would only mislead. The window and
     * max below are the `default` class, applied to any `/api/auth` path the
     * rules do not name. See `rate-limit.ts` for why a Workers binding backs
     * this rather than the KV secondary storage the plan proposed.
     */
    rateLimit: {
      enabled: true,
      window: RATE_LIMIT_RULES.default.window,
      max: RATE_LIMIT_RULES.default.max,
      customStorage: createRateLimitStorage(opts.rateLimiters),
      customRules: AUTH_RATE_LIMIT_CUSTOM_RULES,
    },
    advanced: {
      ipAddress: {
        /**
         * Cloudflare **appends** the real visitor IP to any client-supplied
         * `X-Forwarded-For`, so Better Auth's default of `x-forwarded-for` then
         * `split(",")[0]` reads a value the caller chose. That IP keys rate
         * limiting and is recorded as `session.ipAddress`, so trusting it means
         * a limiter bypassed by rotating a header and audit data that lies.
         *
         * `cf-connecting-ip` is set by the edge and cannot be spoofed by the
         * client. Single-entry list on purpose: adding a fallback would restore
         * the spoofable path whenever the trusted header is absent.
         * See `docs/security-audit.md` #11.
         */
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    socialProviders: {
      ...(opts.githubClientId && opts.githubClientSecret
        ? {
            github: {
              clientId: opts.githubClientId,
              clientSecret: opts.githubClientSecret,
            },
          }
        : {}),
      ...(opts.googleClientId && opts.googleClientSecret
        ? {
            google: {
              clientId: opts.googleClientId,
              clientSecret: opts.googleClientSecret,
            },
          }
        : {}),
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: "owner",
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
