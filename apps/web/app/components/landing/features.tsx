import {
  Bot,
  Cloud,
  Database,
  Braces,
  KeyRound,
  Palette,
  Route,
  Rocket,
  ShieldCheck,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@starter/ui/components/ui/card";

const features = [
  {
    icon: Cloud,
    title: "Cloudflare Workers runtime",
    description:
      "Runs at the edge on Workers with local dev through Wrangler, so production and localhost behave the same.",
  },
  {
    icon: Route,
    title: "React Router v7 + Hono",
    description:
      "Server-rendered routes with loaders and actions, backed by a Hono app that owns every API surface.",
  },
  {
    icon: KeyRound,
    title: "Better Auth",
    description:
      "Email and password, GitHub and Google OAuth, plus organizations, invitations and role-based membership.",
  },
  {
    icon: Database,
    title: "Drizzle ORM on D1",
    description:
      "Typed schema and migrations against Cloudflare D1, with a single request-scoped database client.",
  },
  {
    icon: Palette,
    title: "shadcn/ui design system",
    description:
      "Accessible primitives, CSS-variable theming and a first-class dark mode you actually own the code for.",
  },
  {
    icon: Bot,
    title: "MCP server for LLM tools",
    description:
      "Expose your app to agents over the Model Context Protocol, with every tool mirroring a public API route.",
  },
  {
    icon: Braces,
    title: "Auto-generated OpenAPI",
    description:
      "Route schemas emit an OpenAPI document that is checked into git — CI fails the build when it drifts.",
  },
  {
    icon: ShieldCheck,
    title: "Quality gates",
    description:
      "ESLint, Prettier and gitleaks run as pre-commit hooks, blocking broken code and leaked secrets locally.",
  },
  {
    icon: Rocket,
    title: "Gated deploys",
    description:
      "Deploys wait on lint, format, types, unit, e2e and a gitleaks history scan before any Worker ships.",
  },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-16 border-b">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-20 sm:px-6 md:py-24">
        <div className="flex max-w-2xl flex-col gap-4">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Everything wired up on day one
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground text-pretty">
            Nine building blocks that normally take weeks to assemble, already integrated and
            covered by tests.
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <li key={feature.title} className="flex">
              <Card className="flex w-full flex-col transition-colors hover:border-primary/40">
                <CardHeader className="gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <feature.icon className="size-5" aria-hidden="true" />
                  </span>
                  <CardTitle className="text-base">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="leading-relaxed">
                    {feature.description}
                  </CardDescription>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
