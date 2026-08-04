/**
 * Pure model for the <Terminal /> animation: a script of steps compiles to a
 * timeline of absolutely-timed blocks, and `stateAt(timeline, ms)` derives
 * what is on screen at any instant. No React, no side effects — fully unit-
 * and mutation-testable.
 */

export type Tone = "plain" | "dim" | "ok" | "warn" | "err" | "accent" | "cyan";

export interface OutLine {
  text: string;
  tone?: Tone | null;
}

export interface ScriptStep {
  /** Command typed at the prompt */
  cmd?: string;
  /** Prompt cwd shown for this command (and the idle prompt after the script) */
  cwd?: string;
  /** Typing speed in chars/second */
  cps?: number;
  /** Pause between finishing typing and output, ms */
  enterPause?: number;
  /** Spinner label while "working" */
  spinner?: string;
  /** Spinner duration, ms */
  ms?: number;
  /** Text shown when the spinner finishes */
  done?: string;
  /** Output lines revealed one by one */
  out?: Array<string | OutLine>;
  /** Delay between output lines, ms */
  lineMs?: number;
  /** Extra pause after this step, ms */
  after?: number;
}

export const DEFAULTS = { cps: 11, enterPause: 420, lineMs: 130, after: 280 } as const;
export const SPINNER_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const SPINNER_FRAME_MS = 80;
const MIN_TYPE_MS = 240;
const TAIL_MS = 600;

interface BlockBase {
  id: string;
  start: number;
}
export interface CmdBlock extends BlockBase {
  kind: "cmd";
  text: string;
  cwd: string;
  typeMs: number;
}
export interface SpinnerBlock extends BlockBase {
  kind: "spinner";
  label: string;
  done: string;
  ms: number;
}
export interface OutBlock extends BlockBase {
  kind: "out";
  lines: OutLine[];
  lineMs: number;
}
export type Block = CmdBlock | SpinnerBlock | OutBlock;

export interface Timeline {
  blocks: Block[];
  /** Total length of the animation, ms (includes a short tail) */
  duration: number;
  /** cwd for the idle prompt once the script finishes */
  promptCwd: string;
}

export type VisibleBlock =
  | (CmdBlock & { typed: string; typing: boolean })
  | (SpinnerBlock & { running: boolean; glyph: string })
  | (OutBlock & { shown: OutLine[] });

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const norm = (l: string | OutLine): OutLine =>
  typeof l === "string" ? { text: l, tone: null } : l;

/** Compile a script into absolutely-timed blocks. */
export function buildTimeline(script: ScriptStep[]): Timeline {
  const blocks: Block[] = [];
  let t = 0;
  let promptCwd = "~";

  script.forEach((step, i) => {
    if (step.cmd != null) {
      const cps = step.cps ?? DEFAULTS.cps;
      const typeMs = Math.max(MIN_TYPE_MS, (step.cmd.length / cps) * 1000);
      const cwd = step.cwd ?? "~";
      promptCwd = cwd;
      blocks.push({ id: `${i}c`, kind: "cmd", text: step.cmd, cwd, start: t, typeMs });
      t += typeMs + (step.enterPause ?? DEFAULTS.enterPause);
    }
    if (step.spinner != null) {
      const ms = step.ms ?? 1200;
      blocks.push({
        id: `${i}s`,
        kind: "spinner",
        label: step.spinner,
        done: step.done ?? step.spinner,
        start: t,
        ms,
      });
      t += ms;
    }
    if (step.out != null) {
      const lineMs = step.lineMs ?? DEFAULTS.lineMs;
      const lines = step.out.map(norm);
      blocks.push({ id: `${i}o`, kind: "out", lines, start: t, lineMs });
      t += lineMs * lines.length;
    }
    t += step.after ?? DEFAULTS.after;
  });

  return { blocks, duration: Math.round(t + TAIL_MS), promptCwd };
}

/** Pure: timeline + elapsed ms -> what's on screen. Blocks are start-ordered. */
export function stateAt(timeline: Timeline, ms: number): VisibleBlock[] {
  const out: VisibleBlock[] = [];
  for (const b of timeline.blocks) {
    if (ms < b.start) break;
    if (b.kind === "cmd") {
      const p = clamp((ms - b.start) / b.typeMs, 0, 1);
      out.push({ ...b, typed: b.text.slice(0, Math.round(p * b.text.length)), typing: p < 1 });
    } else if (b.kind === "spinner") {
      const running = ms < b.start + b.ms;
      out.push({
        ...b,
        running,
        glyph:
          SPINNER_FRAMES[
            Math.floor(Math.max(0, ms - b.start) / SPINNER_FRAME_MS) % SPINNER_FRAMES.length
          ],
      });
    } else {
      const n = clamp(Math.floor((ms - b.start) / b.lineMs) + 1, 0, b.lines.length);
      out.push({ ...b, shown: b.lines.slice(0, n) });
    }
  }
  return out;
}

/** Cheap identity for "has the visible content actually changed?" */
export function keyOf(visible: VisibleBlock[]): string {
  return visible
    .map((b) =>
      b.kind === "cmd"
        ? "c" + b.typed.length
        : b.kind === "out"
          ? "o" + b.shown.length
          : "s" + (b.running ? b.glyph : "!"),
    )
    .join("|");
}

/** Finished transcript for screen readers. */
export function transcriptOf(timeline: Timeline): string {
  return timeline.blocks
    .map((b) =>
      b.kind === "cmd"
        ? `${b.cwd} $ ${b.text}`
        : b.kind === "spinner"
          ? b.done
          : b.lines.map((l) => l.text).join("\n"),
    )
    .join("\n");
}
