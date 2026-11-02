import mongoose from "mongoose";
import { RequestLog } from "../../models/index.js";

/**
 * Get errors analytics for a project
 * Returns: error summary, breakdown by status code, top failing endpoints, trends
 */
export async function getErrorsAnalytics(projectId, range = "24h") {
  // Cast projectId to ObjectId
  const projectObjectId = new mongoose.Types.ObjectId(projectId);
  const now = new Date();
  let startTime, bucketUnit;

  // Determine time range and bucketing
  switch (range) {
    case "24h":
      startTime = new Date(now - 24 * 60 * 60 * 1000);
      bucketUnit = "hour";
      break;
    case "7d":
      startTime = new Date(now - 7 * 24 * 60 * 60 * 1000);
      bucketUnit = "day";
      break;
    case "30d":
      startTime = new Date(now - 30 * 24 * 60 * 60 * 1000);
      bucketUnit = "day";
      break;
    default:
      startTime = new Date(now - 24 * 60 * 60 * 1000);
      bucketUnit = "hour";
  }

  try {
    // Run aggregations in parallel
    const [summaryData, statusCodeData, endpointsData, trendData] = await Promise.all([
      getErrorSummary(projectObjectId, startTime),
      getErrorsByStatusCode(projectObjectId, startTime),
      getTopFailingEndpoints(projectObjectId, startTime),
      getErrorTrend(projectObjectId, startTime, bucketUnit),
    ]);

    return {
      summary: summaryData,
      byStatusCode: statusCodeData,
      topFailingEndpoints: endpointsData,
      trend: trendData,
    };
  } catch (error) {
    console.error("[errors.service] Error fetching errors analytics:", error);
    throw error;
  }
}

/**
 * Get error summary stats
 */
async function getErrorSummary(projectId, startTime) {
  const pipeline = [
    {
      $match: {
        projectId,
        timestamp: { $gte: startTime },
      },
    },
    {
      $group: {
        _id: null,
        totalRequests: { $sum: 1 },
        totalErrors: {
          $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] },
        },
        injectedErrors: {
          $sum: {
            $cond: [
              { $and: [{ $gte: ["$statusCode", 400] }, "$chaosApplied"] },
              1,
              0,
            ],
          },
        },
        realErrors: {
          $sum: {
            $cond: [
              { $and: [{ $gte: ["$statusCode", 500] }, { $not: "$chaosApplied" }] },
              1,
              0,
            ],
          },
        },
      },
    },
  ];

  const result = await RequestLog.aggregate(pipeline);

  if (!result.length) {
    return {
      totalRequests: 0,
      totalErrors: 0,
      errorRate: 0,
      injectedErrors: 0,
      realErrors: 0,
    };
  }

  const data = result[0];
  return {
    totalRequests: data.totalRequests,
    totalErrors: data.totalErrors,
    errorRate:
      data.totalRequests > 0
        ? parseFloat(((data.totalErrors / data.totalRequests) * 100).toFixed(1))
        : 0,
    injectedErrors: data.injectedErrors,
    realErrors: data.realErrors,
  };
}

/**
 * Get errors grouped by status code
 */
async function getErrorsByStatusCode(projectId, startTime) {
  const pipeline = [
    {
      $match: {
        projectId,
        timestamp: { $gte: startTime },
        statusCode: { $gte: 400 }, // Only errors
      },
    },
    {
      $group: {
        _id: "$statusCode",
        count: { $sum: 1 },
        chaosCount: { $sum: { $cond: ["$chaosApplied", 1, 0] } },
        // Group endpoints for this status code
        endpoints: {
          $addToSet: {
            method: "$method",
            path: "$path",
          },
        },
      },
    },
    {
      $sort: { count: -1 },
    },
    {
      $project: {
        statusCode: "$_id",
        count: 1,
        chaosCount: 1,
        topEndpoint: { $first: "$endpoints" },
        _id: 0,
      },
    },
  ];

  const result = await RequestLog.aggregate(pipeline);

  // Add meaning/description for each status code
  return result.map((item) => ({
    statusCode: item.statusCode,
    meaning: getStatusCodeMeaning(item.statusCode),
    count: item.count,
    chaosCount: item.chaosCount,
    topEndpoint: item.topEndpoint
      ? `${item.topEndpoint.method} ${item.topEndpoint.path}`
      : "N/A",
  }));
}

/**
 * Get top failing endpoints
 */
