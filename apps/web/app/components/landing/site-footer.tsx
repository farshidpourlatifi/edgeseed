import { BrandLogo } from "~/components/brand/brand-logo";

import { GithubIcon } from "./github-icon";
import { REPO } from "./repo";
import type { SiteLink } from "./site-header";

export function SiteFooter({ links, tagline }: { links: readonly SiteLink[]; tagline?: string }) {
  return (
    <footer className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3">
        <BrandLogo size="sm" />
        {tagline && <span className="text-sm text-muted-foreground">{tagline}</span>}
      </div>

      <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {links.map((link) => (
          <a
            key={link.name}
            href={link.href}
            className="flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {link.name}
          </a>
        ))}
        {REPO && (
          <a
            href={REPO.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <GithubIcon className="size-4" />
            GitHub
          </a>
        )}
      </nav>
    </footer>
  );
}
