import { Router, type IRouter } from "express";
import healthRouter from "./health";
import groupsRouter from "./groups";

const router: IRouter = Router();

router.use(healthRouter);
router.use(groupsRouter);

export default router;
