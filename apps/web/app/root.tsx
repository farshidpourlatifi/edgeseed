import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { LinksFunction } from "react-router";
import { ThemeProvider } from "@starter/ui/hooks/use-theme";
import { Toaster } from "@starter/ui/components/ui/sonner";
import styles from "./app.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

const themeScript = `
(function() {
  var t = document.cookie.match(/theme=([^;]+)/);
  var theme = t ? t[1] : 'system';
  var isDark = theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.add(isDark ? 'dark' : 'light');
})();
`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <Meta />
        <Links />
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
