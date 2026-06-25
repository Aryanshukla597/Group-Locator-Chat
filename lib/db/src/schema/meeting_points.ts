import { mysqlTable, varchar, double, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const meetingPointsTable = mysqlTable("meeting_points", {
  id: varchar("id", { length: 36 }).primaryKey(),
  groupId: varchar("group_id", { length: 36 }).notNull().unique(),
  latitude: double("latitude").notNull(),
  longitude: double("longitude").notNull(),
  label: varchar("label", { length: 200 }),
  setByName: varchar("set_by_name", { length: 100 }).notNull(),
  setAt: timestamp("set_at").notNull().defaultNow(),
});

export const insertMeetingPointSchema = createInsertSchema(meetingPointsTable);
export type InsertMeetingPoint = z.infer<typeof insertMeetingPointSchema>;
export type MeetingPoint = typeof meetingPointsTable.$inferSelect;
