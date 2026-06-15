import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, groupsTable, membersTable, locationsTable, meetingPointsTable, messagesTable } from "@workspace/db";
import {
  CreateGroupBody,
  JoinGroupBody,
  GetGroupParams,
  GetGroupMembersParams,
  LeaveGroupParams,
  GetGroupLocationsParams,
  UpdateLocationParams,
  UpdateLocationBody,
  UpdateLocationSharingParams,
  UpdateLocationSharingBody,
  GetMeetingPointParams,
  SetMeetingPointParams,
  SetMeetingPointBody,
  ClearMeetingPointParams,
  TriggerSosParams,
  ListMessagesParams,
  SendMessageParams,
  SendMessageBody,
} from "@workspace/api-zod";
import { broadcastToGroup } from "../lib/ws";
import { logger } from "../lib/logger";
import crypto from "crypto";

const router: IRouter = Router();

function generateId(): string {
  return crypto.randomUUID();
}

function generateInviteCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function getMember(req: any): { memberId: string; token: string } | null {
  const auth = req.headers["authorization"] as string | undefined;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  return { memberId: "", token };
}

async function getMemberByToken(token: string) {
  const [member] = await db.select().from(membersTable).where(eq(membersTable.token, token));
  return member ?? null;
}

async function requireMember(req: any, res: any, groupId: string) {
  const auth = req.headers["authorization"] as string | undefined;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  const token = auth.slice(7);
  const member = await getMemberByToken(token);
  if (!member || member.groupId !== groupId) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return member;
}

// POST /groups — create group
router.post("/groups", async (req, res): Promise<void> => {
  const parsed = CreateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { name, creatorName } = parsed.data;

  const groupId = generateId();
  const inviteCode = generateInviteCode();
  const memberId = generateId();
  const token = generateToken();

  await db.insert(groupsTable).values({ id: groupId, name, inviteCode });
  await db.insert(membersTable).values({ id: memberId, name: creatorName, groupId, token });

  // System message
  await db.insert(messagesTable).values({
    id: generateId(),
    groupId,
    memberId: null,
    memberName: "System",
    content: `${creatorName} created the group`,
    type: "system",
  });

  const group = { id: groupId, name, inviteCode, createdAt: new Date().toISOString(), memberCount: 1 };
  res.status(201).json({ group, memberId, token });
});

// POST /groups/join — join group
router.post("/groups/join", async (req, res): Promise<void> => {
  const parsed = JoinGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { inviteCode, memberName } = parsed.data;

  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.inviteCode, inviteCode.toUpperCase()));
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const memberId = generateId();
  const token = generateToken();
  await db.insert(membersTable).values({ id: memberId, name: memberName, groupId: group.id, token });

  const memberCount = (await db.select().from(membersTable).where(eq(membersTable.groupId, group.id))).length;

  // System message
  const msgId = generateId();
  await db.insert(messagesTable).values({
    id: msgId,
    groupId: group.id,
    memberId: null,
    memberName: "System",
    content: `${memberName} joined the group`,
    type: "system",
  });

  // Broadcast join event
  broadcastToGroup(group.id, {
    type: "member_joined",
    payload: { id: memberId, name: memberName, groupId: group.id, isLocationSharing: true, joinedAt: new Date().toISOString() },
  });
  broadcastToGroup(group.id, {
    type: "message",
    payload: { id: msgId, groupId: group.id, memberId: null, memberName: "System", content: `${memberName} joined the group`, type: "system", createdAt: new Date().toISOString() },
  });

  const groupOut = { id: group.id, name: group.name, inviteCode: group.inviteCode, createdAt: group.createdAt.toISOString(), memberCount };
  res.status(200).json({ group: groupOut, memberId, token });
});

// GET /groups/:groupId
router.get("/groups/:groupId", async (req, res): Promise<void> => {
  const params = GetGroupParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = await requireMember(req, res, params.data.groupId);
  if (!member) return;

  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, params.data.groupId));
  if (!group) { res.status(404).json({ error: "Not found" }); return; }

  const members = await db.select().from(membersTable).where(eq(membersTable.groupId, group.id));
  res.json({ id: group.id, name: group.name, inviteCode: group.inviteCode, createdAt: group.createdAt.toISOString(), memberCount: members.length });
});

