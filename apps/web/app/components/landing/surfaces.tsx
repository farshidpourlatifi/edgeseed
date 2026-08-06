import { Bot, Braces, Check, Copy, Monitor, Terminal } from "lucide-react";

import { Button } from "@starter/ui/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@starter/ui/components/ui/tabs";
import { useCopy } from "./use-copy";

/**
 * One operation — "which account am I?" — shown on every surface.
 *
 * Deliberately not a feature grid: parity is the claim, so the section has to
 * demonstrate it with the *same* question answered four ways. `/me` and its MCP
 * twin `whoami` are the operation that genuinely exists on all four today.
 * Token management is session-only by design and will never reach MCP, so no
 * copy here promises blanket route-for-route parity.
 */
const surfaces = [
  {
    value: "web",
    label: "Web",
    icon: Monitor,
    caption: "web / dashboard",
    description:
      "Sign in and the dashboard reads the session cookie Better Auth set. The same principal every other surface resolves to.",
    code: "pnpm dev\n# → localhost:5173/dashboard/settings",
  },
  {
    value: "api",
    label: "API",
    icon: Braces,
    caption: "api / GET /me",
    description:
      "A bearer token or a session cookie — principalMiddleware resolves either into one principal, and rejects an invalid token rather than falling back to the cookie.",
    code: 'curl -H "Authorization: Bearer sk_..." \\\n  https://your-app.workers.dev/api/v1/me',
  },
  {
    value: "cli",
    label: "CLI",
    icon: Terminal,
    caption: "cli / api:call",
    description:
      "The same request with the token read from your environment, for scripts and CI. STARTER_API_URL points it at any deployment.",
    code: "STARTER_API_TOKEN='sk_...' \\\n  pnpm api:call GET /me",
  },
  {
    value: "mcp",
    label: "MCP",
    icon: Bot,
    caption: "mcp / whoami",
    description:
      "An agent connects over OAuth 2.1 and registers itself — no credentials to create by hand. Identity comes from the grant, never from a tool argument.",
    code: "claude mcp add --transport http \\\n  starter https://your-mcp.workers.dev/mcp",
  },
] as const;

function CodeBlock({ code, caption, label }: { code: string; caption: string; label: string }) {
  const { copied, copy } = useCopy(code);

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border bg-muted/50 shadow-sm">
      <div className="flex min-h-11 items-center justify-between gap-3 border-b pr-1 pl-4">
        <span className="truncate font-mono text-xs text-muted-foreground">{caption}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={copy}
          aria-label={`Copy ${label} example`}
          className="size-11 shrink-0"
        >
          {copied ? (
            <Check className="size-4 text-primary" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
        </Button>
      </div>
      {/* tabIndex/aria-label: a horizontally scrollable region must be reachable
          and operable by keyboard (WCAG 2.1.1), and it needs a name to be worth
          landing on. overscroll-x-contain stops the scroll chaining to the page
          once the code hits its end. */}
      <pre
        tabIndex={0}
        aria-label={`${label} code example`}
        className="max-w-full overflow-x-auto overscroll-x-contain p-4 font-mono text-sm leading-relaxed text-foreground focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none sm:p-6"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function Surfaces() {
  return (
    <section id="surfaces" className="scroll-mt-16 border-b bg-muted/30">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-20 sm:px-6 md:py-24">
        <div className="flex max-w-2xl flex-col gap-4">
          <h2 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            One account, four ways in.
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground text-pretty">
            The same operation works from the web app, the REST API, the CLI, and an MCP server for
            LLM agents — one set of users, one permission model.
          </p>
        </div>

        <Tabs defaultValue="web" className="gap-6">
          {/* Horizontal scroll rather than wrap: four triggers overflow 320px, and
              a wrapped tab list reads as two rows of unrelated controls. */}
          <div className="overflow-x-auto pb-1">
            <TabsList aria-label="Choose a surface" className="h-auto min-w-max">
              {surfaces.map((surface) => (
                <TabsTrigger key={surface.value} value={surface.value} className="min-h-11 px-4">
                  <surface.icon className="size-4" aria-hidden="true" />
                  {surface.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {surfaces.map((surface) => (
            <TabsContent key={surface.value} value={surface.value} className="mt-0">
              <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-8">
                <div className="flex flex-col gap-3 pt-1">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                      <surface.icon className="size-5" aria-hidden="true" />
                    </span>
                    <h3 className="font-heading text-xl font-semibold tracking-tight">
                      {surface.label}
                    </h3>
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground text-pretty sm:text-base">
                    {surface.description}
                  </p>
                </div>
                <CodeBlock code={surface.code} caption={surface.caption} label={surface.label} />
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}
