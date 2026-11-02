import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import { getOverviewStats } from "./analytics.service.js";
import { getLatencyAnalytics } from "./latency.service.js";
import { getErrorsAnalytics, getRecentErrorLogs } from "./errors.service.js";
import { getEndpointHealthData } from "./endpointHealth.service.js";
import { searchLogs, getFilterOptions, getLogHistogram } from "./logSearch.service.js";

const VALID_RANGES = new Set(["24h", "7d", "30d"]);

/**
 * GET /api/v1/analytics/:projectId/overview?range=24h|7d|30d
 *
 * Returns aggregated metrics for the Insights overview page.
 * The requesting user must own the project (verified by verifyJWT + ownership check
 * in the service — projectId scoping ensures cross-tenant isolation at the DB level).
 */
const getOverview = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const range = req.query.range ?? "24h";

    if (!projectId) throw new ApiError(400, "projectId is required");
    if (!VALID_RANGES.has(range)) {
        throw new ApiError(400, `range must be one of: ${[...VALID_RANGES].join(", ")}`);
    }

    const stats = await getOverviewStats(projectId, range);
    return res.status(200).json(new ApiResponse(200, stats, "Overview fetched successfully"));
});

/**
 * GET /api/v1/analytics/:projectId/latency?range=24h|7d|30d
 *
 * Returns latency analytics including:
 * - Time series (p50, p95, p99, max) with chaos windows
 * - Distribution histogram
 * - Slowest endpoints
 * - Summary percentiles
 */
const getLatency = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const range = req.query.range ?? "24h";

    if (!projectId) throw new ApiError(400, "projectId is required");
    if (!VALID_RANGES.has(range)) {
        throw new ApiError(400, `range must be one of: ${[...VALID_RANGES].join(", ")}`);
    }

    const stats = await getLatencyAnalytics(projectId, range);
    return res.status(200).json(new ApiResponse(200, stats, "Latency analytics fetched successfully"));
});

/**
 * GET /api/v1/analytics/:projectId/errors?range=24h|7d|30d
 *
 * Returns error analytics including:
 * - Summary stats (total errors, error rate, injected vs real)
 * - Breakdown by status code
 * - Top failing endpoints
 * - Error trend over time
 */
const getErrors = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const range = req.query.range ?? "24h";

    if (!projectId) throw new ApiError(400, "projectId is required");
    if (!VALID_RANGES.has(range)) {
        throw new ApiError(400, `range must be one of: ${[...VALID_RANGES].join(", ")}`);
    }

    const stats = await getErrorsAnalytics(projectId, range);
    return res.status(200).json(new ApiResponse(200, stats, "Errors analytics fetched successfully"));
});

/**
 * GET /api/v1/analytics/:projectId/error-logs?range=24h|7d|30d&limit=100
 *
 * Returns recent individual error request logs (not aggregated)
 */
const getErrorLogs = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const range = req.query.range ?? "24h";
    const limit = parseInt(req.query.limit) || 100;

    if (!projectId) throw new ApiError(400, "projectId is required");
    if (!VALID_RANGES.has(range)) {
        throw new ApiError(400, `range must be one of: ${[...VALID_RANGES].join(", ")}`);
    }
    if (limit < 1 || limit > 1000) {
        throw new ApiError(400, "limit must be between 1 and 1000");
    }

    const logs = await getRecentErrorLogs(projectId, range, limit);
    return res.status(200).json(new ApiResponse(200, { logs, total: logs.length }, "Error logs fetched successfully"));
});

/**
 * GET /api/v1/analytics/:projectId/endpoint-health?range=24h|7d|30d
 *
 * Returns endpoint health data including:
 * - Heatmap: health status per endpoint per time bucket
 * - Endpoint stats: overall metrics per endpoint
 * - Alerts: detected issues
 */
const getEndpointHealth = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const range = req.query.range ?? "24h";

    if (!projectId) throw new ApiError(400, "projectId is required");
    if (!VALID_RANGES.has(range)) {
        throw new ApiError(400, `range must be one of: ${[...VALID_RANGES].join(", ")}`);
    }

    const data = await getEndpointHealthData(projectId, range);
    return res.status(200).json(new ApiResponse(200, data, "Endpoint health data fetched successfully"));
});

/**
 * GET /api/v1/analytics/:projectId/logs/search?query=...&statusCodes=500,502&chaosTypes=Error&modes=Passthrough&range=24h&limit=100&offset=0
 *
 * Search request logs with filters
 */
const searchRequestLogs = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const {
        query = "",
        statusCodes = "",
        chaosTypes = "",
        modes = "",
        range = "24h",
        limit = "100",
        offset = "0",
    } = req.query;

    if (!projectId) throw new ApiError(400, "projectId is required");
    if (!VALID_RANGES.has(range)) {
        throw new ApiError(400, `range must be one of: ${[...VALID_RANGES].join(", ")}`);
    }

    const parsedLimit = parseInt(limit);
    const parsedOffset = parseInt(offset);

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
        throw new ApiError(400, "limit must be between 1 and 1000");
    }
    if (isNaN(parsedOffset) || parsedOffset < 0) {
        throw new ApiError(400, "offset must be >= 0");
    }

    const options = {
        query,
        statusCodes: statusCodes ? statusCodes.split(",").map((s) => s.trim()) : [],
        chaosTypes: chaosTypes ? chaosTypes.split(",").map((s) => s.trim()) : [],
        modes: modes ? modes.split(",").map((s) => s.trim()) : [],
        range,
        limit: parsedLimit,
        offset: parsedOffset,
    };

    const result = await searchLogs(projectId, options);
    return res.status(200).json(new ApiResponse(200, result, "Logs fetched successfully"));
});

/**
 * GET /api/v1/analytics/:projectId/logs/filters?range=24h
 *
 * Get available filter options with counts
 */
const getLogFilterOptions = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const range = req.query.range ?? "24h";

    if (!projectId) throw new ApiError(400, "projectId is required");
    if (!VALID_RANGES.has(range)) {
        throw new ApiError(400, `range must be one of: ${[...VALID_RANGES].join(", ")}`);
    }

    const filters = await getFilterOptions(projectId, range);
    return res.status(200).json(new ApiResponse(200, filters, "Filter options fetched successfully"));
});

/**
 * GET /api/v1/analytics/:projectId/logs/histogram?query=...&statusCodes=500&chaosTypes=Error&modes=Passthrough&range=24h
 *
 * Get histogram data for log distribution over time
 */
const getLogsHistogram = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const {
        query = "",
        statusCodes = "",
        chaosTypes = "",
        modes = "",
        range = "24h",
    } = req.query;

    if (!projectId) throw new ApiError(400, "projectId is required");
    if (!VALID_RANGES.has(range)) {
        throw new ApiError(400, `range must be one of: ${[...VALID_RANGES].join(", ")}`);
    }

    const options = {
        query,
        statusCodes: statusCodes ? statusCodes.split(",").map((s) => s.trim()) : [],
        chaosTypes: chaosTypes ? chaosTypes.split(",").map((s) => s.trim()) : [],
        modes: modes ? modes.split(",").map((s) => s.trim()) : [],
        range,
    };

    const histogram = await getLogHistogram(projectId, options);
    return res.status(200).json(new ApiResponse(200, histogram, "Histogram fetched successfully"));
});

export { 
    getOverview, 
    getLatency, 
    getErrors, 
    getErrorLogs, 
    getEndpointHealth,
    searchRequestLogs,
    getLogFilterOptions,
    getLogsHistogram,
};
