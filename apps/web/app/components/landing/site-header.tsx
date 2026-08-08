import * as React from "react";
import { Link } from "react-router";
import { Menu, X } from "lucide-react";
import { BrandMark } from "~/components/brand/brand-mark";

import { PRODUCT_NAME } from "@starter/config/product";
import { Button } from "@starter/ui/components/ui/button";
import { Separator } from "@starter/ui/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@starter/ui/components/ui/sheet";
import { ThemeToggle } from "@starter/ui/components/ui/theme-toggle";
import { GithubIcon } from "./github-icon";
import { GITHUB_URL } from "./site";

const links = [
  { name: "Features", href: "#features" },
  { name: "Surfaces", href: "#surfaces" },
  { name: "Architecture", href: "#architecture" },
  { name: "Packages", href: "#packages" },
  { name: "Quality", href: "#quality" },
  { name: "Get started", href: "#getting-started" },
];

export function SiteHeader() {
  const [open, setOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary">
            <BrandMark className="size-5 text-primary-foreground" />
          </span>
          <span className="text-base font-semibold tracking-tight sm:text-lg">{PRODUCT_NAME}</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-6 lg:flex">
          {links.map((link) => (
            <a
              key={link.name}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.name}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {/*
            `reloadDocument` on every link out of the marketing pages into the
            app. A plain <Link> navigates client-side, which never touches the
            server — so in a split-origin setup the login page would render on
            the MARKETING host, and its sign-in POST would take a 302 that
            downgrades to GET and drops the session cookie on the wrong origin.
            Forcing a document request lets server/origins.ts do its job.
            Costs one page load at the boundary; correct in both topologies.
            docs/domains.md
          */}
          <Button variant="ghost" className="hidden h-11 sm:inline-flex" asChild>
            <Link reloadDocument to="/login">
              Sign In
            </Link>
          </Button>
          <Button className="hidden h-11 lg:inline-flex" asChild>
            <Link reloadDocument to="/register">
              Get Started
            </Link>
          </Button>

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild className="lg:hidden">
              <Button variant="ghost" size="icon" className="size-11" aria-label="Open menu">
                <Menu className="size-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px]" showCloseButton={false}>
              <SheetHeader className="flex-row items-center justify-between gap-2 space-y-0">
                <SheetTitle className="text-base">Menu</SheetTitle>
                <SheetClose asChild>
                  <Button variant="ghost" size="icon" className="size-11" aria-label="Close menu">
                    <X className="size-5" aria-hidden="true" />
                  </Button>
                </SheetClose>
              </SheetHeader>
              <nav aria-label="Mobile" className="flex flex-1 flex-col gap-1 overflow-y-auto px-4">
                {links.map((link) => (
                  <a
                    key={link.name}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {link.name}
                  </a>
                ))}
              </nav>
              <Separator />
              <div className="flex flex-col gap-3 px-4 pb-6">
                <Button variant="outline" className="h-11" asChild>
                  <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
                    <GithubIcon className="size-4" />
                    View on GitHub
                  </a>
                </Button>
                <Button variant="ghost" className="h-11" asChild>
                  <Link reloadDocument to="/login" onClick={() => setOpen(false)}>
                    Sign In
                  </Link>
                </Button>
                <Button className="h-11" asChild>
                  <Link reloadDocument to="/register" onClick={() => setOpen(false)}>
                    Get Started
                  </Link>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
