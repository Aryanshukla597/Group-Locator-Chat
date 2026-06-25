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
      if (!origin) return callback(null, true);
      const isLocalhost = origin.startsWith("http://localhost:") || origin === "http://localhost";
      const isVercel = origin.endsWith(".vercel.app");
      const isRailway = origin.endsWith(".up.railway.app");
      if (isLocalhost || isVercel || isRailway) {
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

export default app;
