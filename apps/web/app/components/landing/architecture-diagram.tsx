// Request-flow diagram, hand-drawn to match the actual code path:
// worker.ts → server/index.ts (authMiddleware) → Better Auth / api.ts / loaders → Drizzle/D1.
// Themed via Tailwind fill/stroke utilities so it adapts to light and dark mode.
export function ArchitectureDiagram() {
  return (
    <svg
      viewBox="0 0 400 420"
      role="img"
      aria-label="Request flow: browser to Cloudflare Worker, through Hono middleware, into Better Auth, the versioned API, or React Router loaders, all reaching D1 through Drizzle"
      className="h-auto w-full max-w-md"
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L8 4 L0 8 z" className="fill-muted-foreground" />
        </marker>
      </defs>

      {/* Browser */}
      <rect
        x="130"
        y="8"
        width="140"
        height="40"
        rx="8"
        className="fill-muted stroke-border"
        strokeWidth="1"
      />
      <text x="200" y="32" textAnchor="middle" className="fill-foreground text-[13px] font-medium">
        Browser
      </text>

      <line
        x1="200"
        y1="48"
        x2="200"
        y2="70"
        className="stroke-muted-foreground"
        strokeWidth="1.25"
        markerEnd="url(#arrow)"
      />

      {/* Worker */}
      <rect
        x="100"
        y="72"
        width="200"
        height="46"
        rx="8"
        className="fill-primary/10 stroke-primary"
        strokeWidth="1"
      />
      <text x="200" y="91" textAnchor="middle" className="fill-foreground text-[13px] font-medium">
        Cloudflare Worker
      </text>
      <text
        x="200"
        y="107"
        textAnchor="middle"
        className="fill-muted-foreground text-[10px] font-mono"
      >
        worker.ts
      </text>

      <line
        x1="200"
        y1="118"
        x2="200"
        y2="140"
        className="stroke-muted-foreground"
        strokeWidth="1.25"
        markerEnd="url(#arrow)"
      />

      {/* Hono middleware */}
      <rect
        x="80"
        y="142"
        width="240"
        height="52"
        rx="8"
        className="fill-card stroke-border"
        strokeWidth="1"
      />
      <text x="200" y="163" textAnchor="middle" className="fill-foreground text-[13px] font-medium">
        Hono middleware
      </text>
      <text
        x="200"
        y="180"
        textAnchor="middle"
        className="fill-muted-foreground text-[10px] font-mono"
      >
        db + auth created per request
      </text>

      {/* fan-out */}
      <line
        x1="200"
        y1="194"
        x2="76"
        y2="234"
        className="stroke-muted-foreground"
        strokeWidth="1.25"
        markerEnd="url(#arrow)"
      />
      <line
        x1="200"
        y1="194"
        x2="200"
        y2="234"
        className="stroke-muted-foreground"
        strokeWidth="1.25"
        markerEnd="url(#arrow)"
      />
      <line
        x1="200"
        y1="194"
        x2="324"
        y2="234"
        className="stroke-muted-foreground"
        strokeWidth="1.25"
        markerEnd="url(#arrow)"
      />

      {/* Better Auth */}
      <rect
        x="14"
        y="238"
        width="120"
        height="58"
        rx="8"
        className="fill-card stroke-border"
        strokeWidth="1"
      />
      <text x="74" y="261" textAnchor="middle" className="fill-foreground text-[12px] font-medium">
        Better Auth
      </text>
      <text
        x="74"
        y="278"
        textAnchor="middle"
        className="fill-muted-foreground text-[9px] font-mono"
      >
        /api/auth/**
      </text>

      {/* Versioned API */}
      <rect
        x="140"
        y="238"
        width="120"
        height="58"
        rx="8"
        className="fill-card stroke-border"
        strokeWidth="1"
      />
      <text x="200" y="261" textAnchor="middle" className="fill-foreground text-[12px] font-medium">
        Versioned API
      </text>
      <text
        x="200"
        y="278"
        textAnchor="middle"
        className="fill-muted-foreground text-[9px] font-mono"
      >
        /api/v1 · OpenAPI
      </text>

      {/* Loaders */}
      <rect
        x="266"
        y="238"
        width="120"
        height="58"
        rx="8"
        className="fill-card stroke-border"
        strokeWidth="1"
      />
      <text x="326" y="261" textAnchor="middle" className="fill-foreground text-[12px] font-medium">
        RR loaders
      </text>
      <text
        x="326"
        y="278"
        textAnchor="middle"
        className="fill-muted-foreground text-[9px] font-mono"
      >
        SSR pages
      </text>

      {/* converge */}
      <line
        x1="74"
        y1="296"
        x2="184"
        y2="336"
        className="stroke-muted-foreground"
        strokeWidth="1.25"
        markerEnd="url(#arrow)"
      />
      <line
        x1="200"
        y1="296"
        x2="200"
        y2="336"
        className="stroke-muted-foreground"
        strokeWidth="1.25"
        markerEnd="url(#arrow)"
      />
      <line
        x1="326"
        y1="296"
        x2="216"
        y2="336"
        className="stroke-muted-foreground"
        strokeWidth="1.25"
        markerEnd="url(#arrow)"
      />

      {/* D1 */}
      <rect
        x="110"
        y="340"
        width="180"
        height="52"
        rx="8"
        className="fill-primary/10 stroke-primary"
        strokeWidth="1"
      />
      <text x="200" y="361" textAnchor="middle" className="fill-foreground text-[13px] font-medium">
        Drizzle ORM
      </text>
      <text
        x="200"
        y="378"
        textAnchor="middle"
        className="fill-muted-foreground text-[10px] font-mono"
      >
        Cloudflare D1 (SQLite)
      </text>
    </svg>
  );
}
