// Request-flow diagram, hand-drawn to match the actual code path:
// worker.ts → server/index.ts (authMiddleware) → Better Auth / api.ts / loaders → Drizzle/D1.
// Themed via Tailwind fill/stroke utilities so it adapts to light and dark mode.
// Handler branches are color-coded: violet = auth, emerald = public API, amber = SSR loaders.
export function ArchitectureDiagram() {
  return (
    <svg
      viewBox="0 0 440 420"
      role="img"
      aria-label="Request flow: browser to Cloudflare Worker, through Hono middleware, into Better Auth, the versioned API, or React Router loaders, all reaching D1 through Drizzle"
      className="h-auto w-full max-w-md"
    >
      {/* Browser */}
      <rect
        x="150"
        y="8"
        width="140"
        height="40"
        rx="8"
        className="fill-muted stroke-border"
        strokeWidth="2"
      />
      <text x="220" y="32" textAnchor="middle" className="fill-foreground text-[13px] font-medium">
        Browser
      </text>

      <path
        d="M220 52 L220 65"
        className="stroke-muted-foreground"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M215.5 61 L220 68 L224.5 61"
        className="stroke-muted-foreground"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Worker */}
      <rect
        x="120"
        y="72"
        width="200"
        height="46"
        rx="8"
        className="fill-primary/10 stroke-primary"
        strokeWidth="2"
      />
      <text x="220" y="91" textAnchor="middle" className="fill-foreground text-[13px] font-medium">
        Cloudflare Worker
      </text>
      <text
        x="220"
        y="107"
        textAnchor="middle"
        className="fill-muted-foreground text-[10px] font-mono"
      >
        worker.ts
      </text>

      <path
        d="M220 122 L220 135"
        className="stroke-muted-foreground"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M215.5 131 L220 138 L224.5 131"
        className="stroke-muted-foreground"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Hono middleware */}
      <rect
        x="100"
        y="142"
        width="240"
        height="52"
        rx="8"
        className="fill-card stroke-border"
        strokeWidth="2"
      />
      <text x="220" y="163" textAnchor="middle" className="fill-foreground text-[13px] font-medium">
        Hono middleware
      </text>
      <text
        x="220"
        y="180"
        textAnchor="middle"
        className="fill-muted-foreground text-[10px] font-mono"
      >
        db + auth created per request
      </text>

      {/* fan-out: rounded elbow connectors, one color per handler branch */}
      <path
        d="M208 198 L208 208 Q208 216 200 216 L80 216 Q72 216 72 224 L72 231"
        className="stroke-violet-500"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M67.5 227 L72 234 L76.5 227"
        className="stroke-violet-500"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M220 198 L220 231"
        className="stroke-emerald-500"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M215.5 227 L220 234 L224.5 227"
        className="stroke-emerald-500"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M232 198 L232 208 Q232 216 240 216 L360 216 Q368 216 368 224 L368 231"
        className="stroke-amber-500"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M363.5 227 L368 234 L372.5 227"
        className="stroke-amber-500"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Better Auth */}
      <rect
        x="12"
        y="238"
        width="120"
        height="58"
        rx="8"
        className="fill-card stroke-violet-500/40"
        strokeWidth="2"
      />
      <text x="72" y="261" textAnchor="middle" className="fill-foreground text-[12px] font-medium">
        Better Auth
      </text>
      <text
        x="72"
        y="278"
        textAnchor="middle"
        className="fill-violet-700 dark:fill-violet-400 text-[9px] font-mono"
      >
        /api/auth/**
      </text>

      {/* Versioned API */}
      <rect
        x="160"
        y="238"
        width="120"
        height="58"
        rx="8"
        className="fill-card stroke-emerald-500/40"
        strokeWidth="2"
      />
      <text x="220" y="261" textAnchor="middle" className="fill-foreground text-[12px] font-medium">
        Versioned API
      </text>
      <text
        x="220"
        y="278"
        textAnchor="middle"
        className="fill-emerald-700 dark:fill-emerald-400 text-[9px] font-mono"
      >
        /api/v1 · OpenAPI
      </text>

      {/* RR loaders */}
      <rect
        x="308"
        y="238"
        width="120"
        height="58"
        rx="8"
        className="fill-card stroke-amber-500/40"
        strokeWidth="2"
      />
      <text x="368" y="261" textAnchor="middle" className="fill-foreground text-[12px] font-medium">
        RR loaders
      </text>
      <text
        x="368"
        y="278"
        textAnchor="middle"
        className="fill-amber-700 dark:fill-amber-400 text-[9px] font-mono"
      >
        SSR pages
      </text>

      {/* converge: mirrored elbows carrying each branch color into D1 */}
      <path
        d="M72 300 L72 310 Q72 318 80 318 L200 318 Q208 318 208 326 L208 333"
        className="stroke-violet-500"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M203.5 329 L208 336 L212.5 329"
        className="stroke-violet-500"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M220 300 L220 333"
        className="stroke-emerald-500"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M215.5 329 L220 336 L224.5 329"
        className="stroke-emerald-500"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M368 300 L368 310 Q368 318 360 318 L240 318 Q232 318 232 326 L232 333"
        className="stroke-amber-500"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M227.5 329 L232 336 L236.5 329"
        className="stroke-amber-500"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* D1 */}
      <rect
        x="130"
        y="340"
        width="180"
        height="52"
        rx="8"
        className="fill-primary/10 stroke-primary"
        strokeWidth="2"
      />
      <text x="220" y="361" textAnchor="middle" className="fill-foreground text-[13px] font-medium">
        Drizzle ORM
      </text>
      <text
        x="220"
        y="378"
        textAnchor="middle"
        className="fill-muted-foreground text-[10px] font-mono"
      >
        Cloudflare D1 (SQLite)
      </text>
    </svg>
  );
}
