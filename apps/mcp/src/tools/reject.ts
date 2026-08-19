/**
 * How a tool refuses.
 *
 * **Not `HTTPException`.** A tool call is not an HTTP request — there is no
 * status code on the way out, and throwing an HTTP error inside a Durable
 * Object surfaces to the client as a server fault and to Sentry as an incident,
 * when the truth is that the caller asked for something they may not have. The
 * MCP content protocol says an error the *model* should see is a normal result
 * flagged `isError`, and that is what this returns.
 *
 * The body is the `{ error }` envelope `rejectRequest` answers in on
 * `/api/v1`, so a client reading both surfaces parses one shape.
 */
export function rejectTool(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
  };
}

/**
 * The one sentence a caller hears about an organization that is not theirs.
 *
 * **Nonexistent and belonging-to-somebody-else are the same answer**, which is
 * the same collapse `/api/v1/organization/*` performs with its 404s: the stores
 * resolve a target inside the caller's own memberships, so both come back
 * `null`, and an id stops being an oracle for probing another tenant. Two
 * messages here would undo that at the last step.
 */
export const NOT_A_MEMBER = "You are not a member of this organization";

/** The refusal when the caller is inside the organization but lacks the role. */
export const ROLE_NOT_PERMITTED = "Your role does not permit this";