// GET /groups/:groupId/members
router.get("/groups/:groupId/members", async (req, res): Promise<void> => {
  const params = GetGroupMembersParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = await requireMember(req, res, params.data.groupId);
  if (!member) return;

  const members = await db.select().from(membersTable).where(eq(membersTable.groupId, params.data.groupId));
  res.json(members.map(m => ({ id: m.id, name: m.name, groupId: m.groupId, isLocationSharing: m.isLocationSharing, joinedAt: m.joinedAt.toISOString() })));
});

// POST /groups/:groupId/members/me/leave
router.post("/groups/:groupId/members/me/leave", async (req, res): Promise<void> => {
  const params = LeaveGroupParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = await requireMember(req, res, params.data.groupId);
  if (!member) return;

  await db.delete(membersTable).where(eq(membersTable.id, member.id));
  await db.delete(locationsTable).where(eq(locationsTable.memberId, member.id));

  const msgId = generateId();
  await db.insert(messagesTable).values({
    id: msgId,
    groupId: params.data.groupId,
    memberId: null,
    memberName: "System",
    content: `${member.name} left the group`,
    type: "system",
  });

  broadcastToGroup(params.data.groupId, { type: "member_left", payload: { id: member.id, name: member.name, groupId: params.data.groupId, isLocationSharing: false, joinedAt: member.joinedAt.toISOString() } });
  broadcastToGroup(params.data.groupId, { type: "message", payload: { id: msgId, groupId: params.data.groupId, memberId: null, memberName: "System", content: `${member.name} left the group`, type: "system", createdAt: new Date().toISOString() } });

  res.json({ ok: true });
});

// GET /groups/:groupId/locations
router.get("/groups/:groupId/locations", async (req, res): Promise<void> => {
  const params = GetGroupLocationsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = await requireMember(req, res, params.data.groupId);
  if (!member) return;

  const locs = await db.select().from(locationsTable).where(eq(locationsTable.groupId, params.data.groupId));
  res.json(locs.map(l => ({
    memberId: l.memberId,
    memberName: l.memberName,
    latitude: l.latitude,
    longitude: l.longitude,
    accuracy: l.accuracy,
    updatedAt: l.updatedAt.toISOString(),
    isSharing: l.isSharing,
  })));
});

// POST /groups/:groupId/locations
router.post("/groups/:groupId/locations", async (req, res): Promise<void> => {
  const params = UpdateLocationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = await requireMember(req, res, params.data.groupId);
  if (!member) return;

  const body = UpdateLocationBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { latitude, longitude, accuracy } = body.data;
  const updatedAt = new Date();

  await db
    .insert(locationsTable)
    .values({ memberId: member.id, memberName: member.name, groupId: params.data.groupId, latitude, longitude, accuracy: accuracy ?? null, isSharing: true, updatedAt })
    .onConflictDoUpdate({
      target: locationsTable.memberId,
      set: { latitude, longitude, accuracy: accuracy ?? null, isSharing: true, updatedAt },
    });

  const locationOut = { memberId: member.id, memberName: member.name, latitude, longitude, accuracy: accuracy ?? null, updatedAt: updatedAt.toISOString(), isSharing: true };

  broadcastToGroup(params.data.groupId, { type: "location_update", payload: locationOut });

  res.json(locationOut);
});

// PATCH /groups/:groupId/locations/sharing
router.patch("/groups/:groupId/locations/sharing", async (req, res): Promise<void> => {
  const params = UpdateLocationSharingParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = await requireMember(req, res, params.data.groupId);
  if (!member) return;

  const body = UpdateLocationSharingBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  await db.update(membersTable).set({ isLocationSharing: body.data.isSharing }).where(eq(membersTable.id, member.id));
  await db.update(locationsTable).set({ isSharing: body.data.isSharing }).where(eq(locationsTable.memberId, member.id));

  broadcastToGroup(params.data.groupId, {
    type: "location_sharing_changed",
    payload: { memberId: member.id, isSharing: body.data.isSharing },
  });

  res.json({ ok: true });
});

// GET /groups/:groupId/meeting-point
router.get("/groups/:groupId/meeting-point", async (req, res): Promise<void> => {
  const params = GetMeetingPointParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = await requireMember(req, res, params.data.groupId);
  if (!member) return;

  const [mp] = await db.select().from(meetingPointsTable).where(eq(meetingPointsTable.groupId, params.data.groupId));
  if (!mp) {
    res.json(null);
    return;
  }
  res.json({ id: mp.id, groupId: mp.groupId, latitude: mp.latitude, longitude: mp.longitude, label: mp.label, setByName: mp.setByName, setAt: mp.setAt.toISOString() });
});

