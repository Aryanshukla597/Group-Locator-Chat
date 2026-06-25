import { Router, type IRouter } from "express";
import { eq, and, asc, desc } from "drizzle-orm";
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
  UpdateMemberRoleParams,
  UpdateMemberRoleBody,
  RemoveMemberParams,
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

async function updateMemberActivity(memberId: string): Promise<void> {
  await db
    .update(locationsTable)
    .set({ updatedAt: new Date(), isOnline: true })
    .where(eq(locationsTable.memberId, memberId));
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

function checkRole(allowedRoles: ("owner" | "admin" | "member")[]) {
  return async (req: any, res: any, next: any) => {
    const groupId = req.params.groupId;
    if (!groupId) {
      res.status(400).json({ error: "Missing groupId parameter" });
      return;
    }
    const member = await requireMember(req, res, groupId);
    if (!member) return; // requireMember handles sending 401/403

    if (!allowedRoles.includes(member.role as any)) {
      res.status(403).json({ error: "Forbidden: Insufficient permissions." });
      return;
    }
    req.member = member;
    next();
  };
}

// POST /groups — create group
router.post("/groups", async (req, res): Promise<void> => {
  const parsed = CreateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { name, creatorName, userId } = parsed.data;

  const groupId = generateId();
  const inviteCode = generateInviteCode();
  const memberId = generateId();
  const token = generateToken();
  const finalUserId = userId || generateId();

  await db.insert(groupsTable).values({ id: groupId, name, inviteCode, isLocked: false, isActive: true });
  await db.insert(membersTable).values({ id: memberId, name: creatorName, groupId, token, userId: finalUserId, role: "owner" });

  // System message
  await db.insert(messagesTable).values({
    id: generateId(),
    groupId,
    memberId: null,
    memberName: "System",
    content: `${creatorName} created the group`,
    type: "system",
    createdAt: new Date(),
  });

  const group = { id: groupId, name, inviteCode, isLocked: false, isActive: true, createdAt: new Date().toISOString(), memberCount: 1 };
  res.status(201).json({ group, memberId, token });
});

// POST /groups/join — join group
router.post("/groups/join", async (req, res): Promise<void> => {
  const parsed = JoinGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { inviteCode, memberName, userId } = parsed.data;

  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.inviteCode, inviteCode.toUpperCase()));
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  // Check if group is inactive/ended
  if (!group.isActive) {
    res.status(403).json({ error: "This group has ended. New members cannot join." });
    return;
  }

  // Check if group is locked
  if (group.isLocked) {
    res.status(403).json({ error: "This group is locked. New members cannot join." });
    return;
  }

  const finalUserId = userId || generateId();

  // Unique User Profile Check: If the same person joins again, reuse their existing profile
  const [existingMember] = await db
    .select()
    .from(membersTable)
    .where(
      and(
        eq(membersTable.groupId, group.id),
        eq(membersTable.userId, finalUserId)
      )
    );

  let memberId: string;
  let token: string;
  let joinedAt: string;

  if (existingMember) {
    memberId = existingMember.id;
    token = generateToken();
    joinedAt = existingMember.joinedAt.toISOString();

    // Update existing member session info and restore sharing state
    await db
      .update(membersTable)
      .set({ name: memberName, token, isLocationSharing: true })
      .where(eq(membersTable.id, memberId));
  } else {
    memberId = generateId();
    token = generateToken();
    joinedAt = new Date().toISOString();

    await db.insert(membersTable).values({ id: memberId, name: memberName, groupId: group.id, token, userId: finalUserId, role: "member" });
  }

  // Ensure a default location record exists so last seen works correctly even if they never share GPS coordinates
  const [existingLoc] = await db.select().from(locationsTable).where(eq(locationsTable.memberId, memberId));
  if (!existingLoc) {
    await db.insert(locationsTable).values({
      memberId,
      memberName,
      groupId: group.id,
      latitude: null,
      longitude: null,
      accuracy: null,
      isSharing: true,
      isOnline: true,
      updatedAt: new Date(),
    });
  } else {
    await db
      .update(locationsTable)
      .set({ isSharing: true, memberName, isOnline: true, updatedAt: new Date() })
      .where(eq(locationsTable.memberId, memberId));
  }

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
    createdAt: new Date(),
  });

  // Broadcast join event
  broadcastToGroup(group.id, {
    type: "member_joined",
    payload: { id: memberId, name: memberName, groupId: group.id, isLocationSharing: true, joinedAt },
  });
  broadcastToGroup(group.id, {
    type: "message",
    payload: { id: msgId, groupId: group.id, memberId: null, memberName: "System", content: `${memberName} joined the group`, type: "system", createdAt: new Date().toISOString() },
  });

  const groupOut = { id: group.id, name: group.name, inviteCode: group.inviteCode, isLocked: group.isLocked, isActive: group.isActive, createdAt: group.createdAt.toISOString(), memberCount };
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
  const ownerMember = members.find(m => m.role === "owner");
  const adminId = ownerMember?.id ?? null;
  res.json({ id: group.id, name: group.name, inviteCode: group.inviteCode, isLocked: group.isLocked, isActive: group.isActive, adminId, createdAt: group.createdAt.toISOString(), memberCount: members.length });
});

