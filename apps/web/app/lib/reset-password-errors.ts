/**
 * Better Auth's password bounds, mirrored for the form's own `minLength` /
 * `maxLength` (`create-context.mjs`: `minPasswordLength || 8`,
 * `maxPasswordLength || 128`).
 *
 * A mirror can drift — configure `emailAndPassword.minPasswordLength` and these
 * are wrong. That is survivable **because the message below is chosen from the
 * server's own error code, not from these numbers**: a desynced attribute lets
 * a bad password reach the server, and the server's answer still produces the
 * right sentence. The attributes are a convenience; the codes are the contract.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/** The shape better-auth's client returns on a rejected call. */
export interface ResetErrorLike {
  code?: string;
  status?: number;
}

const LINK_DEAD = "That reset link is no longer valid. Request a new one and try again." as const;

/**
 * Turn a rejected `resetPassword` into something worth reading.
 *
 * This exists because the first cut answered *every* non-429 failure with
 * "your link is dead". `POST /reset-password` validates the password **before**
 * it consumes the token (better-auth `api/routes/password.mjs`: the length
 * checks precede `consumeVerificationValue`), so a password outside the bounds
 * is refused while the link is still perfectly good. Telling that reader to
 * request a new link sends them around a loop that cannot terminate — they
 * fetch a fresh link, paste the same password, and get the same sentence.
 *
 * Reachable, not theoretical: the form caps length client-side now, but it did
 * not before, and a paste over 128 characters is the ordinary way to hit it.
 *
 * The default is deliberately **not** the dead-link line. An unrecognised
 * failure is not evidence the token is bad, and guessing that it is recreates
 * the bug in a smaller form.
 */
export function resetErrorMessage(error: ResetErrorLike): string {
  if (error.status === 429) return "Too many attempts. Wait a minute and try again.";

  switch (error.code) {
    case "INVALID_TOKEN":
      return LINK_DEAD;
    case "PASSWORD_TOO_SHORT":
      return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    case "PASSWORD_TOO_LONG":
      return `Use no more than ${MAX_PASSWORD_LENGTH} characters.`;
    default:
      return "Could not reset your password. Try again.";
  }
}
