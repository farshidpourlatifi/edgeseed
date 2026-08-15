import { ROLES } from "@starter/auth";
import { Badge } from "@starter/ui/components/ui/badge";

/**
 * A member's or invitation's role, as a badge.
 *
 * **Display only.** Nothing on this page decides what someone may do from the
 * string it renders — membership is the whole check here, and the permission
 * comparisons that arrive with the member actions (#37) go through `hasRole`,
 * never an inline comparison like the one below. What follows is a palette
 * lookup; it is not allowed to grow into a policy.
 *
 * An unrecognised role still renders, in the neutral variant. Better Auth's
 * `role` column is free text and a downstream product may add its own — a
 * member whose badge silently vanished would read as a member with no role.
 */
export function RoleBadge({ role }: { role: string }) {
  const variant = role === ROLES.owner ? "default" : role === ROLES.admin ? "secondary" : "outline";

  return (
    <Badge variant={variant} className="shrink-0 capitalize">
      {role}
    </Badge>
  );
}
