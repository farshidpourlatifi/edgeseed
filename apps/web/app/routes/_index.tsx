export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Nav */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <span className="text-xl font-bold">Starter</span>
          <div className="flex items-center gap-3">
            <a href="/login" className="text-sm text-muted-foreground hover:text-foreground">
              Sign In
            </a>
            <a
              href="/register"
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              Get Started
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-20 text-center">
        <h1 className="max-w-2xl text-5xl font-bold tracking-tight">
          Ship Cloudflare-native products in days, not weeks
        </h1>
        <p className="max-w-lg text-lg text-muted-foreground">
          A minimal starter kit with auth, database, API, and AI tooling — all
          running on Cloudflare Workers.
        </p>
        <div className="flex gap-4">
          <a
            href="/register"
            className="rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground"
          >
            Start Building
          </a>
          <a
            href="#features"
            className="rounded-md border border-border px-6 py-3 text-sm font-medium"
          >
            Learn More
          </a>
        </div>
      </main>

      {/* Features */}
      <section id="features" className="border-t border-border bg-muted/50 px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-3xl font-bold">Everything you need</h2>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Auth & Tenancy",
                description:
                  "User accounts, organizations, and role-based access out of the box.",
              },
              {
                title: "D1 Database",
                description:
                  "Type-safe schema with Drizzle ORM, migrations, and local dev support.",
              },
              {
                title: "API + OpenAPI",
                description:
                  "Typed API routes with auto-generated OpenAPI 3.1 specs from Zod schemas.",
              },
              {
                title: "MCP Server",
                description:
                  "Every API action available as an MCP tool for LLM integration.",
              },
              {
                title: "React + Tailwind",
                description:
                  "React Router v7 with SSR, shadcn/ui components, and Tailwind v4.",
              },
              {
                title: "Edge-Native",
                description:
                  "Deploys as Cloudflare Workers — fast globally, zero cold starts.",
              },
            ].map((feature) => (
              <div key={feature.title} className="rounded-lg border bg-background p-6">
                <h3 className="mb-2 font-semibold">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground">
        Built with Cloudflare Workers, React Router, and Hono.
      </footer>
    </div>
  );
}
