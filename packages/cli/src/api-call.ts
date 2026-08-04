/**
 * Call the versioned API as a non-interactive client, authenticating with an
 * API token — the CLI half of the bearer-token story.
 *
 *   STARTER_API_TOKEN=sk_... pnpm api:call GET /me
 *   STARTER_API_TOKEN=sk_... pnpm api:call POST /tokens '{"name":"ci"}'
 *
 * `STARTER_API_URL` overrides the target (default http://localhost:5173).
 */
import { ApiUsageError, buildApiRequest, parseApiArgs } from "./lib/api-client";

async function main() {
  const { method, path, body } = parseApiArgs(process.argv.slice(2));

  const { url, init } = buildApiRequest({
    method,
    path,
    body,
    baseUrl: process.env.STARTER_API_URL,
    token: process.env.STARTER_API_TOKEN,
  });

  const res = await fetch(url, init);
  const text = await res.text();

  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    if (text) console.log(text);
  }

  if (!res.ok) {
    console.error(`\n${method} ${path} → ${res.status} ${res.statusText}`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  // Usage problems are the user's to fix — no stack trace for those.
  if (error instanceof ApiUsageError) {
    console.error(error.message);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
