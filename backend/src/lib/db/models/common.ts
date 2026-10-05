import { timestamp, uuid } from "drizzle-orm/pg-core";

export const commonFields = {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
};
