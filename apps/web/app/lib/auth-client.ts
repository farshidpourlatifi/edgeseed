import { createBetterAuthClient } from "@starter/auth/client";

export const authClient = createBetterAuthClient();

/**
 * Where a freshly verified address lands.
 *
 * Every call that mints a verification link must pass this as `callbackURL`.
 * Better Auth defaults it to `"/"` (`sign-up.mjs`: `body.callbackURL ? … :
 * encodeURIComponent("/")`) and `/verify-email` redirects there after
 * `autoSignInAfterVerification` sets the session — so omitting it drops a
 * just-signed-in user on the landing page, and in split-origin mode
 * `server/origins.ts` then bounces them to the marketing host while their
 * cookie stays on the app host, which reads as being logged out.
 *
 * One constant rather than two literals because "where a verified user lands"
 * is a single fact: sign-up and resend drifted apart exactly once already.
 */
export const POST_VERIFICATION_REDIRECT = "/dashboard";
