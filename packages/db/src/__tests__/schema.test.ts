import { describe, it, expect } from "vitest";
import { getTableName, getTableColumns } from "drizzle-orm";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  user,
  session,
  account,
  verification,
  organization,
  member,
  invitation,
  apiToken,
} from "../schema/index";

const tables: Array<{
  table: SQLiteTable;
  name: string;
  notNullColumns: string[];
  nullableColumns: string[];
}> = [
  {
    table: user,
    name: "user",
    notNullColumns: ["id", "email", "emailVerified", "name", "createdAt", "updatedAt"],
    nullableColumns: ["image"],
  },
  {
    table: session,
    name: "session",
    notNullColumns: ["id", "userId", "token", "expiresAt", "createdAt", "updatedAt"],
    nullableColumns: ["ipAddress", "userAgent", "activeOrganizationId"],
  },
  {
    table: account,
    name: "account",
    notNullColumns: ["id", "userId", "providerId", "accountId", "createdAt", "updatedAt"],
    nullableColumns: [
      "accessToken",
      "refreshToken",
      "idToken",
      "accessTokenExpiresAt",
      "refreshTokenExpiresAt",
      "scope",
      "password",
    ],
  },
  {
    table: verification,
    name: "verification",
    notNullColumns: ["id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"],
    nullableColumns: [],
  },
  {
    table: organization,
    name: "organization",
    notNullColumns: ["id", "name", "slug", "createdAt"],
    nullableColumns: ["logo", "updatedAt"],
  },
  {
    table: member,
    name: "member",
    notNullColumns: ["id", "organizationId", "userId", "role", "createdAt"],
    nullableColumns: [],
  },
  {
    table: invitation,
    name: "invitation",
    notNullColumns: ["id", "organizationId", "email", "role", "status", "inviterId", "createdAt"],
    nullableColumns: ["expiresAt"],
  },
  {
    table: apiToken,
    name: "apiToken",
    notNullColumns: ["id", "userId", "name", "tokenHash", "prefix", "createdAt", "updatedAt"],
    nullableColumns: ["organizationId", "lastUsedAt", "expiresAt", "revokedAt"],
  },
];

describe.each(tables)("$name table", ({ table, name, notNullColumns, nullableColumns }) => {
  it(`is named "${name}"`, () => {
    expect(getTableName(table)).toBe(name);
  });

  it("has exactly the expected columns", () => {
    const actual = Object.keys(getTableColumns(table)).sort();
    const expected = [...notNullColumns, ...nullableColumns].sort();
    expect(actual).toEqual(expected);
  });

  it("maps every property to a same-named SQL column, with id as primary key", () => {
    const columns = getTableColumns(table);
    for (const [key, column] of Object.entries(columns)) {
      expect(column.name, `${name}.${key} SQL name`).toBe(key);
    }
    expect(columns.id.primary).toBe(true);
  });

  it("enforces NOT NULL on the right columns", () => {
    const columns = getTableColumns(table);
    for (const key of notNullColumns) {
      expect(columns[key].notNull, `${name}.${key} should be NOT NULL`).toBe(true);
    }
    for (const key of nullableColumns) {
      expect(columns[key].notNull, `${name}.${key} should be nullable`).toBe(false);
    }
  });
});

/**
 * The complete foreign-key set, as `table.column -> referencedTable (onDelete)`.
 *
 * Asserted as a whole rather than per table so that adding a foreign key
 * without deciding its delete behavior fails here. `no action` is what audit
 * #13 was: deleting a user or organization errored, and any row that escaped
 * enforcement was stranded.
 */
const expectedForeignKeys = [
  "account.userId -> user (cascade)",
  "apiToken.organizationId -> organization (cascade)",
  "apiToken.userId -> user (cascade)",
  "invitation.inviterId -> user (cascade)",
  "invitation.organizationId -> organization (cascade)",
  "member.organizationId -> organization (cascade)",
  "member.userId -> user (cascade)",
  "session.activeOrganizationId -> organization (set null)",
  "session.userId -> user (cascade)",
];

