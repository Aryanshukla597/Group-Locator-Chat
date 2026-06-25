import { mysqlTable, varchar, boolean, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const membersTable = mysqlTable("members", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  groupId: varchar("group_id", { length: 36 }).notNull(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  role: varchar("role", { length: 20 }).notNull().default("member"),
  isLocationSharing: boolean("is_location_sharing").notNull().default(true),
  isOnline: boolean("is_online").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  lastReadMessageId: varchar("last_read_message_id", { length: 36 }),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
});

export const insertMemberSchema = createInsertSchema(membersTable);
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Member = typeof membersTable.$inferSelect;
