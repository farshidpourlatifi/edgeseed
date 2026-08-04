import { describe, it, expect } from "vitest";
import {
  buildTimeline,
  stateAt,
  keyOf,
  transcriptOf,
  DEFAULTS,
  SPINNER_FRAMES,
  type ScriptStep,
} from "../terminal-timeline";

const script: ScriptStep[] = [
  {
    cmd: "pnpm test",
    cwd: "~/repo",
    enterPause: 100,
    out: ["line one", { text: "line two", tone: "ok" }],
    lineMs: 100,
    after: 50,
  },
  { spinner: "working", ms: 400, done: "worked", after: 0 },
];

describe("buildTimeline", () => {
  const tl = buildTimeline(script);

  it("compiles cmd, out, and spinner steps into start-ordered blocks", () => {
    expect(tl.blocks.map((b) => b.kind)).toEqual(["cmd", "out", "spinner"]);
    const starts = tl.blocks.map((b) => b.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("schedules output after typing plus the enter pause", () => {
    const [cmd, out] = tl.blocks;
    expect(cmd.kind).toBe("cmd");
    if (cmd.kind !== "cmd" || out.kind !== "out") throw new Error("unexpected kinds");
    expect(cmd.start).toBe(0);
    expect(out.start).toBe(cmd.typeMs + 100);
  });

  it("enforces a minimum typing duration", () => {
    const fast = buildTimeline([{ cmd: "x", cps: 1000 }]);
    const cmd = fast.blocks[0];
    if (cmd.kind !== "cmd") throw new Error("unexpected kind");
    expect(cmd.typeMs).toBe(240);
  });

  it("total duration covers every block plus the tail", () => {
    const spinner = tl.blocks[2];
    expect(tl.duration).toBeGreaterThan(spinner.start + 400);
  });

  it("normalizes string lines and keeps tones", () => {
    const out = tl.blocks[1];
    if (out.kind !== "out") throw new Error("unexpected kind");
    expect(out.lines[0]).toEqual({ text: "line one", tone: null });
    expect(out.lines[1]).toEqual({ text: "line two", tone: "ok" });
  });

  it("exposes the last command's cwd for the idle prompt", () => {
    expect(tl.promptCwd).toBe("~/repo");
    expect(buildTimeline([{ spinner: "s" }]).promptCwd).toBe("~");
  });

  it("applies defaults when a step omits timings", () => {
    const defaulted = buildTimeline([{ cmd: "abcdefghijk" }]); // 11 chars at 11 cps = 1s
    const cmd = defaulted.blocks[0];
    if (cmd.kind !== "cmd") throw new Error("unexpected kind");
    expect(cmd.typeMs).toBe(1000);
    expect(DEFAULTS.cps).toBe(11);
  });
});

describe("stateAt", () => {
  const tl = buildTimeline(script);
  const cmd = tl.blocks[0];
  const out = tl.blocks[1];
  const spinner = tl.blocks[2];
  if (cmd.kind !== "cmd" || out.kind !== "out" || spinner.kind !== "spinner")
    throw new Error("unexpected kinds");

  it("shows nothing before the first block", () => {
    expect(stateAt(tl, -1)).toEqual([]);
  });

  it("types the command progressively", () => {
    const half = stateAt(tl, cmd.typeMs / 2)[0];
    if (half.kind !== "cmd") throw new Error("unexpected kind");
    expect(half.typing).toBe(true);
    expect(half.typed.length).toBeGreaterThan(0);
    expect(half.typed.length).toBeLessThan(cmd.text.length);
    expect(cmd.text.startsWith(half.typed)).toBe(true);
  });

  it("finishes typing exactly at typeMs", () => {
    const doneTyping = stateAt(tl, cmd.typeMs)[0];
    if (doneTyping.kind !== "cmd") throw new Error("unexpected kind");
    expect(doneTyping.typed).toBe("pnpm test");
    expect(doneTyping.typing).toBe(false);
  });

  it("reveals output lines one per lineMs", () => {
    const first = stateAt(tl, out.start)[1];
    if (first.kind !== "out") throw new Error("unexpected kind");
    expect(first.shown).toHaveLength(1);

    const second = stateAt(tl, out.start + 100)[1];
    if (second.kind !== "out") throw new Error("unexpected kind");
    expect(second.shown).toHaveLength(2);
  });

  it("runs the spinner then settles on done", () => {
    const running = stateAt(tl, spinner.start + 1)[2];
    if (running.kind !== "spinner") throw new Error("unexpected kind");
    expect(running.running).toBe(true);
    expect(SPINNER_FRAMES).toContain(running.glyph);

    const settled = stateAt(tl, spinner.start + 400)[2];
    if (settled.kind !== "spinner") throw new Error("unexpected kind");
    expect(settled.running).toBe(false);
  });

  it("advances the spinner glyph from frame zero, one frame per 80ms", () => {
    const a = stateAt(tl, spinner.start)[2];
    const b = stateAt(tl, spinner.start + 80)[2];
    const c = stateAt(tl, spinner.start + 165)[2];
    if (a.kind !== "spinner" || b.kind !== "spinner" || c.kind !== "spinner")
      throw new Error("unexpected kinds");
    expect(a.glyph).toBe(SPINNER_FRAMES[0]);
    expect(b.glyph).toBe(SPINNER_FRAMES[1]);
    expect(c.glyph).toBe(SPINNER_FRAMES[2]);
  });

  it("shows the full transcript at duration", () => {
    const end = stateAt(tl, tl.duration);
    expect(end).toHaveLength(3);
    const endOut = end[1];
    if (endOut.kind !== "out") throw new Error("unexpected kind");
    expect(endOut.shown).toHaveLength(2);
  });
});

describe("keyOf", () => {
  const tl = buildTimeline(script);

  it("is stable for the same instant and differs across content changes", () => {
    const at = (ms: number) => keyOf(stateAt(tl, ms));
    expect(at(50)).toBe(at(50));
    expect(at(0)).not.toBe(at(tl.duration));
  });
});

describe("transcriptOf", () => {
  it("renders the finished session as plain text", () => {
    const text = transcriptOf(buildTimeline(script));
    expect(text).toContain("~/repo $ pnpm test");
    expect(text).toContain("line one\nline two");
    expect(text).toContain("worked");
    expect(text).not.toContain("working"); // spinner label is transient
  });
});
