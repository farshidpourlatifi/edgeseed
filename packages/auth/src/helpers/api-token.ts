/** Every issued token starts with this, so leaked strings are greppable. */
export const API_TOKEN_PREFIX = "sk_";

/** 256 bits of entropy — brute force is not a threat model. */
const TOKEN_BYTES = 32;

/** Leading characters kept in plaintext for display in a token list. */
const DISPLAY_PREFIX_LENGTH = API_TOKEN_PREFIX.length + 8;

export interface GeneratedApiToken {
  /** Shown to the user exactly once. Never persist this. */
  token: string;
  /** Store this. */
  tokenHash: string;
  /** Store this — safe to display. */
  prefix: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hash a token for storage and lookup.
 *
 * SHA-256 rather than a password KDF on purpose: these tokens are 256 bits of
 * CSPRNG output, not user-chosen secrets, so there is nothing to brute force and
 * a slow KDF would only tax every authenticated request. This mirrors how GitHub
 * and Stripe store API keys.
 *
 * Lookups match on this hash via a unique index, so no secret comparison ever
 * happens in application code and there is no timing side channel to leak.
 */
export async function hashApiToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(digest);
}

/** Mint a new token. The plaintext is returned once and never stored. */
export async function generateApiToken(): Promise<GeneratedApiToken> {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);

  const token = `${API_TOKEN_PREFIX}${toBase64Url(bytes)}`;
  return {
    token,
    tokenHash: await hashApiToken(token),
    prefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

/** Shape check only — says nothing about whether the token exists or is valid. */
export function isApiTokenFormat(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(API_TOKEN_PREFIX) && value.length > 20;
}

/**
 * Pull the credential out of an `Authorization` header.
 * Returns null for anything that is not a well-formed `Bearer` header.
 */
export function extractBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** A stored token is usable only if it is neither revoked nor past its expiry. */
export function isApiTokenUsable(
  token: { revokedAt?: Date | null; expiresAt?: Date | null },
  now: Date = new Date(),
): boolean {
  if (token.revokedAt) return false;
  if (token.expiresAt && token.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}
