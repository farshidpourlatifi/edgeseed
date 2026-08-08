import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { LinksFunction } from "react-router";
import { ThemeProvider } from "@starter/ui/hooks/use-theme";
import { Toaster } from "@starter/ui/components/ui/sonner";
import { THEME_SCRIPT } from "./lib/theme-script";
import styles from "./app.css?url";

export const links: LinksFunction = () => [
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  { rel: "stylesheet", href: styles },
];

/**
 * No nonce is threaded through here on purpose. `entry.server.tsx` passes one to
 * `ServerRouter`, which is the documented default for every nonce-aware
 * component below — so wiring it through root loader data would add a second
 * source for the same value, and one that is absent on error paths where
 * `Layout` still renders.
 */
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* The one script CSP admits by hash — see app/lib/theme-script.ts. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <Meta />
        {/*
          Explicitly nonce-less, which is not the same as omitting the prop:
          `Links` only falls back to the router's nonce when this is null or
          undefined. Left to fall back, it stamps the nonce on `<link>` tags —
          and browsers blank the `nonce` attribute after parsing, so SSR sends
          `nonce="abc"`, the DOM holds `nonce=""`, and hydration reports a
          mismatch React will not patch up. A nonce buys nothing here anyway:
          stylesheets are admitted by `style-src 'self'`, not by nonce.
        */}
        <Links nonce="" />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return (
    <ThemeProvider>
      <Outlet />
      <Toaster />
    </ThemeProvider>
  );
}
