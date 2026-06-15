import { pgTable, text, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const meetingPointsTable = pgTable("meeting_points", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().unique(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  label: text("label"),
  setByName: text("set_by_name").notNull(),
  setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMeetingPointSchema = createInsertSchema(meetingPointsTable);
export type InsertMeetingPoint = z.infer<typeof insertMeetingPointSchema>;
export type MeetingPoint = typeof meetingPointsTable.$inferSelect;