describe("relational integrity", () => {
  it("every foreign key declares the expected delete behavior", () => {
    const actual = tables
      .flatMap(({ table }) =>
        getTableConfig(table).foreignKeys.map((fk) => {
          const ref = fk.reference();
          const child = getTableName(table);
          const column = ref.columns[0].name;
          const parent = getTableName(ref.foreignTable);
          return `${child}.${column} -> ${parent} (${fk.onDelete})`;
        }),
      )
      .sort();

    expect(actual).toEqual(expectedForeignKeys);
  });

  // The two the audit named. Called out separately so a regression reads as
  // the known defect rather than as generic drift.
  it("tenant rows cascade so user and organization deletion cannot strand them", () => {
    for (const table of [member, invitation]) {
      for (const fk of getTableConfig(table).foreignKeys) {
        expect(
          fk.onDelete,
          `${getTableName(table)} -> ${getTableName(fk.reference().foreignTable)}`,
        ).toBe("cascade");
      }
    }
  });

  // A deleted organization must not leave a ghost id that `principal.ts` hands
  // to /api/v1 as the caller's organizationId.
  it("session.activeOrganizationId nulls out instead of cascading the session away", () => {
    const fk = getTableConfig(session).foreignKeys.find(
      (f) => f.reference().columns[0].name === "activeOrganizationId",
    );
    expect(fk, "session.activeOrganizationId should have a foreign key").toBeDefined();
    expect(fk!.onDelete).toBe("set null");
    expect(getTableName(fk!.reference().foreignTable)).toBe("organization");
  });

  it("unique constraints exist on user.email, session.token, organization.slug", () => {
    expect(getTableColumns(user).email.isUnique).toBe(true);
    expect(getTableColumns(session).token.isUnique).toBe(true);
    expect(getTableColumns(organization).slug.isUnique).toBe(true);
  });

  // Lookups match on the hash, so it must be unique — and the plaintext must
  // never get a column of its own (docs/security-audit.md #12).
  it("apiToken.tokenHash is unique and no plaintext column exists", () => {
    expect(getTableColumns(apiToken).tokenHash.isUnique).toBe(true);
    expect(Object.keys(getTableColumns(apiToken))).not.toContain("token");
  });

  it("defaults: member.role is member, invitation.status is pending", () => {
    expect(getTableColumns(member).role.default).toBe("member");
    expect(getTableColumns(invitation).status.default).toBe("pending");
  });
});

/**
 * Every explicit index, with the query path that justifies it.
 *
 * D1 bills rows *scanned*, so an unindexed filter reads the whole table
 * (docs/costs-and-limits.md). Asserted as a complete set: an index added
 * without a consumer fails here just as loudly as a missing one, which is what
 * keeps this from drifting into "index every column".
 *
 * Most consumers are Better Auth adapter queries rather than application code,
 * so grepping this repo for a call site will not find them.
 */
const expectedIndexes: Array<{ index: string; table: string; columns: string[]; why: string }> = [
  {
    index: "account_providerId_accountId_idx",
    table: "account",
    columns: ["providerId", "accountId"],
    why: "social sign-in resolves an incoming provider identity to a local account",
  },
  {
    index: "account_userId_idx",
    table: "account",
    columns: ["userId"],
    why: "listing a user's linked providers, and the user-delete cascade",
  },
  {
    index: "apiToken_organizationId_idx",
    table: "apiToken",
    columns: ["organizationId"],
    why: "the org-delete cascade that revokes org-scoped tokens",
  },
  {
    index: "apiToken_userId_idx",
    table: "apiToken",
    columns: ["userId"],
    why: "the settings token list, and the user-delete cascade",
  },
  {
    index: "invitation_email_idx",
    table: "invitation",
    columns: ["email"],
    why: "accepting an invitation resolves it by the invitee's address",
  },
  {
    index: "invitation_inviterId_idx",
    table: "invitation",
    columns: ["inviterId"],
    why: "the user-delete cascade",
  },
  {
    index: "invitation_organizationId_idx",
    table: "invitation",
    columns: ["organizationId"],
    why: "invitation lists, and the org-delete cascade",
  },
  {
    index: "member_organizationId_idx",
    table: "member",
    columns: ["organizationId"],
    why: "member lists, and the org-delete cascade",
  },
  {
    index: "member_userId_idx",
    table: "member",
    columns: ["userId"],
    why: "listOrganizations on every dashboard navigation, and the user-delete cascade",
  },
  {
    index: "session_userId_idx",
    table: "session",
    columns: ["userId"],
    why: "session listing and revoke-all, and the user-delete cascade",
  },
  {
    index: "verification_identifier_idx",
    table: "verification",
    columns: ["identifier"],
    why: "every signup, verification click and password reset",
  },
];

describe("hot-path indexes", () => {
  const actual = tables
    .flatMap(({ table }) =>
      getTableConfig(table).indexes.map((idx) => ({
        index: idx.config.name,
        table: getTableName(table),
        columns: idx.config.columns.map((c) => ("name" in c ? String(c.name) : String(c))),
      })),
    )
    .sort((a, b) => a.index.localeCompare(b.index));

  it("declares exactly the expected indexes, on the expected columns", () => {
    expect(actual).toEqual(
      expectedIndexes.map(({ index, table, columns }) => ({ index, table, columns })),
    );
  });

  it.each(expectedIndexes)("$index exists — $why", ({ index }) => {
    expect(actual.map((a) => a.index)).toContain(index);
  });

  // Deliberately absent: it would serve only the set-null above, and
  // organization deletion is rare while `session` takes a write on every
  // sign-in. If this ever flips, update the comment in sessions.ts too.
  it("does not index session.activeOrganizationId", () => {
    expect(actual.map((a) => a.index)).not.toContain("session_activeOrganizationId_idx");
  });
});
