import { SiteHeader } from "~/components/landing/site-header";
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
      <SiteHeader />
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
      <SiteFooter />
    </div>
  );
}
