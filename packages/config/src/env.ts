import { z } from "zod";

/** Shared bindings available to all apps */
const sharedEnvSchema = z.object({
  DB: z.custom<D1Database>((v) => v != null, "D1 binding required"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  ENVIRONMENT: z.enum(["development", "staging", "production"]).default("development"),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

/** Web app Worker bindings */
export const webEnvSchema = sharedEnvSchema.extend({});

/** MCP server Worker bindings */
export const mcpEnvSchema = sharedEnvSchema.extend({});

export type SharedEnv = z.infer<typeof sharedEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;
export type McpEnv = z.infer<typeof mcpEnvSchema>;

/** Parse and validate Worker env bindings */
export function parseEnv<T extends z.ZodType>(schema: T, env: unknown): z.infer<T> {
  return schema.parse(env);
}
