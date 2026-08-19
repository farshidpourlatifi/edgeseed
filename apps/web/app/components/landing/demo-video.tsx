import { Cloud, GitBranch, Globe, ShieldCheck, Tag, Terminal } from "lucide-react";

import { PRODUCT_NAME } from "@starter/config/product";

import { DEMO_VIDEO } from "./demo";

/**
 * The end-to-end walkthrough film — the one artefact that proves the pitch.
 *
 * Every other section makes a claim in prose or a code sample; this one shows
 * the whole path as a single continuous take: this very landing page, then
 * `git clone`, `pnpm install`, dev servers booting on Workers, the build /
 * typecheck / boot gate going green, a version bump and a gated release, and
 * finally the deployed Worker in the Cloudflare dashboard with its D1 and
 * rate-limit bindings and live request logs. The commands in "Getting started"
 * below are the same ones, run for real — the film is the evidence that they
 * end at a live Worker rather than a README promise.
 *
 * What it deliberately does *not* do:
 *
 * - **No autoplay.** `preload="none"` plus a poster means a visitor who scrolls
 *   past pays zero video bytes — the ~10 MB file is fetched only on a real
 *   click. Nothing moves until then, so `prefers-reduced-motion` needs no
 *   special-casing here, unlike the hero's shader.
 * - **No captions track.** The film has no narration, so a `<track>` would be
 *   empty ceremony. The visible chapter list *is* the text alternative — it
 *   says what the film shows for anyone who will not or cannot play it, and
 *   `aria-label` names the video for assistive tech.
 *
 * Identity is derived (`PRODUCT_NAME`), and the film itself is **gated**: it is
 * EdgeSeed-branded pixels no rebrand can rewrite, so the section renders only
 * when the product declares one via `PRODUCT_DEMO_VIDEO` (`./demo.ts`), which
 * `init:product` clears like `PRODUCT_REPO_URL`. A clone gets no section — and
 * can delete the two `public/demo.*` files — rather than republishing the
 * starter's identity on its own landing page (issue #32).
 */
const chapters = [
  { icon: Globe, text: "Starts on this landing page." },
  { icon: GitBranch, text: "git clone, then pnpm install." },
  { icon: Terminal, text: "Dev servers come up on Cloudflare Workers." },
  { icon: ShieldCheck, text: "Build, typecheck and the boot check go green." },
  { icon: Tag, text: "A version bump, then a gated release deploys." },
  {
    icon: Cloud,
    text: "The live Worker in Cloudflare — its D1 and rate-limit bindings, and real request logs.",
  },
] as const;

export function DemoVideo() {
  // Absent, not disabled, when the product ships no film — a clone renders
  // nothing here rather than the starter's branded walkthrough (issue #32).
  if (!DEMO_VIDEO) return null;

  return (
    <section id="demo" className="scroll-mt-16 border-b bg-muted/30">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-20 sm:px-6 md:py-24">
        <div className="flex max-w-2xl flex-col gap-4">
          <h2 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Watch it go from clone to deployed
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground text-pretty">
            {PRODUCT_NAME} in one unbroken take — cloning the repo, booting the dev servers, passing
            the quality gate, and shipping a gated release to a live Cloudflare Worker. The same
            commands you'll find in Getting started below.
          </p>
        </div>

        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <figure className="flex min-w-0 flex-col gap-3">
            {/* aspect-video reserves the 16:9 box before the poster paints, so
                the section never reflows once the image loads (no CLS). */}
            <div className="aspect-video w-full overflow-hidden rounded-xl border bg-muted shadow-sm">
              <video
                data-testid="demo-video"
                className="h-full w-full"
                controls
                preload="none"
                playsInline
                poster={DEMO_VIDEO.poster}
                aria-label={`${PRODUCT_NAME} walkthrough: from git clone to a deployed Cloudflare Worker`}
              >
                <source src={DEMO_VIDEO.src} type="video/mp4" />
                {/* Shown only by a browser that cannot play the source at all —
                    the chapter list beside it carries the actual content. */}
                Your browser can't play this video. It walks through {PRODUCT_NAME} from git clone
                to a deployed Cloudflare Worker.
              </video>
            </div>
            <figcaption className="text-sm text-muted-foreground text-pretty">
              No sound needed — it's a screen recording. Press play when you're ready; nothing
              downloads until you do.
            </figcaption>
          </figure>

          {/* The text alternative: what the film shows, in order, for anyone who
              won't press play (or can't). */}
          <div className="flex flex-col gap-4">
            <h3 className="font-heading text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              What you'll see
            </h3>
            <ol className="flex flex-col gap-3">
              {chapters.map((chapter, index) => (
                <li key={chapter.text} className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <chapter.icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="pt-1 text-sm leading-relaxed text-foreground text-pretty">
                    <span className="sr-only">{`Step ${index + 1}: `}</span>
                    {chapter.text}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
