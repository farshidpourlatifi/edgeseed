import * as React from "react";
import { useInView } from "../../hooks/use-in-view";
import { useReducedMotion } from "../../hooks/use-reduced-motion";
import { buildTimeline, keyOf, stateAt, transcriptOf, type ScriptStep } from "./terminal-timeline";

/**
 * <Terminal /> — an animated, scripted terminal for marketing/docs pages.
 *
 * ```tsx
 * import { Terminal } from "@starter/ui/components/ui/terminal";
 * <Terminal script={steps} label="pnpm verify" />
 * ```
 *
 * - `theme="auto"` (default) follows the app theme: colors resolve via
 *   `light-dark()`, and the component binds `color-scheme` to the `.dark`
 *   class convention our ThemeProvider uses. Pass `"light"`/`"dark"` to pin.
 * - Every color is a CSS custom property (`--term-bg`, `--term-fg`, …) you can
 *   override from the app's token layer.
 * - Respects `prefers-reduced-motion` (jumps to the finished transcript with a
 *   Replay button) and pauses off-screen via IntersectionObserver.
 * - Screen readers get the completed transcript, not a stuttering live region.
 * - The animation model lives in `terminal-timeline.ts` (pure, unit-tested).
 *
 * Note: each instance injects its own <style> tag; fine for a page hero, but
 * don't render dozens of these in a list.
 */
