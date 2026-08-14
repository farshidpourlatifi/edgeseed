import { Link } from "react-router";
import { ArrowRight, Star } from "lucide-react";

import { Badge } from "@starter/ui/components/ui/badge";
import { Button } from "@starter/ui/components/ui/button";
import { CopyCommand } from "./copy-command";
import { GithubIcon } from "./github-icon";
import { HeroBackground } from "./hero-background";
import { REPO } from "./repo";

export function Hero() {
  return (
    // `isolate` keeps the background's negative z-index inside this section
    // rather than sliding it behind the page background.
    <section className="relative isolate border-b">
      <HeroBackground />
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8 px-4 py-20 text-center sm:px-6 md:py-28">
        <Badge variant="secondary" className="gap-2 rounded-full px-3 py-1.5">
          <Star className="size-3.5" aria-hidden="true" />
          Open source starter kit
        </Badge>

        <div className="flex max-w-3xl flex-col gap-6">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl">
            Ship SaaS products on Cloudflare in hours, not weeks
          </h1>
          {/* Not `text-muted-foreground` like the other sections: that token sits
              below the 4.5:1 body threshold over much of the hero's gradient, and
              how far below depends on where the wash happens to be. */}
          <p className="text-foreground/90 mx-auto max-w-2xl text-base leading-relaxed text-pretty sm:text-lg">
            A Cloudflare-native starter kit with Workers, React Router v7 + Hono, Better Auth,
            Drizzle on D1 and a shadcn/ui design system — wired together with tests, quality gates
            and gated deploys.
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Button size="lg" className="h-12 px-6" asChild>
            {/* reloadDocument: crosses the marketing/app boundary — see site-header.tsx */}
            <Link reloadDocument to="/register">
              Get Started
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          {/* Both GitHub affordances are absent, not disabled, when the product
              declares no repository — see repo.ts. */}
          {REPO && (
            <Button size="lg" variant="outline" className="h-12 px-6" asChild>
              <a href={REPO.url} target="_blank" rel="noreferrer noopener">
                <GithubIcon className="size-4" />
                View on GitHub
              </a>
            </Button>
          )}
        </div>

        {REPO && <CopyCommand command={REPO.cloneCommand} className="w-full max-w-md text-left" />}
      </div>
    </section>
  );
}
