import mongoose from "mongoose";
import { RequestLog } from "../../models/index.js";

/**
 * Get endpoint health data for all endpoints in a project
 * Returns: health status per endpoint over time (for heatmap)
 */
export async function getEndpointHealthData(projectId, range = "24h") {
  const projectObjectId = new mongoose.Types.ObjectId(projectId);
  const now = new Date();
  let startTime, bucketUnit, bucketCount;

  // Determine time range and bucketing
  switch (range) {
    case "24h":
      startTime = new Date(now - 24 * 60 * 60 * 1000);
      bucketUnit = "hour";
      bucketCount = 24;
      break;
    case "7d":
      startTime = new Date(now - 7 * 24 * 60 * 60 * 1000);
      bucketUnit = "day";
      bucketCount = 7;
      break;
    case "30d":
      startTime = new Date(now - 30 * 24 * 60 * 60 * 1000);
      bucketUnit = "day";
      bucketCount = 30;
      break;
    default:
      startTime = new Date(now - 24 * 60 * 60 * 1000);
      bucketUnit = "hour";
      bucketCount = 24;
  }

  try {
    // Get time-bucketed data per endpoint
    const heatmapData = await getEndpointHeatmap(projectObjectId, startTime, bucketUnit);
    
    // Get overall endpoint stats
    const endpointStats = await getEndpointStats(projectObjectId, startTime);

    // Get alerts/issues
    const alerts = detectEndpointIssues(endpointStats, heatmapData);

    return {
      heatmap: heatmapData,
      endpoints: endpointStats,
      alerts,
      bucketUnit,
      bucketCount,
    };
  } catch (error) {
    console.error("[endpointHealth.service] Error fetching endpoint health:", error);
    throw error;
  }
}

/**
 * Get heatmap data: each endpoint's health status per time bucket
 */
async function getEndpointHeatmap(projectId, startTime, bucketUnit) {
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
          endpoint: { method: "$method", path: "$path" },
          bucket: { $dateTrunc: { date: "$timestamp", unit: bucketUnit } },
        },
        totalRequests: { $sum: 1 },
        errors: {
          $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] },
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
        chaosErrors: {
          $sum: {
            $cond: [
              { $and: [{ $gte: ["$statusCode", 400] }, "$chaosApplied"] },
              1,
              0,
            ],
          },
        },
      },
    },
    {
      $sort: { "_id.endpoint.path": 1, "_id.bucket": 1 },
    },
    {
      $project: {
        endpoint: "$_id.endpoint",
        bucket: "$_id.bucket",
        totalRequests: 1,
        errors: 1,
        realErrors: 1,
        chaosErrors: 1,
        errorRate: {
          $multiply: [{ $divide: ["$errors", "$totalRequests"] }, 100],
        },
        _id: 0,
      },
    },
  ];

  const result = await RequestLog.aggregate(pipeline);

  // Group by endpoint
  const endpointMap = new Map();
  
  result.forEach((item) => {
    const key = `${item.endpoint.method} ${item.endpoint.path}`;
    if (!endpointMap.has(key)) {
      endpointMap.set(key, {
        method: item.endpoint.method,
        path: item.endpoint.path,
        buckets: [],
      });
    }
    
    endpointMap.get(key).buckets.push({
      timestamp: item.bucket,
      totalRequests: item.totalRequests,
      errors: item.errors,
      realErrors: item.realErrors,
      chaosErrors: item.chaosErrors,
      errorRate: parseFloat(item.errorRate.toFixed(1)),
      status: determineHealthStatus(item.realErrors, item.totalRequests, item.chaosErrors),
    });
  });

  return Array.from(endpointMap.values());
}

/**
 * Determine health status for a bucket
 * - healthy: No real errors, traffic exists
 * - chaos_injected: Has chaos errors but no real errors
 * - real_failed: Has real errors (backend issues)
 * - no_traffic: No requests in this bucket
 */
