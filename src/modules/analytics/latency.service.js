import mongoose from "mongoose";
import { RequestLog } from "../../models/index.js";

/**
 * Calculate percentile from sorted array
 */
function calculatePercentile(sortedArray, percentile) {
  if (!sortedArray.length) return 0;
  const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
  return sortedArray[Math.max(0, index)];
}

/**
 * Get latency analytics for a project
 * Returns: time series, distribution, slowest endpoints, percentiles
 */
export async function getLatencyAnalytics(projectId, range = "24h") {
  // projectId arrives as a string from req.params — cast to ObjectId so
  // MongoDB's $match can compare it against the ObjectId stored in the
  // timeseries metaField. String ≠ ObjectId → zero results without this.
  const projectObjectId = new mongoose.Types.ObjectId(projectId);
  const now = new Date();
  let startTime, bucketSize, bucketUnit;

  // Determine time range and bucketing
  switch (range) {
    case "24h":
      startTime = new Date(now - 24 * 60 * 60 * 1000);
      bucketSize = 60 * 60 * 1000; // 1 hour
      bucketUnit = "hour";
      break;
    case "7d":
      startTime = new Date(now - 7 * 24 * 60 * 60 * 1000);
      bucketSize = 24 * 60 * 60 * 1000; // 1 day
      bucketUnit = "day";
      break;
    case "30d":
      startTime = new Date(now - 30 * 24 * 60 * 60 * 1000);
      bucketSize = 24 * 60 * 60 * 1000; // 1 day
      bucketUnit = "day";
      break;
    default:
      startTime = new Date(now - 24 * 60 * 60 * 1000);
      bucketSize = 60 * 60 * 1000;
      bucketUnit = "hour";
  }

  try {
    // Run aggregations in parallel — pass projectObjectId (not the raw string)
    // so MongoDB can match the ObjectId stored in the timeseries metaField.
    const [timeSeriesData, distributionData, endpointsData, summaryData] = await Promise.all([
      getTimeSeriesData(projectObjectId, startTime, bucketUnit),
      getDistributionData(projectObjectId, startTime),
      getSlowestEndpoints(projectObjectId, startTime),
      getSummaryStats(projectObjectId, startTime),
    ]);

    // Process time series to extract percentiles
    const p50Series = timeSeriesData.map((bucket) => {
      const sorted = [...bucket.latencies].sort((a, b) => a - b);
      return {
        timestamp: bucket.timestamp,
        value: calculatePercentile(sorted, 50),
        hasChaos: bucket.chaosCount > 0,
      };
    });

    const p95Series = timeSeriesData.map((bucket) => {
      const sorted = [...bucket.latencies].sort((a, b) => a - b);
      return {
        timestamp: bucket.timestamp,
        value: calculatePercentile(sorted, 95),
        hasChaos: bucket.chaosCount > 0,
      };
    });

    const p99Series = timeSeriesData.map((bucket) => {
      const sorted = [...bucket.latencies].sort((a, b) => a - b);
      return {
        timestamp: bucket.timestamp,
        value: calculatePercentile(sorted, 99),
        hasChaos: bucket.chaosCount > 0,
      };
    });

    const maxSeries = timeSeriesData.map((bucket) => ({
      timestamp: bucket.timestamp,
      value: Math.max(...bucket.latencies, 0),
      hasChaos: bucket.chaosCount > 0,
    }));

    // Identify chaos windows (consecutive buckets with chaos)
    const chaosWindows = [];
    let windowStart = null;

    p95Series.forEach((point, index) => {
      if (point.hasChaos && windowStart === null) {
        windowStart = index;
      } else if (!point.hasChaos && windowStart !== null) {
        chaosWindows.push({
          startIndex: windowStart,
          endIndex: index - 1,
          startTime: p95Series[windowStart].timestamp,
          endTime: p95Series[index - 1].timestamp,
        });
        windowStart = null;
      }
    });

    // Close last window if still open
    if (windowStart !== null) {
      chaosWindows.push({
        startIndex: windowStart,
        endIndex: p95Series.length - 1,
        startTime: p95Series[windowStart].timestamp,
        endTime: p95Series[p95Series.length - 1].timestamp,
      });
    }

    return {
      totalRequests: summaryData.totalRequests,
      percentiles: {
        p50: summaryData.p50,
        p95: summaryData.p95,
        p99: summaryData.p99,
        max: summaryData.max,
      },
      timeSeries: {
        p50: p50Series,
        p95: p95Series,
        p99: p99Series,
        max: maxSeries,
        chaosWindows,
      },
      distribution: distributionData,
      slowestEndpoints: endpointsData,
    };
  } catch (error) {
    console.error("[latency.service] Error fetching latency analytics:", error);
    throw error;
  }
}