// GET /groups/:groupId/members
router.get("/groups/:groupId/members", async (req, res): Promise<void> => {
  const params = GetGroupMembersParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = await requireMember(req, res, params.data.groupId);
  if (!member) return;

  const members = await db.select().from(membersTable).where(eq(membersTable.groupId, params.data.groupId));
  res.json(members.map(m => ({
    id: m.id,
    name: m.name,
    groupId: m.groupId,
    isLocationSharing: m.isLocationSharing,
    isOnline: m.isOnline,
    isActive: m.isActive,
    role: m.role,
    lastReadMessageId: m.lastReadMessageId,
    joinedAt: m.joinedAt.toISOString()
  })));
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

  broadcastToGroup(params.data.groupId, { type: "member_left", payload: { id: member.id, name: member.name, groupId: params.data.groupId, isLocationSharing: false, joinedAt: member.joinedAt.toISOString(), action: "leave" } });
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
  const members = await db.select().from(membersTable).where(eq(membersTable.groupId, params.data.groupId));
  const locsMap = new Map(locs.map(l => [l.memberId, l]));
  const callerRole = member.role;

  res.json(members.map(m => {
    const l = locsMap.get(m.id);
    const targetRole = m.role;
    const isSharing = l ? l.isSharing : m.isLocationSharing;

    const canView = (callerRole === "owner" || callerRole === "admin") ||
                    (targetRole === "owner" || targetRole === "admin") ||
                    isSharing;

    return {
      memberId: m.id,
      memberName: m.name,
      latitude: (canView && l) ? l.latitude : null,
      longitude: (canView && l) ? l.longitude : null,
      accuracy: (canView && l) ? l.accuracy : null,
      updatedAt: l?.updatedAt?.toISOString() ?? null,
      isSharing,
      isOnline: m.isOnline,
    };
  }));
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
    .values({ memberId: member.id, memberName: member.name, groupId: params.data.groupId, latitude, longitude, accuracy: accuracy ?? null, isSharing: true, isOnline: true, updatedAt })
    .onDuplicateKeyUpdate({
      set: { latitude, longitude, accuracy: accuracy ?? null, isSharing: true, isOnline: true, updatedAt },
    });

  const locationOut = { memberId: member.id, memberName: member.name, latitude, longitude, accuracy: accuracy ?? null, updatedAt: updatedAt.toISOString(), isSharing: true, isOnline: true };

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
    payload: { memberId: member.id, isSharing: body.data.isSharing, isOnline: member.isOnline },
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
router.post("/groups/:groupId/meeting-point", checkRole(["owner", "admin"]), async (req, res): Promise<void> => {
  const params = SetMeetingPointParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = (req as any).member;
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
    .onDuplicateKeyUpdate({
      set: { id, latitude: mp.latitude, longitude: mp.longitude, label: mp.label, setByName: mp.setByName, setAt },
    });

  const mpOut = { ...mp, setAt: setAt.toISOString() };

  // System message
  const msgId = generateId();
  const msgContent = body.data.label ? `${member.name} set a meeting point: ${body.data.label}` : `${member.name} set a meeting point`;
  await db.insert(messagesTable).values({ id: msgId, groupId: params.data.groupId, memberId: null, memberName: "System", content: msgContent, type: "meeting_point", createdAt: new Date() });

  // Update locationsTable to mark user active and update updatedAt
  await updateMemberActivity(member.id);

  broadcastToGroup(params.data.groupId, { type: "meeting_point", payload: mpOut });
  broadcastToGroup(params.data.groupId, { type: "message", payload: { id: msgId, groupId: params.data.groupId, memberId: null, memberName: "System", content: msgContent, type: "meeting_point", createdAt: new Date().toISOString() } });

  res.json(mpOut);
});

// DELETE /groups/:groupId/meeting-point
router.delete("/groups/:groupId/meeting-point", checkRole(["owner", "admin"]), async (req, res): Promise<void> => {
  const params = ClearMeetingPointParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = (req as any).member;

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

  const body = req.body as { category?: string };
  const category = body.category || "general";
  const sosType = category === "general" ? "sos" : `sos_${category}`;

  // Get member's last location
  const [loc] = await db.select().from(locationsTable).where(eq(locationsTable.memberId, member.id));

  // Custom alert text
  let alertContent = "";
  if (category === "medical") {
    alertContent = `🚨 MEDICAL EMERGENCY: ${member.name} needs medical assistance!`;
  } else if (category === "fire") {
    alertContent = `🔥 FIRE EMERGENCY: ${member.name} reports a fire hazard!`;
  } else if (category === "police") {
    alertContent = `🚓 POLICE EMERGENCY: ${member.name} requests police assistance!`;
  } else {
    alertContent = `🚨 GENERAL SOS: ${member.name} needs help!`;
  }

  if (loc) {
    const mapUrl = `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`;
    alertContent += `\n📍 Live Location: ${mapUrl}`;
  }

  const msgId = generateId();
  await db.insert(messagesTable).values({
    id: msgId,
    groupId: params.data.groupId,
    memberId: member.id,
    memberName: member.name,
    content: alertContent,
    type: sosType,
    isPinned: false,
    isEdited: false,
    createdAt: new Date()
  });

  await updateMemberActivity(member.id);

  broadcastToGroup(params.data.groupId, {
    type: "sos",
    payload: {
      memberName: member.name,
      latitude: loc?.latitude ?? null,
      longitude: loc?.longitude ?? null,
      category,
      type: sosType
    },
  });
  broadcastToGroup(params.data.groupId, {
    type: "message",
    payload: {
      id: msgId,
      groupId: params.data.groupId,
      memberId: member.id,
      memberName: member.name,
      content: alertContent,
      type: sosType,
      isPinned: false,
      isEdited: false,
      createdAt: new Date().toISOString()
    },
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
    .orderBy(desc(messagesTable.createdAt))
    .limit(100);

  // Reverse to show oldest first in chronological chat view
  msgs.reverse();

  res.json(msgs.map(m => ({
    id: m.id,
    groupId: m.groupId,
    memberId: m.memberId,
    memberName: m.memberName,
    content: m.content,
    type: m.type,
    isPinned: !!m.isPinned,
    replyToId: m.replyToId,
    replyToName: m.replyToName,
    replyToContent: m.replyToContent,
    isEdited: !!m.isEdited,
    createdAt: m.createdAt.toISOString()
  })));
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
  
  const replyToId = req.body.replyToId || null;
  let replyToName: string | null = null;
  let replyToContent: string | null = null;

  if (replyToId) {
    const [origMsg] = await db.select().from(messagesTable).where(eq(messagesTable.id, replyToId));
    if (origMsg) {
      replyToName = origMsg.memberName;
      replyToContent = origMsg.content;
    }
  }

  await db.insert(messagesTable).values({
    id,
    groupId: params.data.groupId,
    memberId: member.id,
    memberName: member.name,
    content: body.data.content,
    type: "chat",
    isPinned: false,
    replyToId,
    replyToName,
    replyToContent,
    isEdited: false,
    createdAt
  });

  await updateMemberActivity(member.id);

  const msgOut = {
    id,
    groupId: params.data.groupId,
    memberId: member.id,
    memberName: member.name,
    content: body.data.content,
    type: "chat",
    isPinned: false,
    replyToId,
    replyToName,
    replyToContent,
    isEdited: false,
    createdAt: createdAt.toISOString()
  };

  broadcastToGroup(params.data.groupId, { type: "message", payload: msgOut });

  res.status(201).json(msgOut);
});

// POST /groups/:groupId/lock — lock/unlock group (admin only)
router.post("/groups/:groupId/lock", checkRole(["owner", "admin"]), async (req, res): Promise<void> => {
  const params = GetGroupParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = (req as any).member;

  const body = req.body as { isLocked?: boolean };
  const isLocked = typeof body.isLocked === "boolean" ? body.isLocked : true;

  await db.update(groupsTable).set({ isLocked }).where(eq(groupsTable.id, params.data.groupId));

  const action = isLocked ? "locked" : "unlocked";
  const msgId = generateId();
  await db.insert(messagesTable).values({
    id: msgId,
    groupId: params.data.groupId,
    memberId: member.id,
    memberName: member.name,
    content: `${member.name} ${action} the group`,
    type: "system",
    createdAt: new Date(),
  });

  broadcastToGroup(params.data.groupId, { type: "group_lock_changed", payload: { isLocked } });
  broadcastToGroup(params.data.groupId, { type: "message", payload: { id: msgId, groupId: params.data.groupId, memberId: member.id, memberName: member.name, content: `${member.name} ${action} the group`, type: "system", createdAt: new Date().toISOString() } });

  res.json({ ok: true, isLocked });
});

// POST /groups/:groupId/end — end group sharing (admin only)
router.post("/groups/:groupId/end", checkRole(["owner"]), async (req, res): Promise<void> => {
  const params = GetGroupParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const member = (req as any).member;

  // Update group status to inactive/ended
  await db.update(groupsTable).set({ isActive: false }).where(eq(groupsTable.id, params.data.groupId));

  // Delete all members
  await db.delete(membersTable).where(eq(membersTable.groupId, params.data.groupId));

  // Delete all location sharing data
  await db.delete(locationsTable).where(eq(locationsTable.groupId, params.data.groupId));

  // Delete all meeting points
  await db.delete(meetingPointsTable).where(eq(meetingPointsTable.groupId, params.data.groupId));

  // Delete all messages
  await db.delete(messagesTable).where(eq(messagesTable.groupId, params.data.groupId));

  // Broadcast "group_ended" event to notify all connected clients
  broadcastToGroup(params.data.groupId, { type: "group_ended", payload: {} });

  res.json({ ok: true });
});

// POST /groups/:groupId/members/:memberId/role — promote/demote members
router.post("/groups/:groupId/members/:memberId/role", checkRole(["owner"]), async (req, res): Promise<void> => {
  const params = UpdateMemberRoleParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const body = UpdateMemberRoleBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { groupId, memberId } = params.data;
  const { role } = body.data;

  // Find target member
  const [targetMember] = await db
    .select()
    .from(membersTable)
    .where(and(eq(membersTable.id, memberId), eq(membersTable.groupId, groupId)));

  if (!targetMember) {
    res.status(404).json({ error: "Member not found in this group." });
    return;
  }

  if (targetMember.role === "owner") {
    res.status(403).json({ error: "Cannot change the role of the owner." });
    return;
  }

  // Update role
  await db.update(membersTable).set({ role }).where(eq(membersTable.id, memberId));

  // Broadcast WebSocket notification to all group members
  broadcastToGroup(groupId, {
    type: "member_role_changed",
    payload: { memberId, role },
  });

  res.json({ ok: true });
});

// DELETE /groups/:groupId/members/:memberId — remove a member (kick)
router.delete("/groups/:groupId/members/:memberId", checkRole(["owner"]), async (req, res): Promise<void> => {
  const params = RemoveMemberParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const { groupId, memberId } = params.data;

  // Find target member
  const [targetMember] = await db
    .select()
    .from(membersTable)
    .where(and(eq(membersTable.id, memberId), eq(membersTable.groupId, groupId)));

  if (!targetMember) {
    res.status(404).json({ error: "Member not found in this group." });
    return;
  }

  if (targetMember.role === "owner") {
    res.status(403).json({ error: "Cannot remove the owner/creator of the group." });
    return;
  }

  // Delete member and their locations
  await db.delete(membersTable).where(eq(membersTable.id, memberId));
  await db.delete(locationsTable).where(eq(locationsTable.memberId, memberId));

  // Broadcast WebSocket notification to all group members
  broadcastToGroup(groupId, {
    type: "member_left",
    payload: { 
      id: memberId, 
      name: targetMember.name, 
      groupId, 
      isLocationSharing: false, 
      joinedAt: targetMember.joinedAt.toISOString(),
      action: "kick"
    },
  });

  res.json({ ok: true });
});

// POST /groups/:groupId/members/me/status — update online status
router.post("/groups/:groupId/members/me/status", async (req, res): Promise<void> => {
  const params = req.params;
  const groupId = params.groupId;
  const member = await requireMember(req, res, groupId);
  if (!member) return;

  const body = req.body as { isOnline?: boolean };
  const isOnline = typeof body.isOnline === "boolean" ? body.isOnline : true;

  await db.update(membersTable).set({ isOnline }).where(eq(membersTable.id, member.id));
  await db.update(locationsTable).set({ isOnline, updatedAt: new Date() }).where(eq(locationsTable.memberId, member.id));

  broadcastToGroup(groupId, {
    type: "location_sharing_changed",
    payload: { memberId: member.id, isOnline, isSharing: member.isLocationSharing },
  });

  res.json({ ok: true });
});

// POST /groups/:groupId/members/me/active — update active (screen focus) status
router.post("/groups/:groupId/members/me/active", async (req, res): Promise<void> => {
  const params = req.params;
  const groupId = params.groupId;
  const member = await requireMember(req, res, groupId);
  if (!member) return;

  const body = req.body as { isActive?: boolean };
  const isActive = typeof body.isActive === "boolean" ? body.isActive : true;

  await db.update(membersTable).set({ isActive }).where(eq(membersTable.id, member.id));

  broadcastToGroup(groupId, {
    type: "member_active_changed",
    payload: { memberId: member.id, isActive },
  });

  res.json({ ok: true });
});

// POST /groups/:groupId/messages/:messageId/pin — pin/unpin message (owner/admin only)
router.post("/groups/:groupId/messages/:messageId/pin", checkRole(["owner", "admin"]), async (req, res): Promise<void> => {
  const { groupId, messageId } = req.params;
  const body = req.body as { isPinned?: boolean };
  const isPinned = typeof body.isPinned === "boolean" ? body.isPinned : true;

  const [msg] = await db.select().from(messagesTable).where(and(eq(messagesTable.id, messageId), eq(messagesTable.groupId, groupId)));
  if (!msg) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  await db.update(messagesTable).set({ isPinned }).where(eq(messagesTable.id, messageId));

  // Update locationsTable to mark user active and update updatedAt
  const caller = (req as any).member;
  await updateMemberActivity(caller.id);

  const updatedMsg = {
    id: msg.id,
    groupId: msg.groupId,
    memberId: msg.memberId,
    memberName: msg.memberName,
    content: msg.content,
    type: msg.type,
    isPinned,
    createdAt: msg.createdAt.toISOString()
  };

  broadcastToGroup(groupId, {
    type: "message",
    payload: updatedMsg,
  });

  res.json(updatedMsg);
});

// POST /groups/:groupId/members/me/read — mark messages as read
router.post("/groups/:groupId/members/me/read", async (req, res): Promise<void> => {
  const { groupId } = req.params;
  const member = await requireMember(req, res, groupId);
  if (!member) return;

  const body = req.body as { messageId?: string };
  if (!body.messageId) {
    res.status(400).json({ error: "Missing messageId" });
    return;
  }

  await db.update(membersTable).set({ lastReadMessageId: body.messageId }).where(eq(membersTable.id, member.id));

  // Update locationsTable to mark user active and update updatedAt
  await updateMemberActivity(member.id);

  // Broadcast read_receipt WebSocket event
  broadcastToGroup(groupId, {
    type: "read_receipt",
    payload: { memberId: member.id, messageId: body.messageId },
  });

  res.json({ ok: true });
});

// PATCH /groups/:groupId/messages/:messageId — edit chat message
router.patch("/groups/:groupId/messages/:messageId", async (req, res): Promise<void> => {
  const { groupId, messageId } = req.params;
  const member = await requireMember(req, res, groupId);
  if (!member) return;

  const body = SendMessageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [msg] = await db.select().from(messagesTable).where(and(eq(messagesTable.id, messageId), eq(messagesTable.groupId, groupId)));
  if (!msg) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  // Verify that the caller is the author of the message
  if (msg.memberId !== member.id) {
    res.status(403).json({ error: "Forbidden: You can only edit your own messages." });
    return;
  }

  await db.update(messagesTable).set({ content: body.data.content, isEdited: true }).where(eq(messagesTable.id, messageId));

  // Update locationsTable to mark user active and update updatedAt
  await updateMemberActivity(member.id);

  const updatedMsg = {
    id: msg.id,
    groupId: msg.groupId,
    memberId: msg.memberId,
    memberName: msg.memberName,
    content: body.data.content,
    type: msg.type,
    isPinned: !!msg.isPinned,
    replyToId: msg.replyToId,
    replyToName: msg.replyToName,
    replyToContent: msg.replyToContent,
    isEdited: true,
    createdAt: msg.createdAt.toISOString()
  };

  broadcastToGroup(groupId, {
    type: "message_updated",
    payload: updatedMsg,
  });

  res.json(updatedMsg);
});

// DELETE /groups/:groupId/messages/:messageId — delete chat message
router.delete("/groups/:groupId/messages/:messageId", async (req, res): Promise<void> => {
  const { groupId, messageId } = req.params;
  const member = await requireMember(req, res, groupId);
  if (!member) return;

  const [msg] = await db.select().from(messagesTable).where(and(eq(messagesTable.id, messageId), eq(messagesTable.groupId, groupId)));
  if (!msg) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  // Verify that the caller is the author of the message, or is the owner
  const isAuthor = msg.memberId === member.id;
  const isOwner = member.role === "owner";
  if (!isAuthor && !isOwner) {
    res.status(403).json({ error: "Forbidden: Insufficient permissions to delete this message." });
    return;
  }

  await db.delete(messagesTable).where(eq(messagesTable.id, messageId));

  broadcastToGroup(groupId, {
    type: "message_deleted",
    payload: { messageId },
  });

  res.json({ ok: true });
});

export default router;
