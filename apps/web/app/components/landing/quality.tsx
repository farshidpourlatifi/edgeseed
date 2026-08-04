import { Terminal } from "@starter/ui/components/ui/terminal";
import type { ScriptStep } from "@starter/ui/components/ui/terminal-timeline";
import { QualityStats } from "./quality-stats";

// Animated walkthrough of the real pipeline: verify gate, then mutation run.
// Content mirrors actual command output — keep in sync with the chain.
const PIPELINE_SCRIPT: ScriptStep[] = [
  {
    cmd: "pnpm verify",
    cwd: "~/cloudflare-starter",
    out: [{ text: "> cloudflare-starter@0.1.0 verify", tone: "dim" }, { text: "" }],
    lineMs: 110,
  },
  { spinner: "eslint .", ms: 900, done: "lint — no errors" },
  { spinner: "prettier --check .", ms: 700, done: "format — all files clean" },
  { spinner: "vitest run", ms: 900, done: "unit — 60 tests passed" },
  { spinner: "gitleaks git --redact", ms: 700, done: "secrets — no leaks found" },
  { spinner: "turbo build + typecheck", ms: 1100, done: "build + types — ok" },
  { spinner: "playwright test", ms: 1300, done: "e2e — 8 passed" },
  {
    out: [{ text: "" }, { text: "7 gates passed — deploy unlocked", tone: "accent" }],
    lineMs: 200,
    after: 2000,
  },
  { cmd: "pnpm test:mutation", cwd: "~/cloudflare-starter", enterPause: 500 },
  { spinner: "stryker — mutating schema, helpers, api", ms: 1700, done: "169 mutants tested" },
  {
    out: [
      { text: "killed 78   survived 87   no-coverage 4" },
      { text: "mutation score 46.2%", tone: "cyan" },
      { text: "report: reports/mutation/index.html", tone: "dim" },
    ],
    lineMs: 240,
    after: 3200,
  },
];

// Mirrors the real `pnpm verify` chain and a real Stryker run — keep in sync.
const terminals = [
  {
    title: "pnpm verify",
    lines: [
      { prompt: true, text: "pnpm verify" },
      { text: "› lint       eslint .                ok" },
      { text: "› format     prettier --check .      ok" },
      { text: "› test       vitest run (60)         ok" },
      { text: "› secrets    gitleaks git --redact   ok" },
      { text: "› build      turbo build             ok" },
      { text: "› types      turbo typecheck         ok" },
      { text: "› e2e        playwright test (8)     ok" },
      { text: "7 gates passed — deploy unlocked", accent: true },
    ],
  },
  {
    title: "pnpm test:mutation",
    lines: [
      { prompt: true, text: "pnpm test:mutation" },
      { text: "Stryker  mutating schema, helpers, api…" },
      { text: "killed 78   survived 87   no-coverage 4" },
      { text: "mutation score 46.2%" },
      { text: "report: reports/mutation/index.html", accent: true },
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

        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="flex flex-col gap-4">
            {terminals.map((terminal) => (
              <div
                key={terminal.title}
                className="overflow-hidden rounded-xl border bg-zinc-950 shadow-sm"
              >
                <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                  <span className="flex gap-1.5" aria-hidden="true">
                    <span className="size-2.5 rounded-full bg-zinc-700" />
                    <span className="size-2.5 rounded-full bg-zinc-700" />
                    <span className="size-2.5 rounded-full bg-zinc-700" />
                  </span>
                  <span className="font-mono text-xs text-zinc-400">{terminal.title}</span>
                </div>
                <pre className="overflow-x-auto px-4 py-4 font-mono text-xs leading-relaxed text-zinc-300">
                  <code>
                    {terminal.lines.map((line, index) => (
                      <span
                        key={index}
                        className={
                          line.accent
                            ? "block text-sky-400"
                            : line.prompt
                              ? "block text-zinc-100"
                              : "block"
                        }
                      >
                        {line.prompt ? <span className="text-sky-400">$ </span> : null}
                        {line.text}
                      </span>
                    ))}
                  </code>
                </pre>
              </div>
            ))}
          </div>

          <div id="terminal-demo" className="w-full">
            <Terminal
              script={PIPELINE_SCRIPT}
              label="pipeline walkthrough"
              height="24rem"
              className="w-full"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
