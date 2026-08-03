import { describe, it, expect } from "vitest";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { getTableColumns } from "drizzle-orm";
import { timestamps } from "../helpers/timestamps";

const probe = sqliteTable("probe", {
  id: text("id").primaryKey(),
  ...timestamps,
});

describe("timestamps helper", () => {
  const { createdAt, updatedAt } = getTableColumns(probe);

  it("adds NOT NULL createdAt and updatedAt columns", () => {
    expect(createdAt.name).toBe("createdAt");
    expect(updatedAt.name).toBe("updatedAt");
    expect(createdAt.notNull).toBe(true);
    expect(updatedAt.notNull).toBe(true);
    expect(createdAt.hasDefault).toBe(true);
    expect(updatedAt.hasDefault).toBe(true);
  });

  it("defaults both columns to the current time", () => {
    const before = Date.now();
    const created = createdAt.defaultFn?.();
    const updated = updatedAt.defaultFn?.();
    expect(created).toBeInstanceOf(Date);
    expect(updated).toBeInstanceOf(Date);
    expect((created as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("refreshes updatedAt on update", () => {
    const value = updatedAt.onUpdateFn?.();
    expect(value).toBeInstanceOf(Date);
    expect(createdAt.onUpdateFn).toBeUndefined();
  });
});
