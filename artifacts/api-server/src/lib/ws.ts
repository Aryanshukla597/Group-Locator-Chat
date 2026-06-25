import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage, Server } from "http";
import { db, membersTable, locationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { URL } from "url";

interface GroupClient {
  ws: WebSocket;
  groupId: string;
  memberId: string;
  memberName: string;
}

const clients = new Map<WebSocket, GroupClient>();

export function broadcastToGroup(groupId: string, message: { type: string; payload: unknown }): void {
  const data = JSON.stringify(message);
  for (const [ws, client] of clients.entries()) {
    if (client.groupId === groupId && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/api/ws" });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    let groupClient: GroupClient | null = null;

    try {
      const rawUrl = req.url ?? "";
      const url = new URL(rawUrl, "http://localhost");
      const groupId = url.searchParams.get("groupId");
      const token = url.searchParams.get("token");

      if (!groupId || !token) {
        ws.close(1008, "Missing groupId or token");
        return;
      }

      const [member] = await db.select().from(membersTable).where(eq(membersTable.token, token));
      if (!member || member.groupId !== groupId) {
        ws.close(1008, "Unauthorized");
        return;
      }

      groupClient = { ws, groupId, memberId: member.id, memberName: member.name };
      clients.set(ws, groupClient);

      // Mark member as online in DB immediately on connect
      await db.update(membersTable)
        .set({ isOnline: true, isActive: true })
        .where(eq(membersTable.id, member.id));

      await db.update(locationsTable)
        .set({ isOnline: true })
        .where(eq(locationsTable.memberId, member.id));

      // Broadcast online status to group members
      broadcastToGroup(groupId, {
        type: "location_sharing_changed",
        payload: { memberId: member.id, isOnline: true, isSharing: member.isLocationSharing },
      });

      logger.info({ groupId, memberId: member.id, memberName: member.name }, "WebSocket client connected");

      ws.on("message", (data) => {
        // Clients can send pings; ignore other messages (all updates go via REST)
      });

      ws.on("close", async () => {
        clients.delete(ws);
        if (groupClient) {
          const remainingConnections = Array.from(clients.values()).filter(
            (c) => c.memberId === groupClient!.memberId
          ).length;

          logger.info(
            { groupId: groupClient.groupId, memberId: groupClient.memberId, remainingConnections },
            "WebSocket client disconnected"
          );

          if (remainingConnections === 0) {
            logger.info(
              { groupId: groupClient.groupId, memberId: groupClient.memberId },
              "No connections left — marking offline"
            );
            try {
              // Mark member as offline in DB immediately on disconnect
              await db.update(membersTable)
                .set({ isOnline: false, isActive: false })
                .where(eq(membersTable.id, groupClient.memberId));

              await db.update(locationsTable)
                .set({ isOnline: false, updatedAt: new Date() })
                .where(eq(locationsTable.memberId, groupClient.memberId));

              // Broadcast offline status to remaining group members
              broadcastToGroup(groupClient.groupId, {
                type: "location_sharing_changed",
                payload: { memberId: groupClient.memberId, isOnline: false, isSharing: false },
              });
            } catch (err) {
              logger.error({ err }, "Failed to mark member offline on disconnect");
            }
          }
        }
      });

      ws.on("error", (err) => {
        logger.error({ err }, "WebSocket error");
        clients.delete(ws);
      });

      // Send a welcome ping
      ws.send(JSON.stringify({ type: "connected", payload: { memberId: member.id } }));
    } catch (err) {
      logger.error({ err }, "WebSocket connection error");
      ws.close(1011, "Internal error");
    }
  });

  return wss;
}
