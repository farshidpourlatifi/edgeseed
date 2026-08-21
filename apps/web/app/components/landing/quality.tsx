import { PRODUCT_SLUG } from "@starter/config/product";
import { APP_VERSION } from "@starter/config/version";
import { Terminal, type ScriptStep } from "@starter/ui/components/ui/terminal";
import { QualityStats } from "./quality-stats";

// Derived, not written out: `init:product` stamps the root package name to the
// slug and `version:bump` writes APP_VERSION alongside the package version, so
// these two are exactly what pnpm prints in a clone as well as here. Hardcoded,
// they showed the starter's directory in every clone — and had already drifted
// a version behind in this repo (issue #32).
const CWD = `~/${PRODUCT_SLUG}`;
const VERIFY_BANNER = `> ${PRODUCT_SLUG}@${APP_VERSION} verify`;

// Animated walkthrough of the real pipeline: verify gate, then mutation run.
// Content mirrors actual command output — keep in sync with the chain.
const PIPELINE_SCRIPT: ScriptStep[] = [
  {
    cmd: "pnpm verify",
    cwd: CWD,
    out: [{ text: VERIFY_BANNER, tone: "dim" }, { text: "" }],
    lineMs: 110,
  },
  { spinner: "eslint .", ms: 800, done: "lint — eslint . clean" },
  {
    spinner: "prettier --check .",
    ms: 700,
    done: "format — All matched files use Prettier code style!",
  },
  { spinner: "vitest run", ms: 1000, done: "unit — vitest run" },
  {
    out: [
      { text: " ✓ packages/db schema.test.ts (33 tests)", tone: "ok" },
      { text: " ✓ ui terminal-timeline.test.ts (16 tests)", tone: "ok" },
      { text: " … 7 more suites", tone: "dim" },
      { text: " Test Files 9 passed (9) · Tests 76 passed (76)" },
    ],
    lineMs: 170,
    after: 350,
  },
  { spinner: "gitleaks git --redact", ms: 700, done: "secrets — gitleaks git --redact" },
  {
    out: [
      { text: " INF 28 commits scanned", tone: "dim" },
      { text: " INF no leaks found", tone: "ok" },
    ],
    lineMs: 170,
    after: 350,
  },
  { spinner: "turbo build", ms: 800, done: "build — 2 tasks successful" },
  {
    out: [{ text: " Time: 33ms >>> FULL TURBO", tone: "cyan" }],
    lineMs: 170,
    after: 350,
  },
  { spinner: "turbo typecheck", ms: 800, done: "types — 8 packages clean" },
  { spinner: "check:boot", ms: 900, done: "boot — 2 workers started and served a request" },
  { spinner: "playwright test", ms: 1300, done: "e2e — Running 9 tests using 1 worker" },
  {
    out: [{ text: " 9 passed (18.6s)", tone: "ok" }],
    lineMs: 170,
    after: 350,
  },
  {
    out: [{ text: "" }, { text: "8 gates passed — deploy unlocked", tone: "accent" }],
    lineMs: 200,
    after: 2000,
  },
  { cmd: "pnpm test:mutation", cwd: CWD, enterPause: 500 },
  {
    spinner: "stryker — mutating 294 sites across packages",
    ms: 1700,
    done: "mutation run complete",
  },
  {
    out: [
      { text: "killed 159   survived 131   no-coverage 4" },
      { text: "mutation score 54.1%", tone: "cyan" },
      { text: "report: reports/mutation/index.html", tone: "dim" },
    ],
    lineMs: 240,
    after: 3200,
  },
];

// Static instant-read summaries of the same runs, rendered with the same
// <Terminal /> chrome as the animated walkthrough (animate={false}).
const VERIFY_SUMMARY: ScriptStep[] = [
  {
    cmd: "pnpm verify",
    cwd: CWD,
    out: [
      "› lint       eslint .                ok",
      "› format     prettier --check .      ok",
      "› test       vitest run (76)         ok",
      "› secrets    gitleaks git --redact   ok",
      "› build      turbo build             ok",
      "› types      turbo typecheck         ok",
      "› boot       check:boot (2 workers)  ok",
      "› e2e        playwright test (9)     ok",
      { text: "8 gates passed — deploy unlocked", tone: "accent" },
    ],
  },
];

const MUTATION_SUMMARY: ScriptStep[] = [
  {
    cmd: "pnpm test:mutation",
    cwd: CWD,
    out: [
      "Stryker  mutating packages + app server…",
      "killed 159   survived 131   no-coverage 4",
      "mutation score 54.1%",
      { text: "report: reports/mutation/index.html", tone: "accent" },
    ],
  },
];

export function Quality() {
  return (
    <section id="quality" className="scroll-mt-16 border-b bg-muted/30">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-20 sm:px-6 md:py-24">
        <div className="flex max-w-2xl flex-col gap-4">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Quality gates you cannot skip
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground text-pretty">
            The same commands run on your machine and in CI. If a gate fails, the deploy never
            starts.
          </p>
        </div>

        <QualityStats />

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="flex flex-col gap-4">
            <Terminal
              script={VERIFY_SUMMARY}
              animate={false}
              label="pnpm verify"
              height="auto"
              className="w-full"
            />
            <Terminal
              script={MUTATION_SUMMARY}
              animate={false}
              label="pnpm test:mutation"
              height="auto"
              className="w-full"
            />
          </div>

          <div id="terminal-demo" className="w-full">
            <Terminal
              script={PIPELINE_SCRIPT}
              label="pipeline walkthrough"
              height="24rem"
              className="h-full w-full"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
