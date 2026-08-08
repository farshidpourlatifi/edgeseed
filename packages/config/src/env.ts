import { z } from "zod";

/**
 * Better Auth's built-in fallback secret, verified against the installed
 * `better-auth@1.6.26` (`dist/utils/constants.mjs`).
 *
 * Rejected explicitly because length alone does not catch it: the constant is 38
 * characters, so `.min(32)` accepts it. Better Auth's own guard against it is
 * gated on `NODE_ENV === "production"`, which Workers never set — so without
 * this check it reaches production after nothing louder than a console warning.
 *
 * It signs session cookies *and* email-verification JWTs, which is why this is
 * load-bearing rather than hygiene: anyone reading Better Auth's public source
 * could forge a session or mint a verification token for an address they do not
 * own. See `docs/security-audit.md` #3.
 */
const BETTER_AUTH_DEFAULT_SECRET = "better-auth-secret-12345678901234567890";

/**
 * Optional binding whose "unset" spelling is an **empty string**, not absence.
 *
 * `.dev.vars` and `wrangler secret` both deliver a blank key as `""`, and every
 * optional key in `.dev.vars.example` ships exactly that way (`MARKETING_URL=`).
 * Plain `.optional()` only admits `undefined`, so a copied-verbatim example file
 * failed validation — and since the env is now validated on every request, that
 * meant a 500 on the documented setup path, reported as a Zod URL error with
 * nothing pointing at `.dev.vars`.
 *
 * The trap was already known for enums: `.dev.vars.example` shipped `LOG_LEVEL`
 * commented out with a note that the schema rejects an empty string for it. This
 * fixes the cause instead of working around it one key at a time.
 */
function optionalBinding<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

/**
 * A Workers rate-limiting binding (`[[ratelimits]]` in wrangler.jsonc).
 *
 * Checks for the `limit` method rather than mere presence, because the failure
 * this guards against is a *misnamed* binding, not an absent one: wrangler
 * happily deploys a Worker whose binding names do not match the code, and the
 * limiter would then be silently off — which is the whole of audit #4.
 *
 * Required, not optional. An unset limiter refuses every request through
 * `parseEnv` instead of serving an unthrottled auth surface (`fail closed`).
 */
function rateLimitBinding(name: string) {
  return z.custom<RateLimit>(
    (v) => typeof (v as RateLimit | undefined)?.limit === "function",
    `${name} rate-limiting binding required — see [[ratelimits]] in wrangler.jsonc`,
  );
}

/** Shared bindings available to all apps */
const sharedEnvSchema = z.object({
  DB: z.custom<D1Database>((v) => v != null, "D1 binding required"),

  // --- Rate limiting (audit #4) — one binding per enforcement class, because a
  // binding carries exactly one limit/period pair. The classes and the paths
  // that map to them live in `packages/auth/src/rate-limit.ts`; the numbers in
  // wrangler.jsonc must match the table there.
  RATE_LIMIT_DEFAULT: rateLimitBinding("RATE_LIMIT_DEFAULT"),
  RATE_LIMIT_CREDENTIALS: rateLimitBinding("RATE_LIMIT_CREDENTIALS"),
  RATE_LIMIT_MAIL: rateLimitBinding("RATE_LIMIT_MAIL"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .refine((secret) => secret !== BETTER_AUTH_DEFAULT_SECRET, {
      message: "BETTER_AUTH_SECRET is Better Auth's built-in default — set a real secret",
    }),
  /** Empty is treated as unset so the default applies, as for any blank key. */
  ENVIRONMENT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["development", "staging", "production"]).default("development"),
  ),
  GITHUB_CLIENT_ID: optionalBinding(z.string()),
  GITHUB_CLIENT_SECRET: optionalBinding(z.string()),
  GOOGLE_CLIENT_ID: optionalBinding(z.string()),
  GOOGLE_CLIENT_SECRET: optionalBinding(z.string()),

  // --- Transactional email (both optional: absent falls back to logging the message) ---
  /** Resend API key. Needed together with EMAIL_FROM, or the fallback is used. */
  RESEND_API_KEY: optionalBinding(z.string()),
  /** Verified sender, plain or `"Name <addr@domain>"`. The domain must be verified in Resend. */
  EMAIL_FROM: optionalBinding(z.string()),

  // --- Observability (all optional: logging works standalone, Sentry is opt-in) ---
  /** Absent/empty disables Sentry entirely — `withSentry` becomes a pass-through. */
  SENTRY_DSN: optionalBinding(z.string()),
  /** Overrides ENVIRONMENT for the Sentry `environment` tag. */
  SENTRY_ENVIRONMENT: optionalBinding(z.string()),
  /** Overrides APP_VERSION for the Sentry `release` tag. */
  SENTRY_RELEASE: optionalBinding(z.string()),
  /** Fraction of requests traced, 0..1. Bindings arrive as strings. */
  SENTRY_TRACES_SAMPLE_RATE: optionalBinding(z.coerce.number().min(0).max(1)),
  /** Overrides the level derived from ENVIRONMENT. */
  LOG_LEVEL: optionalBinding(z.enum(["debug", "info", "warn", "error"])),
});

/** Web app Worker bindings */
export const webEnvSchema = sharedEnvSchema.extend({
  /** Public origin. Required only here — the MCP Worker derives its origin per request. */
  BETTER_AUTH_URL: z.string().url(),
  /**
   * Marketing origin, when the landing page lives on its own hostname.
   *
   * Optional, and absent is the default: one origin serves the landing page and
   * the app together, which is what `pnpm dev` does on localhost. Set it and
   * app paths move to `BETTER_AUTH_URL`'s origin. See docs/domains.md.
   */
  MARKETING_URL: optionalBinding(z.string().url()),
});

/** MCP server Worker bindings — no BETTER_AUTH_URL: `baseURL` derives from the request origin. */
export const mcpEnvSchema = sharedEnvSchema.extend({});

export type SharedEnv = z.infer<typeof sharedEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;
export type McpEnv = z.infer<typeof mcpEnvSchema>;

/** Parse and validate Worker env bindings */
export function parseEnv<T extends z.ZodType>(schema: T, env: unknown): z.infer<T> {
  return schema.parse(env);
}
