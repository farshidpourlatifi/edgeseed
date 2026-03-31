import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema/index";

/** Create a typed Drizzle instance from a D1 binding */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof createDb>;
