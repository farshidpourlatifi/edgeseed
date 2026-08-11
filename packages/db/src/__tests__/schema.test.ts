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

describe("relational integrity", () => {
  it("session and account cascade-delete with their user", () => {
    for (const table of [session, account]) {
      const fks = getTableConfig(table).foreignKeys;
      expect(fks).toHaveLength(1);
      expect(fks[0].onDelete).toBe("cascade");
      expect(getTableName(fks[0].reference().foreignTable)).toBe("user");
    }
  });

  it("member references organization and user", () => {
    const referenced = getTableConfig(member)
      .foreignKeys.map((fk) => getTableName(fk.reference().foreignTable))
      .sort();
    expect(referenced).toEqual(["organization", "user"]);
  });

  it("invitation references organization and inviter", () => {
    const referenced = getTableConfig(invitation)
      .foreignKeys.map((fk) => getTableName(fk.reference().foreignTable))
      .sort();
    expect(referenced).toEqual(["organization", "user"]);
  });

  it("apiToken cascade-deletes with both its user and its organization", () => {
    const fks = getTableConfig(apiToken).foreignKeys;
    expect(fks).toHaveLength(2);
    for (const fk of fks) {
      expect(fk.onDelete, `${getTableName(fk.reference().foreignTable)} FK`).toBe("cascade");
    }
    expect(fks.map((fk) => getTableName(fk.reference().foreignTable)).sort()).toEqual([
      "organization",
      "user",
    ]);
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
