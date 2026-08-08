import { BrandMark } from "~/components/brand/brand-mark";

import { PRODUCT_NAME } from "@starter/config/product";
import { GithubIcon } from "./github-icon";
import { GITHUB_URL } from "./site";

const footerLinks = [
  { name: "Features", href: "#features" },
  { name: "Architecture", href: "#architecture" },
  { name: "Packages", href: "#packages" },
  { name: "Quality", href: "#quality" },
];

export function SiteFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary">
          <BrandMark className="size-4 text-primary-foreground" />
        </span>
        <span className="text-sm text-muted-foreground">{PRODUCT_NAME} — built for the edge.</span>
      </div>

      <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {footerLinks.map((link) => (
          <a
            key={link.name}
            href={link.href}
            className="flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {link.name}
          </a>
        ))}
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <GithubIcon className="size-4" />
          GitHub
        </a>
      </nav>
    </footer>
  );
}
