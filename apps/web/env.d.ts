/// <reference types="@cloudflare/workers-types" />
/// <reference types="vite/client" />

declare module "./build/server" {
  const build: unknown;
  export = build;
}
