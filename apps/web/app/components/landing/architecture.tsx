import { ArchitectureDiagram } from "./architecture-diagram";

const steps = [
  {
    title: "Worker entry",
    description:
      "Every request lands on a single Cloudflare Worker that binds D1 and environment secrets before anything else runs.",
  },
  {
    title: "Hono middleware",
    description:
      "Middleware builds a per-request context: a Drizzle database client and a configured auth instance, never shared between requests.",
  },
  {
    title: "Better Auth",
    description:
      "Auth routes handle sessions, OAuth callbacks and organization membership, then hand the active user to downstream handlers.",
  },
  {
    title: "Versioned API",
    description:
      "Validated /api/v1 routes emit OpenAPI schemas, so breaking changes require a new version rather than a silent edit.",
  },
  {
    title: "React Router loaders",
    description:
      "Loaders receive the same request-scoped db and auth through AppLoadContext, so pages and the public API can never disagree about your data.",
  },
];

export function Architecture() {
  return (
    <section id="architecture" className="scroll-mt-16 border-b bg-muted/30">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-20 sm:px-6 md:py-24">
        <div className="flex max-w-2xl flex-col gap-4">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            One request, one predictable path
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground text-pretty">
            No hidden globals and no duplicated data access. Here is exactly what happens between
            the edge and your database.
          </p>
        </div>

        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2 lg:gap-12">
          <div
            id="architecture-diagram"
            className="flex min-h-80 w-full items-center justify-center rounded-xl border bg-card p-6 lg:min-h-[28rem]"
          >
            <ArchitectureDiagram />
          </div>

          <ol className="flex flex-col gap-6">
            {steps.map((step, index) => (
              <li key={step.title} className="flex items-start gap-4">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-xs font-medium text-primary-foreground"
                >
                  {index + 1}
                </span>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-base font-semibold tracking-tight">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
                    {step.description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