function determineHealthStatus(realErrors, totalRequests, chaosErrors) {
  if (totalRequests === 0) return "no_traffic";
  if (realErrors > 0) return "real_failed";
  if (chaosErrors > 0) return "chaos_injected";
  return "healthy";
}

/**
 * Get overall stats per endpoint
 */
async function getEndpointStats(projectId, startTime) {
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
          method: "$method",
          path: "$path",
          endpointId: "$endpointId",
        },
        totalRequests: { $sum: 1 },
        successfulRequests: {
          $sum: { $cond: [{ $lt: ["$statusCode", 400] }, 1, 0] },
        },
        errors: {
          $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] },
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
        avgResponseTime: { $avg: "$responseTime" },
        p95ResponseTime: { $push: "$responseTime" }, // Will compute p95 in JS
      },
    },
    {
      $project: {
        method: "$_id.method",
        path: "$_id.path",
        endpointId: "$_id.endpointId",
        totalRequests: 1,
        successfulRequests: 1,
        errors: 1,
        realErrors: 1,
        avgResponseTime: 1,
        p95ResponseTime: 1,
        errorRate: {
          $multiply: [{ $divide: ["$errors", "$totalRequests"] }, 100],
        },
        _id: 0,
      },
    },
    {
      $sort: { path: 1 },
    },
  ];

  const result = await RequestLog.aggregate(pipeline);

  // Compute p95 in JavaScript
  return result.map((endpoint) => {
    const latencies = endpoint.p95ResponseTime.sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95 = latencies[p95Index] || 0;

    return {
      method: endpoint.method,
      path: endpoint.path,
      endpointId: endpoint.endpointId?.toString() || null,
      totalRequests: endpoint.totalRequests,
      successfulRequests: endpoint.successfulRequests,
      errors: endpoint.errors,
      realErrors: endpoint.realErrors,
      errorRate: parseFloat(endpoint.errorRate.toFixed(1)),
      avgResponseTime: Math.round(endpoint.avgResponseTime),
      p95ResponseTime: Math.round(p95),
      overallStatus: endpoint.realErrors > 0 ? "unhealthy" : "healthy",
    };
  });
}

/**
 * Detect issues that need attention
 */
function detectEndpointIssues(endpointStats, heatmapData) {
  const alerts = [];

  endpointStats.forEach((endpoint) => {
    // Alert if real error rate > 5%
    const realErrorRate = (endpoint.realErrors / endpoint.totalRequests) * 100;
    if (realErrorRate > 5) {
      alerts.push({
        severity: "high",
        endpoint: `${endpoint.method} ${endpoint.path}`,
        message: `${realErrorRate.toFixed(1)}% real error rate (${endpoint.realErrors} failures)`,
        type: "high_error_rate",
      });
    }

    // Alert if no traffic (could indicate routing issue)
    if (endpoint.totalRequests === 0) {
      alerts.push({
        severity: "info",
        endpoint: `${endpoint.method} ${endpoint.path}`,
        message: "No traffic received in selected time range",
        type: "no_traffic",
      });
    }

    // Alert if p95 latency > 3000ms
    if (endpoint.p95ResponseTime > 3000) {
      alerts.push({
        severity: "medium",
        endpoint: `${endpoint.method} ${endpoint.path}`,
        message: `High p95 latency: ${endpoint.p95ResponseTime}ms`,
        type: "high_latency",
      });
    }
  });

  // Check for sudden failures (endpoint was healthy then started failing)
  heatmapData.forEach((endpoint) => {
    const buckets = endpoint.buckets;
    if (buckets.length < 2) return;

    let consecutiveFailures = 0;
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (buckets[i].status === "real_failed") {
        consecutiveFailures++;
      } else {
        break;
      }
    }

    if (consecutiveFailures >= 3) {
      alerts.push({
        severity: "high",
        endpoint: `${endpoint.method} ${endpoint.path}`,
        message: `Failing for the last ${consecutiveFailures} time ${consecutiveFailures === 1 ? "period" : "periods"}`,
        type: "sudden_failure",
      });
    }
  });

  return alerts.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, info: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}
