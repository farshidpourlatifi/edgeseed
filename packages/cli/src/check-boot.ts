/**
 * Boot check: start each built Worker and prove it serves a request.
 *
 * `pnpm build` proves compilation. This proves the bundle actually runs — the
 * gap that lets a module-init throw pass `pnpm verify` and reach production.
 * Run it after `build`, before `deploy`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  BOOT_TARGETS,
  bootVarArgs,
  extractBootError,
  healthUrl,
  isHealthyStatus,
  isRuntimeStartFailure,
  summarize,
  type BootFailure,
  type BootTarget,
} from "./lib/boot-check";

const READY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 500;

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

async function bootOne(target: BootTarget): Promise<BootFailure | null> {
  console.log(`  starting ${target.name} on :${target.port}...`);

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
      // the env fails validation — see BOOT_VARS.
      ...bootVarArgs(),
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
          return null;
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
