/**
 * Boot check: start each built Worker and prove it serves a request.
 *
 * `pnpm build` proves compilation. This proves the bundle actually runs — the
 * gap that lets a module-init throw pass `pnpm verify` and reach production.
 * Run it after `build`, before `deploy`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  BOOT_ENV_FILE,
  BOOT_TARGETS,
  bootEnvArgs,
  envProbeUrl,
  extractBootError,
  healthUrl,
  isHealthyStatus,
  isRuntimeStartFailure,
  originUrl,
  portOccupiedReason,
  summarize,
  type BootFailure,
  type BootTarget,
} from "./lib/boot-check";

const READY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 500;
/**
 * Both generous on purpose, sized for the worst case rather than the normal one.
 *
 * The `envProbe` request is where the bundle's auth half is first instantiated,
 * so it is far slower than the readiness route the first time. On CI it lands in
 * about 27ms; on a loaded laptop `@starter/mcp` has been measured taking 22–31
 * seconds. A per-request timeout tight enough to abandon that would turn a busy
 * developer machine into a red gate for no reason.
 *
 * That laptop figure was the inherited-`SENTRY_DSN` stall, which `BOOT_ENV_FILE`
 * now makes structurally impossible: the same probe measures 35 ms once nothing
 * is inherited. So these are sized against the one thing still unmeasured — a
 * genuinely loaded machine cold-starting the auth path — and deliberately sit
 * above the old 22–31 s observation even on the assumption that reading was
 * never Sentry at all.
 *
 * They were 120 s / 75 s, sized against that stall. Keeping numbers whose
 * justification has been withdrawn is how a diagnosable hang becomes an
 * unremarkable slow gate: `verify:fast` is documented as the between-edits
 * command, and this now bounds a stuck probe at 45 s per target rather than
 * two minutes. If that proves tight on real hardware, raise it with the
 * measurement attached rather than restoring headroom for its own sake.
 *
 * `PROBE_TIMEOUT_MS` bounds the whole probe including retries;
 * `PROBE_REQUEST_TIMEOUT_MS` bounds one attempt, and is clamped to whatever is
 * left of the former.
 */
const PROBE_TIMEOUT_MS = 45_000;
const PROBE_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Absolute, so it survives `cwd` being set to a target app on spawn. Relative
 * to this module rather than `process.cwd()` for the same reason.
 */
const ENV_FILE_PATH = fileURLToPath(new URL(`../${BOOT_ENV_FILE}`, import.meta.url));

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Kill the whole process group — wrangler spawns workerd as a child. */
function killTree(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

/**
 * Request the target's `envProbe`, if it declares one.
 *
 * Separate from the readiness poll because it answers a different question:
 * readiness proves the bundle runs, this proves the Worker's **bindings** are
 * named the way the code reads them. A renamed binding leaves the runtime
 * perfectly healthy and fails `parseEnv` on the first request that needs it.
 *
 * Retries on transport failures, and only on those. The first request to reach
 * auth is dramatically slower than the readiness route — measured at 22s for
 * `@starter/mcp` on a loaded machine, since it is the request that first builds
 * Better Auth — and wrangler refuses connections while it settles. A status
 * code, by contrast, is an answer: a misnamed binding throws inside `parseEnv`
 * and comes back 500, which must fail immediately rather than be retried for a
 * minute.
 */
async function probeEnv(
  target: BootTarget,
  /** Whatever wrangler has printed so far — the only account of *why* a probe fails. */
  outputSoFar: () => string,
  /** False once the child is gone, so a dead process is not polled to the deadline. */
  isAlive: () => boolean,
): Promise<BootFailure | null> {
  const url = envProbeUrl(target);
  if (!url) return null;

  const fail = (reason: string): BootFailure => {
    const wranglerSaid = extractBootError(outputSoFar());
    return {
      target: target.name,
      reason: wranglerSaid ? `${reason} — wrangler reported: ${wranglerSaid}` : reason,
    };
  };

  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  let lastTransportError = "no response";

  while (Date.now() < deadline) {
    if (!isAlive()) {
      return fail(`${target.envProbe} could not be requested: the Worker exited`);
    }

    // Clamped to what is left of the deadline, or the deadline would bound only
    // the moment a request *starts*: a retry beginning just under it would
    // still get a full per-request timeout, running the probe to nearly
    // `PROBE_TIMEOUT_MS + PROBE_REQUEST_TIMEOUT_MS` and then reporting that
    // nothing answered "within" the shorter of the two.
    // The floor of 1 guards the sliver between the loop's check and this line:
    // `AbortSignal.timeout` rejects a negative argument, and that would surface
    // as a confusing probe failure rather than the timeout it actually is.
    const remaining = Math.max(1, deadline - Date.now());
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(Math.min(PROBE_REQUEST_TIMEOUT_MS, remaining)),
      });
      if (isHealthyStatus(res.status)) {
        console.log(`  ${target.name} → ${target.envProbe} HTTP ${res.status} ok`);
        return null;
      }
      // Deliberately without wrangler's output. A status is a complete answer,
      // and wrangler logs an unrelated `internal error` line often enough that
      // appending it here buries the actual cause under a red herring.
      // Both causes, because the 2xx requirement means a status can arrive
      // from either. A 5xx is the env failing validation; a 404 is far more
      // likely to be the probe route itself having moved — Better Auth owns
      // `/ok`, so an upgrade could take it away. Naming only bindings would
      // send whoever hits that on a hunt through wrangler.jsonc for nothing.
      return {
        target: target.name,
        reason:
          `${target.envProbe} returned HTTP ${res.status}. The Worker started but this ` +
          `request did not succeed: a 5xx usually means a binding name in ` +
          `${target.cwd}/wrangler.jsonc no longer matches the env schema, while a 4xx ` +
          `usually means the probe route itself has moved — check both.`,
      };
    } catch (error) {
      lastTransportError = (error as Error).message;
      await sleep(POLL_INTERVAL_MS);
    }
  }

  return fail(
    `${target.envProbe} never answered within ${PROBE_TIMEOUT_MS / 1000}s (${lastTransportError})`,
  );
}

