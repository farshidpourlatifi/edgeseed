let counter = 0;

function nextId(prefix = "test") {
  return `${prefix}-${++counter}-${Date.now()}`;
}

/** Create test user data */
export function buildUser(overrides?: Partial<{ id: string; name: string; email: string }>) {
  const id = nextId("user");
  return {
    id,
    name: "Test User",
    email: `${id}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Create test organization data */
export function buildOrganization(
  overrides?: Partial<{ id: string; name: string; slug: string }>,
) {
  const id = nextId("org");
  return {
    id,
    name: "Test Org",
    slug: id,
    createdAt: new Date(),
    ...overrides,
  };
}

/** Create test member data */
export function buildMember(
  overrides?: Partial<{
    id: string;
    userId: string;
    organizationId: string;
    role: string;
  }>,
) {
  return {
    id: nextId("member"),
    userId: nextId("user"),
    organizationId: nextId("org"),
    role: "member" as const,
    createdAt: new Date(),
    ...overrides,
  };
}