export function Terminal({
  script,
  theme = "auto",
  loop = true,
  speed = 1,
  label,
  height = 300,
  className = "",
}: {
  script: ScriptStep[];
  theme?: "auto" | "light" | "dark";
  loop?: boolean;
  speed?: number;
  label?: string;
  height?: number | string;
  className?: string;
}) {
  const timeline = React.useMemo(() => buildTimeline(script), [script]);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef);
  const reduced = useReducedMotion();

  // Continuous time lives in a ref; `frameMs` snapshots it into state only
  // when the *rendered content* changes (~11 times/sec while typing), so we
  // never reconcile on every animation frame nor read a ref during render.
  const msRef = React.useRef(0);
  const keyRef = React.useRef("");
  const [frameMs, setFrameMs] = React.useState(0);
  const [done, setDone] = React.useState(false);

  const running = inView && !reduced && !done;

  React.useEffect(() => {
    if (!running) return;
    let raf: number;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) * speed;
      last = now;
      let next = msRef.current + dt;
      if (next >= timeline.duration) {
        if (loop) {
          next = 0;
        } else {
          next = timeline.duration;
          setDone(true);
        }
      }
      msRef.current = next;
      const k = keyOf(stateAt(timeline, next));
      if (k !== keyRef.current) {
        keyRef.current = k;
        setFrameMs(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, speed, loop, timeline]);

  const now = reduced || done ? timeline.duration : frameMs;
  const visible = stateAt(timeline, now);

  // Keep the newest line in view; runs after every content re-render.
  const bodyRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  const replay = React.useCallback(() => {
    msRef.current = 0;
    keyRef.current = "";
    setFrameMs(0);
    setDone(false);
  }, []);

  const transcript = React.useMemo(() => transcriptOf(timeline), [timeline]);

  const last = visible[visible.length - 1];
  const idleCursor = !last || (last.kind !== "cmd" && last.kind !== "spinner");

  return (
    <div
      ref={rootRef}
      className={`tw ${className}`}
      style={theme === "auto" ? undefined : { colorScheme: theme }}
    >
      <style>{`
        .tw {
          /* Override any of these from your own token layer. */
          --bg:      var(--term-bg,      light-dark(#FBFBFD, #0E1117));
          --panel:   var(--term-panel,   light-dark(#F1F2F6, #161B24));
          --border:  var(--term-border,  light-dark(#E3E6EC, #232B38));
          --fg:      var(--term-fg,      light-dark(#2B3140, #C9D3E2));
          --dim:     var(--term-dim,     light-dark(#8992A3, #63708A));
          --ok:      var(--term-ok,      light-dark(#0F7A45, #56D08A));
          --warn:    var(--term-warn,    light-dark(#8F5B00, #E8B341));
          --err:     var(--term-err,     light-dark(#BE3226, #F2705F));
          --accent:  var(--term-accent,  light-dark(#1A5FB4, #6AA5F2));
          --cyan:    var(--term-cyan,    light-dark(#1A6FA8, #69C0E8));

          font-family: var(--term-font, ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace);
          font-size: var(--term-size, 13px);
          line-height: 1.7;
          color: var(--fg);
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          position: relative;
          box-shadow: 0 1px 2px light-dark(rgba(16,24,40,.05), rgba(0,0,0,.4)),
                      0 12px 32px -18px light-dark(rgba(16,24,40,.22), rgba(0,0,0,.8));
        }
        /* light-dark() follows color-scheme, which our app never sets — bind it
           to the ThemeProvider's .dark class so "auto" tracks the app theme. */
        .tw { color-scheme: light; }
        .dark .tw { color-scheme: dark; }
        .tw-bar {
          display:flex; align-items:center; gap:8px;
          padding:9px 14px;
          background: var(--panel);
          border-bottom:1px solid var(--border);
          color: var(--dim);
          font-size: .85em;
        }
        .tw-dot { width:9px; height:9px; border-radius:50%; background:var(--border); }
        .tw-label { margin-left:4px; }
        .tw-body { padding:16px 18px; overflow:auto; scrollbar-width:thin; }
        .tw-row { white-space:pre-wrap; word-break:break-word; }
        .tw-cwd { color: var(--cyan); }
        .tw-sigil { color: var(--accent); padding:0 7px 0 5px; }
        .tw-dim { color: var(--dim); }
        .tw-ok { color: var(--ok); }
        .tw-warn { color: var(--warn); }
        .tw-err { color: var(--err); }
        .tw-accent { color: var(--accent); }
        .tw-cyan { color: var(--cyan); }
        .tw-cursor {
          display:inline-block; width:.55em; height:1.05em; vertical-align:-.2em;
          background: var(--fg); margin-left:2px; border-radius:1px;
          animation: tw-blink 1.06s steps(1) infinite;
        }
        @keyframes tw-blink { 0%,50%{opacity:1} 50.01%,100%{opacity:0} }
        .tw-replay {
          position:absolute; right:10px; bottom:10px;
          background: var(--panel); color: var(--dim);
          border:1px solid var(--border); border-radius:6px;
          padding:3px 10px; font:inherit; font-size:.85em; cursor:pointer;
        }
        .tw-replay:hover { color: var(--fg); }
        .tw-replay:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
        .tw-sr {
          position:absolute; width:1px; height:1px; padding:0; margin:-1px;
          overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0;
        }
        @media (prefers-reduced-motion: reduce) { .tw-cursor { animation:none } }

        /* Fallback for engines without light-dark() (Baseline mid-2024). */
        @supports not (color: light-dark(#000, #fff)) {
          .tw {
            --bg:#FBFBFD; --panel:#F1F2F6; --border:#E3E6EC; --fg:#2B3140;
            --dim:#8992A3; --ok:#0F7A45; --warn:#8F5B00; --err:#BE3226;
            --accent:#1A5FB4; --cyan:#1A6FA8;
          }
          .dark .tw {
            --bg:#0E1117; --panel:#161B24; --border:#232B38; --fg:#C9D3E2;
            --dim:#63708A; --ok:#56D08A; --warn:#E8B341; --err:#F2705F;
            --accent:#6AA5F2; --cyan:#69C0E8;
          }
        }
      `}</style>

      <div className="tw-bar" aria-hidden="true">
        <span className="tw-dot" />
        <span className="tw-dot" />
        <span className="tw-dot" />
        {label ? <span className="tw-label">{label}</span> : null}
      </div>

      <pre className="tw-sr">{transcript}</pre>

      <div className="tw-body" ref={bodyRef} style={{ height }} aria-hidden="true">
        {visible.map((b) => {
          if (b.kind === "cmd")
            return (
              <div className="tw-row" key={b.id}>
                <span className="tw-cwd">{b.cwd}</span>
                <span className="tw-sigil">❯</span>
                <span>{b.typed}</span>
                {b.typing && <span className="tw-cursor" />}
              </div>
            );

          if (b.kind === "spinner")
            return (
              <div className="tw-row tw-dim" key={b.id}>
                {b.running ? (
                  <>
                    <span className="tw-accent">{b.glyph}</span> {b.label}…
                  </>
                ) : (
                  <>
                    <span className="tw-ok">✓</span> {b.done}
                  </>
                )}
              </div>
            );

          return b.shown.map((l, i) => (
            <div className={"tw-row " + (l.tone ? "tw-" + l.tone : "")} key={b.id + i}>
              {l.text || " "}
            </div>
          ));
        })}

        {idleCursor && (
          <div className="tw-row">
            <span className="tw-cwd">{timeline.promptCwd}</span>
            <span className="tw-sigil">❯</span>
            <span className="tw-cursor" />
          </div>
        )}
      </div>

      {(done || reduced) && (
        <button type="button" className="tw-replay" onClick={replay}>
          Replay
        </button>
      )}
    </div>
  );
}
