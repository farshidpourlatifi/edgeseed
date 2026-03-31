import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { APP_VERSION } from "@starter/config/version";

export const apiApp = new OpenAPIHono();

// --- Health check ---
const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            status: z.string(),
            version: z.string(),
          }),
        },
      },
      description: "Health check response",
    },
  },
});

apiApp.openapi(healthRoute, (c) => {
  return c.json({ status: "ok", version: APP_VERSION }, 200);
});

// --- OpenAPI spec endpoint ---
apiApp.doc31("/doc", {
  openapi: "3.1.0",
  info: {
    title: "Starter API",
    version: APP_VERSION,
  },
});
