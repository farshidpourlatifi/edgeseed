import { stripAnsi } from "./boot-check";

/*
 * Turning "the Worker answered the env probe with a non-2xx" into a message
 * that says which key was rejected. Pure: the caller supplies the Worker's
 * captured output and both durations, and nothing here reads a clock, a file
 * or a process.
 *
 * The message quotes the Worker's own last output lines. That is safe only
 * while those lines carry no env value: Wrangler prints dev-var values as
 * `"(hidden)"`, a zod issue names the key and not the input, and request logs
 * pass through `redact()`. Nothing read from a dev-vars file belongs in here.
 */

/** How long the Worker's output must have been silent before it is read. */
export const REFUSAL_QUIET_MS = 300;
/** The longest a caller waits for the output to settle. */
export const REFUSAL_SETTLE_CAP_MS = 10_000;

// A zod issue's `"path": [ "KEY" ]`, as the Worker prints it — spread over
// lines, with the quote-and-`+` noise of an inspected string between them.
const ISSUE_PATH = /"path":\s*\[[^\]]*?"([A-Za-z_][A-Za-z0-9_]*)"/g;

/** The last `lines` non-empty lines of the output, without colour codes. */
export function outputTail(output: string, lines = 40): string {
  return stripAnsi(output)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-lines)
    .join("\n");
}

/**
 * The env keys the Worker's last `ZodError` names: unique, in first-seen order.
 * Only the last block, since an earlier request's rejection is not this one's.
 */
export function refusedEnvKeys(output: string): string[] {
  const clean = stripAnsi(output);
  const start = clean.lastIndexOf("ZodError");
  if (start === -1) return [];
  return [...new Set([...clean.slice(start).matchAll(ISSUE_PATH)].map((match) => match[1]))];
}

/**
 * Whether the output can be read yet.
 *
 * The Worker's lines for a refused request are not guaranteed to have reached
 * the parent's pipe when the response does. So: wait for the output to go
 * quiet, and for a 5xx also for a rejected key to appear — up to the cap,
 * after which the message is built from whatever arrived.
 */
export function refusalOutputSettled(input: {
  status: number;
  output: string;
  quietMs: number;
  waitedMs: number;
}): boolean {
  if (input.waitedMs >= REFUSAL_SETTLE_CAP_MS) return true;
  if (input.quietMs < REFUSAL_QUIET_MS) return false;
  return input.status < 500 || refusedEnvKeys(input.output).length > 0;
}

export function envRefusalMessage(input: {
  origin: string;
  probe: string;
  status: number;
  devVarsFile: string;
  wranglerFile: string;
  output: string;
}): string {
  const { origin, probe, status, devVarsFile, wranglerFile, output } = input;
  const tail = ["The Worker's output, last lines:", outputTail(output)];

  // A status below 500 is not the env: `parseEnv` throwing is a 500. Naming
  // the dev-vars file here would send the reader to the wrong place.
  if (status < 500) {
    return [
      `The MCP Worker answered GET ${probe} with HTTP ${status}. A 4xx here usually ` +
        `means the probe route moved, not that the env is wrong.`,
      ...tail,
    ].join("\n");
  }

  const keys = refusedEnvKeys(output);
  // Both files, because a rejected key is either a dev var that is unset or a
  // binding whose name in wrangler.jsonc no longer matches the schema.
  const where =
    `Dev vars are set in ${devVarsFile} (template: ${devVarsFile}.example); ` +
    `bindings are named in ${wranglerFile}.`;

  if (keys.length === 0) {
    return [
      `The MCP Worker is listening on ${origin} but answered GET ${probe} with HTTP ` +
        `${status}, and its output names no rejected env key.`,
      where,
      ...tail,
    ].join("\n");
  }

  return [
    `The MCP Worker is listening on ${origin} but refused GET ${probe} (HTTP ${status}): ` +
      `its env did not parse.`,
    `Rejected: ${keys.join(", ")}.`,
    where,
    ...tail,
  ].join("\n");
}
