import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { setupWebSocket } from "./lib/ws";
import { db, membersTable, locationsTable } from "@workspace/db";

const rawPort = process.env["PORT"] || "5000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

setupWebSocket(server);

// Reset stale online statuses on startup to prevent sync mismatches on reboots
(async () => {
  try {
    await db.update(membersTable).set({ isOnline: false, isActive: false });
    await db.update(locationsTable).set({ isOnline: false });
    logger.info("Stale member online statuses reset successfully on boot.");
  } catch (e) {
    logger.error({ err: e }, "Failed to reset stale online statuses on boot");
  }
})();

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});
