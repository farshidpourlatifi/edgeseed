// The default module for `LANDING_ROUTE` (`app/product/landing.ts`). A product
// that names its own module there un-mounts this one, and an un-mounted module
// gets no generated route types, so this file never imports `./+types`.
import { SiteHeader, type SiteLink } from "~/components/landing/site-header";
import { Hero } from "~/components/landing/hero";
import { DemoVideo } from "~/components/landing/demo-video";
import { Features } from "~/components/landing/features";
import { Surfaces } from "~/components/landing/surfaces";
import { Architecture } from "~/components/landing/architecture";
import { Packages } from "~/components/landing/packages";
import { Quality } from "~/components/landing/quality";
import { GettingStarted } from "~/components/landing/getting-started";
import { SiteFooter } from "~/components/landing/site-footer";
import { PRODUCT_NAME } from "@starter/config/product";

const headerLinks: readonly SiteLink[] = [
  { name: "Features", href: "#features" },
  { name: "Surfaces", href: "#surfaces" },
  { name: "Architecture", href: "#architecture" },
  { name: "Packages", href: "#packages" },
  { name: "Quality", href: "#quality" },
  { name: "Get started", href: "#getting-started" },
];

const footerLinks: readonly SiteLink[] = [
  { name: "Features", href: "#features" },
  { name: "Architecture", href: "#architecture" },
  { name: "Packages", href: "#packages" },
  { name: "Quality", href: "#quality" },
];

export function meta() {
  return [
    { title: `${PRODUCT_NAME} — Ship SaaS products on Cloudflare` },
    {
      name: "description",
      content:
        "Cloudflare-native starter kit: Workers, React Router v7 + Hono, Better Auth, Drizzle on D1, shadcn/ui — with tests, quality gates and gated deploys wired in.",
    },
  ];
}

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader links={headerLinks} />
      <main className="flex-1">
        <Hero />
        <DemoVideo />
        <Features />
        <Surfaces />
        <Architecture />
        <Packages />
        <Quality />
        <GettingStarted />
      </main>
      <SiteFooter links={footerLinks} tagline="Built for the edge." />
    </div>
  );
}