// POST /groups/:groupId/meeting-point
router.post("/groups/:groupId/meeting-point", async (req, res): Promise<void> => {
  const params = SetMeetingPointParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = await requireMember(req, res, params.data.groupId);
  if (!member) return;

  const body = SetMeetingPointBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const id = generateId();
  const setAt = new Date();
  const mp = {
    id,
    groupId: params.data.groupId,
    latitude: body.data.latitude,
    longitude: body.data.longitude,
    label: body.data.label ?? null,
    setByName: member.name,
    setAt,
  };

  await db
    .insert(meetingPointsTable)
    .values(mp)
    .onConflictDoUpdate({
      target: meetingPointsTable.groupId,
      set: { id, latitude: mp.latitude, longitude: mp.longitude, label: mp.label, setByName: mp.setByName, setAt },
    });

  const mpOut = { ...mp, setAt: setAt.toISOString() };

  // System message
  const msgId = generateId();
  const msgContent = body.data.label ? `${member.name} set a meeting point: ${body.data.label}` : `${member.name} set a meeting point`;
  await db.insert(messagesTable).values({ id: msgId, groupId: params.data.groupId, memberId: null, memberName: "System", content: msgContent, type: "meeting_point" });

  broadcastToGroup(params.data.groupId, { type: "meeting_point", payload: mpOut });
  broadcastToGroup(params.data.groupId, { type: "message", payload: { id: msgId, groupId: params.data.groupId, memberId: null, memberName: "System", content: msgContent, type: "meeting_point", createdAt: new Date().toISOString() } });

  res.json(mpOut);
});

// DELETE /groups/:groupId/meeting-point
router.delete("/groups/:groupId/meeting-point", async (req, res): Promise<void> => {
  const params = ClearMeetingPointParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = await requireMember(req, res, params.data.groupId);
  if (!member) return;

  await db.delete(meetingPointsTable).where(eq(meetingPointsTable.groupId, params.data.groupId));

  broadcastToGroup(params.data.groupId, { type: "meeting_point", payload: null });

  res.json({ ok: true });
});

// POST /groups/:groupId/sos
router.post("/groups/:groupId/sos", async (req, res): Promise<void> => {
  const params = TriggerSosParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = await requireMember(req, res, params.data.groupId);
  if (!member) return;

  // Get member's last location
  const [loc] = await db.select().from(locationsTable).where(eq(locationsTable.memberId, member.id));

  const msgId = generateId();
  const content = `SOS ALERT from ${member.name}${loc ? ` at (${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)})` : ""}`;
  await db.insert(messagesTable).values({ id: msgId, groupId: params.data.groupId, memberId: member.id, memberName: member.name, content, type: "sos" });

  broadcastToGroup(params.data.groupId, {
    type: "sos",
    payload: { memberName: member.name, latitude: loc?.latitude ?? null, longitude: loc?.longitude ?? null },
  });
  broadcastToGroup(params.data.groupId, {
    type: "message",
    payload: { id: msgId, groupId: params.data.groupId, memberId: member.id, memberName: member.name, content, type: "sos", createdAt: new Date().toISOString() },
  });

  res.json({ ok: true });
});

// GET /groups/:groupId/messages
router.get("/groups/:groupId/messages", async (req, res): Promise<void> => {
  const params = ListMessagesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = await requireMember(req, res, params.data.groupId);
  if (!member) return;

  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.groupId, params.data.groupId))
    .orderBy(messagesTable.createdAt)
    .limit(100);

  res.json(msgs.map(m => ({ id: m.id, groupId: m.groupId, memberId: m.memberId, memberName: m.memberName, content: m.content, type: m.type, createdAt: m.createdAt.toISOString() })));
});

// POST /groups/:groupId/messages
router.post("/groups/:groupId/messages", async (req, res): Promise<void> => {
  const params = SendMessageParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = await requireMember(req, res, params.data.groupId);
  if (!member) return;

  const body = SendMessageBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const id = generateId();
  const createdAt = new Date();
  await db.insert(messagesTable).values({ id, groupId: params.data.groupId, memberId: member.id, memberName: member.name, content: body.data.content, type: "chat", createdAt });

  const msgOut = { id, groupId: params.data.groupId, memberId: member.id, memberName: member.name, content: body.data.content, type: "chat", createdAt: createdAt.toISOString() };

  broadcastToGroup(params.data.groupId, { type: "message", payload: msgOut });

  res.status(201).json(msgOut);
});

export default router;
