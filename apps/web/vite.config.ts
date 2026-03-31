import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import serverAdapter from "hono-react-router-adapter/vite";
import adapter from "@hono/vite-dev-server/cloudflare";
import { getLoadContext } from "./load-context";

export default defineConfig({
  plugins: [
    tailwindcss(),
    serverAdapter({
      adapter,
      entry: "server/index.ts",
      getLoadContext,
    }),
    reactRouter(),
    tsconfigPaths(),
  ],
});
