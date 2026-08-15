import { useSyncExternalStore } from "react";
import { data, Link, useNavigate } from "react-router";
import { PRODUCT_NAME } from "@starter/config/product";
import { Button } from "@starter/ui/components/ui/button";
import { ThemeToggle } from "@starter/ui/components/ui/theme-toggle";
import { BrandMark } from "~/components/brand/brand-mark";

export function meta() {
  return [
    { title: `404 — ${PRODUCT_NAME}` },
    // A 404 that renders is still a page a crawler can index. The status code
    // is the primary signal and this is the belt-and-braces one, because the
    // splat below matches every unknown URL — so without it a site could
    // accumulate an unbounded number of indexable, identical pages.
    { name: "robots", content: "noindex" },
  ];
}

/**
 * The status is the whole point of this loader.
 *
 * `data(..., { status })` on a *successful* loader sets the document response
 * code without routing the render through an error boundary — react-router
 * carries it into `staticContext.statusCode`, which `entry.server.tsx` returns
 * as `responseStatusCode`. Throwing instead would work too, but it would put
 * this page behind an `ErrorBoundary` and report a route error on every
 * crawler probe.
 *
 * Returning 200 with a page that says "not found" is the failure mode worth
 * naming: it looks correct in a browser and is wrong for every crawler,
 * monitor, and link checker that reads the code rather than the pixels.
 */
export function loader() {
  return data(null, { status: 404 });
}

const neverChanges = () => () => {};
const getCanGoBack = () => window.history.length > 1;

/**
 * Is there anywhere to go back *to*?
 *
 * `history.back()` in a tab whose first entry **is** this page does nothing at
 * all, and a direct hit — a stale bookmark, a typo, a crawler — is the most
 * likely way anybody gets here. A visible control that silently no-ops is the
 * thing issue #16 was about, so the button is absent rather than dead.
 *
 * Read through `useSyncExternalStore` rather than an effect, same as
 * `hero-background.tsx`: the server snapshot is the conservative one, so SSR
 * and hydration agree, and the real value lands on the first post-hydration
 * render without a `setState` cascade. Nothing to subscribe to — history length
 * only changes by navigating away from this page.
 */
const useCanGoBack = () => useSyncExternalStore(neverChanges, getCanGoBack, () => false);

export default function NotFoundPage() {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6">
        {/* reloadDocument: `/` is the marketing page, which may live on another
            origin — see site-header.tsx and docs/domains.md. This page renders
            on whichever origin was asked for, so it can be either side. */}
        <Link
          reloadDocument
          to="/"
          className="flex items-center gap-2 rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary">
            <BrandMark className="size-5 text-primary-foreground" />
          </span>
          <span className="text-base font-semibold tracking-tight sm:text-lg">{PRODUCT_NAME}</span>
        </Link>
        <ThemeToggle />
      </header>

      <main className="relative flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        {/* Soft accent behind the numeral. A token-driven blur rather than
            artwork: nothing to download, nothing to redraw per theme. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 -z-10 size-[min(70vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
        />

        <p className="font-semibold tracking-tighter text-[clamp(5rem,18vw,11rem)] leading-none">
          404
        </p>

        <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">Page not found</h1>

        <p className="mt-3 max-w-md text-balance text-muted-foreground">
          The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved.
        </p>

        <div className="mt-8 flex flex-col items-center gap-2">
          <Button asChild className="h-11 px-8">
            <Link reloadDocument to="/">
              Go home
            </Link>
          </Button>

          {canGoBack && (
            <Button variant="link" className="text-muted-foreground" onClick={() => navigate(-1)}>
              Go back
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