/**
 * Get time series data bucketed by hour or day
 */
async function getTimeSeriesData(projectId, startTime, bucketUnit) {
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
        latencies: { $push: "$responseTime" },
        chaosCount: {
          $sum: { $cond: ["$chaosApplied", 1, 0] },
        },
      },
    },
    {
      $sort: { _id: 1 },
    },
    {
      $project: {
        timestamp: "$_id",
        latencies: 1,
        chaosCount: 1,
        _id: 0,
      },
    },
  ];

  const result = await RequestLog.aggregate(pipeline);
  return result;
}

/**
 * Get latency distribution histogram (15 buckets)
 */
async function getDistributionData(projectId, startTime) {
  const pipeline = [
    {
      $match: {
        projectId,
        timestamp: { $gte: startTime },
      },
    },
    {
      $bucket: {
        groupBy: "$responseTime",
        boundaries: [0, 100, 200, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 10000, 999999],
        default: "other",
        output: {
          count: { $sum: 1 },
          chaosCount: { $sum: { $cond: ["$chaosApplied", 1, 0] } },
        },
      },
    },
  ];

  const result = await RequestLog.aggregate(pipeline);

  // Format as array of buckets with labels
  return result.map((bucket, index) => {
    const boundaries = [0, 100, 200, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 10000, 999999];
    return {
      min: bucket._id === "other" ? boundaries[boundaries.length - 1] : bucket._id,
      max: boundaries[index + 1] || Infinity,
      count: bucket.count,
      chaosCount: bucket.chaosCount,
    };
  });
}

/**
 * Get slowest endpoints by p95 latency
 */
async function getSlowestEndpoints(projectId, startTime, limit = 10) {
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
        allLatencies: { $push: "$responseTime" },
        realLatencies: {
          $push: {
            $cond: ["$chaosApplied", null, "$responseTime"],
          },
        },
        chaosLatencies: {
          $push: {
            $cond: ["$chaosApplied", "$responseTime", null],
          },
        },
        requestCount: { $sum: 1 },
        chaosCount: { $sum: { $cond: ["$chaosApplied", 1, 0] } },
      },
    },
    {
      $project: {
        endpointId: "$_id.endpointId",
        method: "$_id.method",
        path: "$_id.path",
        allLatencies: 1,
        realLatencies: {
          $filter: {
            input: "$realLatencies",
            as: "lat",
            cond: { $ne: ["$$lat", null] },
          },
        },
        chaosLatencies: {
          $filter: {
            input: "$chaosLatencies",
            as: "lat",
            cond: { $ne: ["$$lat", null] },
          },
        },
        requestCount: 1,
        chaosCount: 1,
        _id: 0,
      },
    },
  ];

  const results = await RequestLog.aggregate(pipeline);

  // Calculate p95 for each endpoint in JavaScript
  const endpoints = results
    .map((ep) => {
      const allSorted = [...ep.allLatencies].sort((a, b) => a - b);
      const realSorted = [...ep.realLatencies].sort((a, b) => a - b);
      const chaosSorted = [...ep.chaosLatencies].sort((a, b) => a - b);

      const p95All = calculatePercentile(allSorted, 95);
      const p95Real = calculatePercentile(realSorted, 95);
      const p95Chaos = calculatePercentile(chaosSorted, 95);

      return {
        endpointId: ep.endpointId,
        method: ep.method,
        path: ep.path,
        requestCount: ep.requestCount,
        chaosCount: ep.chaosCount,
        p95All,
        p95Real,
        p95Chaos: ep.chaosCount > 0 ? p95Chaos : p95Real,
        addedLatency: ep.chaosCount > 0 ? p95Chaos - p95Real : 0,
      };
    })
    .sort((a, b) => b.p95All - a.p95All)
    .slice(0, limit);

  return endpoints;
}

/**
 * Get summary statistics
 */
async function getSummaryStats(projectId, startTime) {
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
        latencies: { $push: "$responseTime" },
      },
    },
  ];

  const result = await RequestLog.aggregate(pipeline);

  if (!result.length || !result[0].latencies.length) {
    return {
      totalRequests: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      max: 0,
    };
  }

  const sorted = [...result[0].latencies].sort((a, b) => a - b);

  return {
    totalRequests: result[0].totalRequests,
    p50: calculatePercentile(sorted, 50),
    p95: calculatePercentile(sorted, 95),
    p99: calculatePercentile(sorted, 99),
    max: Math.max(...sorted),
  };
}
