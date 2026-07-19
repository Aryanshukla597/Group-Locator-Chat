import express, { type Express } from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import type { Request, Response, NextFunction } from "express";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req: any) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: any) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || process.env.NODE_ENV === "development") {
        return callback(null, true);
      }
      const isLocalhost = origin.startsWith("http://localhost:") || origin === "http://localhost" || origin.startsWith("http://127.0.0.1:") || origin === "http://127.0.0.1";
      const isVercel = origin.endsWith(".vercel.app");
      const isRailway = origin.endsWith(".up.railway.app");
      const isNgrok = origin.endsWith(".ngrok-free.dev") || origin.endsWith(".ngrok.io");
      if (isLocalhost || isVercel || isRailway || isNgrok) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.get("/", (req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error(err, "Unhandled error in request");
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
  });
});

export default app;
