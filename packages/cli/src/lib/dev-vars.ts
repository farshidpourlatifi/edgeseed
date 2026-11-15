import { createHash } from "node:crypto";
import { parseEnv } from "node:util";

/*
 * What a Worker's dev-vars file must hold before the e2e suite starts, decided
 * without ever holding one of its values.
 *
 * Everything here is pure, and nothing here reads a file: the caller hands
 * over the text, `devVarsFacts` turns it into key names and fingerprints, and
 * every message below is built from file paths and key names alone. That is
 * the property to keep — a value, a fingerprint or a length in a message would
 * put a credential, or a way to confirm a guess at one, into a CI log.
 */

// Bindings and wrangler.jsonc-managed vars — real, but never set via .dev.vars.
// The RATE_LIMIT_* entries are `[[ratelimits]]` bindings (audit #4); wrangler
// provides them locally too, so there is nothing for a developer to fill in.
export const NON_DEV_VARS: ReadonlySet<string> = new Set([
  "DB",
  "ENVIRONMENT",
  "OAUTH_KV",
  "RATE_LIMIT_DEFAULT",
  "RATE_LIMIT_CREDENTIALS",
  "RATE_LIMIT_MAIL",
]);

// Keys every Worker must carry the same value for. Both Workers run Better
// Auth against one database and one user set, so a second secret mints
// sessions the other Worker rejects.
export const SHARED_DEV_VARS: readonly string[] = ["BETTER_AUTH_SECRET"];

/** The part of a zod object's `shape` this file needs — no zod import required. */
export type EnvShape = Readonly<
  Record<string, { safeParse(value: unknown): { success: boolean } }>
>;

/**
 * The keys a developer has to set: every field that rejects `undefined`, minus
 * the ones Wrangler supplies. In shape order.
 */
export function requiredDevVars(
  shape: EnvShape,
  nonDevVars: ReadonlySet<string> = NON_DEV_VARS,
): string[] {
  return Object.entries(shape)
    .filter(([key, field]) => !nonDevVars.has(key) && !field.safeParse(undefined).success)
    .map(([key]) => key);
}

/** Per key: the SHA-256 hex of its value, or `null` when the value is empty. Never the value. */
export type DevVarsFacts = ReadonlyMap<string, string | null>;

export function devVarsFacts(content: string): DevVarsFacts {
  const facts = new Map<string, string | null>();
  for (const [key, value] of Object.entries(parseEnv(content))) {
    facts.set(key, value ? createHash("sha256").update(value).digest("hex") : null);
  }
  return facts;
}

export interface WorkerDevVars {
  file: string;
  required: readonly string[];
  /** `null`: the file does not exist. */
  facts: DevVarsFacts | null;
}

/** One line per problem, per worker in order, then per shared key. Empty when there is none. */
export function devVarsProblems(
  workers: readonly WorkerDevVars[],
  shared: readonly string[] = SHARED_DEV_VARS,
): string[] {
  const problems: string[] = [];

  for (const { file, required, facts } of workers) {
    if (required.length === 0) {
      // An empty list means the derivation stopped working, and passing a
      // Worker on "nothing is required" would turn the whole check off.
      problems.push(
        `No required keys were derived for ${file} — the scan is broken, not the file.`,
      );
    } else if (facts === null) {
      problems.push(
        `${file} is missing. Copy ${file}.example to ${file} and set: ${required.join(", ")}.`,
      );
    } else {
      for (const key of required) {
        if (!facts.get(key)) problems.push(`${file} has no value for ${key}.`);
      }
    }
  }

  for (const key of shared) {
    // Only the workers that have a value: one without it already has its own
    // "has no value" line, when the key is required there.
    const holders = workers.filter((worker) => worker.facts?.get(key));
    if (new Set(holders.map((worker) => worker.facts?.get(key))).size > 1) {
      problems.push(
        `${key} differs between ${holders.map((worker) => worker.file).join(" and ")}. ` +
          `Use one value in both: the two Workers share one database and one user set.`,
      );
    }
  }

  return problems;
}
