import { Router } from "express";
import { 
    getOverview, 
    getLatency, 
    getErrors, 
    getErrorLogs, 
    getEndpointHealth,
    searchRequestLogs,
    getLogFilterOptions,
    getLogsHistogram,
    getChaosImpact,
} from "./analytics.controller.js";
import { verifyJWT } from "../../middlewares/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

router.get("/:projectId/overview", getOverview);
router.get("/:projectId/chaos-impact", getChaosImpact);
router.get("/:projectId/latency", getLatency);
router.get("/:projectId/errors", getErrors);
router.get("/:projectId/error-logs", getErrorLogs);
router.get("/:projectId/endpoint-health", getEndpointHealth);

// Log search routes
router.get("/:projectId/logs/search", searchRequestLogs);
router.get("/:projectId/logs/filters", getLogFilterOptions);
router.get("/:projectId/logs/histogram", getLogsHistogram);

export default router;
