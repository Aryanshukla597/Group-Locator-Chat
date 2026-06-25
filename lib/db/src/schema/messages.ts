import { mysqlTable, varchar, text, timestamp, index, boolean } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const messagesTable = mysqlTable("messages", {
  id: varchar("id", { length: 36 }).primaryKey(),
  groupId: varchar("group_id", { length: 36 }).notNull(),
  memberId: varchar("member_id", { length: 36 }),
  memberName: varchar("member_name", { length: 100 }).notNull(),
  content: text("content").notNull(),
  type: varchar("type", { length: 20 }).notNull().default("chat"),
  isPinned: boolean("is_pinned").notNull().default(false),
  replyToId: varchar("reply_to_id", { length: 36 }),
  replyToName: varchar("reply_to_name", { length: 100 }),
  replyToContent: text("reply_to_content"),
  isEdited: boolean("is_edited").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  groupIdIdx: index("group_id_idx").on(table.groupId),
}));

export const insertMessageSchema = createInsertSchema(messagesTable);
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
