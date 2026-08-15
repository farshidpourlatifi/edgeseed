import { ROLES } from "@starter/auth/roles";
import { Badge } from "@starter/ui/components/ui/badge";

/**
 * A member's or invitation's role, as a badge.
 *
 * **Display only.** Nothing decides what someone may do from the string it
 * renders: the member actions beside it read the loader's `capabilities`, which
 * come from `can()` and `ORG_CAPABILITIES`. What follows is a palette lookup —
 * it is not allowed to grow into a policy, and the fact that it compares role
 * names is exactly why nothing else here may.
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