async function getTopFailingEndpoints(projectId, startTime, limit = 10) {
  const pipeline = [
    {
      $match: {
        projectId,
        timestamp: { $gte: startTime },
      },
    },
    {
      $group: {
        _id: {
          endpointId: "$endpointId",
          method: "$method",
          path: "$path",
        },
        totalRequests: { $sum: 1 },
        errors: {
          $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] },
        },
        chaosErrors: {
          $sum: {
            $cond: [
              { $and: [{ $gte: ["$statusCode", 400] }, "$chaosApplied"] },
              1,
              0,
            ],
          },
        },
        realErrors: {
          $sum: {
            $cond: [
              { $and: [{ $gte: ["$statusCode", 400] }, { $not: "$chaosApplied" }] },
              1,
              0,
            ],
          },
        },
      },
    },
    {
      $match: {
        errors: { $gt: 0 }, // Only endpoints with errors
      },
    },
    {
      $project: {
        endpointId: "$_id.endpointId",
        method: "$_id.method",
        path: "$_id.path",
        totalRequests: 1,
        errors: 1,
        chaosErrors: 1,
        realErrors: 1,
        errorRate: {
          $multiply: [{ $divide: ["$errors", "$totalRequests"] }, 100],
        },
        _id: 0,
      },
    },
    {
      $sort: { errors: -1 },
    },
    {
      $limit: limit,
    },
  ];

  const result = await RequestLog.aggregate(pipeline);

  return result.map((ep) => ({
    endpointId: ep.endpointId,
    method: ep.method,
    path: ep.path,
    totalRequests: ep.totalRequests,
    errors: ep.errors,
    chaosErrors: ep.chaosErrors,
    realErrors: ep.realErrors,
    errorRate: parseFloat(ep.errorRate.toFixed(1)),
  }));
}

/**
 * Get error trend over time
 */
async function getErrorTrend(projectId, startTime, bucketUnit) {
  const pipeline = [
    {
      $match: {
        projectId,
        timestamp: { $gte: startTime },
      },
    },
    {
      $group: {
        _id: { $dateTrunc: { date: "$timestamp", unit: bucketUnit } },
        total: { $sum: 1 },
        errors: {
          $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] },
        },
        chaosErrors: {
          $sum: {
            $cond: [
              { $and: [{ $gte: ["$statusCode", 400] }, "$chaosApplied"] },
              1,
              0,
            ],
          },
        },
        realErrors: {
          $sum: {
            $cond: [
              { $and: [{ $gte: ["$statusCode", 400] }, { $not: "$chaosApplied" }] },
              1,
              0,
            ],
          },
        },
      },
    },
    {
      $sort: { _id: 1 },
    },
    {
      $project: {
        timestamp: "$_id",
        total: 1,
        errors: 1,
        chaosErrors: 1,
        realErrors: 1,
        _id: 0,
      },
    },
  ];

  const result = await RequestLog.aggregate(pipeline);
  return result;
}

/**
 * Get human-readable meaning for status code
 */
function getStatusCodeMeaning(code) {
  const meanings = {
    400: "Bad request",
    401: "Session expired",
    403: "Rate limited",
    404: "Not found",
    408: "Request timeout",
    422: "Unprocessable content",
    429: "Too many requests",
    500: "Internal server error",
    502: "Bad gateway",
    503: "Service unavailable",
    504: "Gateway timeout",
  };

  return meanings[code] || (code >= 400 && code < 500 ? "Client error" : "Server error");
}

/**
 * Get recent error request logs (individual requests, not aggregated)
 */
export async function getRecentErrorLogs(projectId, range = "24h", limit = 100) {
  const projectObjectId = new mongoose.Types.ObjectId(projectId);
  const now = new Date();
  let startTime;

  switch (range) {
    case "24h":
      startTime = new Date(now - 24 * 60 * 60 * 1000);
      break;
    case "7d":
      startTime = new Date(now - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30d":
      startTime = new Date(now - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      startTime = new Date(now - 24 * 60 * 60 * 1000);
  }

  try {
    const logs = await RequestLog.find({
      projectId: projectObjectId,
      timestamp: { $gte: startTime },
      statusCode: { $gte: 400 }, // Only errors
    })
      .sort({ timestamp: -1 }) // Most recent first
      .limit(limit)
      .select({
        timestamp: 1,
        method: 1,
        path: 1,
        statusCode: 1,
        responseTime: 1,
        chaosApplied: 1,
        chaosRules: 1,
        endpointId: 1,
      })
      .lean();

    return logs.map((log) => ({
      id: log._id.toString(),
      timestamp: log.timestamp,
      method: log.method,
      path: log.path,
      statusCode: log.statusCode,
      responseTime: log.responseTime,
      chaosApplied: log.chaosApplied || false,
      chaosRules: log.chaosRules || [],
      endpointId: log.endpointId?.toString() || null,
    }));
  } catch (error) {
    console.error("[errors.service] Error fetching recent error logs:", error);
    throw error;
  }
}
