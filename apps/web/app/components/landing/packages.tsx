import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@starter/ui/components/ui/card";
import { Badge } from "@starter/ui/components/ui/badge";

const packages = [
  {
    name: "web",
    label: "app",
    description: "React Router v7 app with SSR loaders, layouts and the authenticated dashboard.",
  },
  {
    name: "mcp",
    label: "server",
    description: "Model Context Protocol server exposing your domain to LLM tooling.",
  },
  {
    name: "auth",
    label: "lib",
    description: "Better Auth configuration, session helpers and organization permissions.",
  },
  {
    name: "config",
    label: "shared",
    description: "Zod-validated Worker env schemas and the app version, shared by both Workers.",
  },
  {
    name: "db",
    label: "lib",
    description: "Drizzle schema, migrations and the request-scoped D1 client factory.",
  },
  {
    name: "observability",
    label: "lib",
    description:
      "Structured logging, correlation ids and opt-in Sentry reporting, shared by both Workers.",
  },
  {
    name: "ui",
    label: "lib",
    description: "shadcn/ui component library with the shared theme and design tokens.",
  },
  {
    name: "cli",
    label: "tool",
    description: "Dev workflow scripts for migrations, seeds, the OpenAPI spec and product init.",
  },
];

export function Packages() {
  return (
    <section id="packages" className="scroll-mt-16 border-b">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-20 sm:px-6 md:py-24">
        <div className="flex max-w-2xl flex-col gap-4">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            A monorepo you can navigate
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground text-pretty">
            Eight focused packages with clear boundaries, so a change to auth never means editing
            your UI library.
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((pkg) => (
            <li key={pkg.name} className="flex">
              <Card className="flex w-full flex-col transition-colors hover:border-primary/40">
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="truncate font-mono text-base">
                      @starter/{pkg.name}
                    </CardTitle>
                    <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                      {pkg.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="leading-relaxed">{pkg.description}</CardDescription>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