async function bootOne(target: BootTarget): Promise<BootFailure | null> {
  console.log(`  starting ${target.name} on :${target.port}...`);

  // Refuse to adopt a Worker this check did not start. Must run *before* the
  // spawn: afterwards the readiness poll cannot tell the two apart, and answers
  // `boot ok` for a bundle that never ran. See `portOccupiedReason`.
  const occupied = await fetch(originUrl(target), { signal: AbortSignal.timeout(2_000) })
    .then(() => true)
    .catch(() => false);
  if (occupied) {
    return { target: target.name, reason: portOccupiedReason(target), blocked: true };
  }

  const child = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--port",
      String(target.port),
      "--ip",
      "127.0.0.1",
      // Without these the Worker boots and then refuses every request, because
      // the env fails validation — see BOOT_VARS. The `--env-file` half is what
      // stops the rest of the env arriving from the developer's `.dev.vars`.
      ...bootEnvArgs(ENV_FILE_PATH),
    ],
    { cwd: target.cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );

  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));

  let exited = false;
  child.on("exit", () => (exited = true));

  try {
    const deadline = Date.now() + READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      // Fail fast rather than waiting out the timeout on a runtime that will
      // never come up — this is the signal we most want to surface.
      if (isRuntimeStartFailure(output)) {
        return {
          target: target.name,
          reason: extractBootError(output) ?? "runtime failed to start",
        };
      }
      if (exited) {
        return {
          target: target.name,
          reason: extractBootError(output) ?? "wrangler exited before serving a request",
        };
      }

      try {
        const res = await fetch(healthUrl(target), { signal: AbortSignal.timeout(3_000) });
        if (isHealthyStatus(res.status)) {
          console.log(`  ${target.name} → HTTP ${res.status} ok`);
          // `await`, not a bare `return` of the promise. Returning inside `try`
          // runs the `finally` at the return statement rather than at
          // settlement, so `killTree` would SIGKILL the Worker the instant the
          // probe began and the probe would poll a dead port until its deadline.
          return await probeEnv(
            target,
            () => output,
            () => !exited,
          );
        }
        // Listening but not healthy: a Worker that boots into a broken state.
        return { target: target.name, reason: `${target.path} returned HTTP ${res.status}` };
      } catch {
        // Not up yet — keep polling.
      }

      await sleep(POLL_INTERVAL_MS);
    }

    return {
      target: target.name,
      reason:
        extractBootError(output) ??
        `did not serve ${target.path} within ${READY_TIMEOUT_MS / 1000}s`,
    };
  } finally {
    killTree(child);
  }
}

async function main() {
  console.log("Boot check: starting each built Worker and issuing one request...");

  const failures: BootFailure[] = [];
  // Sequential on purpose: parallel wrangler instances contend for the same
  // local D1/KV state and turn a clean failure into a confusing one.
  for (const target of BOOT_TARGETS) {
    const failure = await bootOne(target);
    if (failure) failures.push(failure);
  }

  console.log(summarize(failures, BOOT_TARGETS.length));
  if (failures.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
