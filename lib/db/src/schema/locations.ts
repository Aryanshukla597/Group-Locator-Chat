import { mysqlTable, varchar, double, boolean, timestamp, index } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const locationsTable = mysqlTable("locations", {
  memberId: varchar("member_id", { length: 36 }).primaryKey(),
  memberName: varchar("member_name", { length: 100 }).notNull(),
  groupId: varchar("group_id", { length: 36 }).notNull(),
  latitude: double("latitude"),
  longitude: double("longitude"),
  accuracy: double("accuracy"),
  isSharing: boolean("is_sharing").notNull().default(true),
  isOnline: boolean("is_online").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  groupIdIdx: index("group_id_idx").on(table.groupId),
}));

export const insertLocationSchema = createInsertSchema(locationsTable);
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Location = typeof locationsTable.$inferSelect;
