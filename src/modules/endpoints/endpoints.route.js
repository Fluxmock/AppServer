import { Router } from "express";
import { configureEndpoint } from "./endpoints.controller.js";
import { verifyJWT } from "../../middlewares/auth.middleware.js";

const router = Router();

router.route("/:projectId/configure").post(verifyJWT, configureEndpoint);

export default router;