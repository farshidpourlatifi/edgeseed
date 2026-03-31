/** Organization roles */
export const ROLES = {
  owner: "owner",
  admin: "admin",
  member: "member",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

/** Check if a role has at least the given permission level */
export function hasRole(userRole: string, requiredRole: Role): boolean {
  const hierarchy: Record<string, number> = {
    owner: 3,
    admin: 2,
    member: 1,
  };
  return (hierarchy[userRole] ?? 0) >= (hierarchy[requiredRole] ?? 0);
}
