import mongoose from "mongoose";
import { RequestLog } from "../../models/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the start Date for the requested time window.
 *   "24h" → last 24 hours
 *   "7d"  → last 7 days
 *   "30d" → last 30 days
 */
function rangeStart(range) {
    const now = Date.now();
    const MS = { "24h": 24 * 60 * 60 * 1000, "7d": 7 * 24 * 60 * 60 * 1000, "30d": 30 * 24 * 60 * 60 * 1000 };
    return new Date(now - (MS[range] ?? MS["24h"]));
}

/**
 * For the traffic chart we bucket requests by hour (24h) or by day (7d/30d).
 * Returns the $dateToString format string and the number of expected buckets.
 */
function bucketConfig(range) {
    if (range === "24h") return { format: "%Y-%m-%dT%H:00", buckets: 24, stepMs: 60 * 60 * 1000 };
    if (range === "7d")  return { format: "%Y-%m-%d",      buckets: 7,  stepMs: 24 * 60 * 60 * 1000 };
    return                       { format: "%Y-%m-%d",      buckets: 30, stepMs: 24 * 60 * 60 * 1000 };
}

// ── Main aggregation ──────────────────────────────────────────────────────────

/**
 * getOverviewStats
 *
 * Runs two MongoDB aggregations in parallel:
 *   1. Summary stats (totals, rates, p95 latency)
 *   2. Traffic chart buckets
 *   3. Busiest endpoints
 *
 * All computed from the RequestLog time-series collection.
 *
 * @param {string} projectId
 * @param {"24h"|"7d"|"30d"} range
 * @returns {Promise<OverviewStats>}
 */
export async function getOverviewStats(projectId, range = "24h") {
    const pid = new mongoose.Types.ObjectId(projectId);
    const since = rangeStart(range);
    const { format, buckets, stepMs } = bucketConfig(range);
    const matchStage = { $match: { projectId: pid, timestamp: { $gte: since } } };

    // ── 1. Summary stats ──────────────────────────────────────────
    const [summaryResult, bucketResult, endpointResult] = await Promise.all([

        // Summary: totals, error counts, latency percentile
        RequestLog.aggregate([
            matchStage,
            {
                $group: {
                    _id: null,
                    total:          { $sum: 1 },
                    chaosInjected:  { $sum: { $cond: ["$chaosApplied", 1, 0] } },
                    // Real 5xx errors = server error AND not caused by chaos
                    realErrors:     { $sum: { $cond: [{ $and: [{ $gte: ["$statusCode", 500] }, { $eq: ["$chaosApplied", false] }] }, 1, 0] } },
                    // Client errors 4xx (intentional or chaos — caller decides)
                    clientErrors:   { $sum: { $cond: [{ $and: [{ $gte: ["$statusCode", 400] }, { $lt: ["$statusCode", 500] }] }, 1, 0] } },
                    // 4xx + 5xx combined for errorRate
                    allErrors:      { $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] } },
                    // Collect responseTime values for percentile calculation
                    latencies:      { $push: "$responseTime" },
                },
            },
        ]),

        // Traffic chart: bucket by hour or day
        RequestLog.aggregate([
            matchStage,
            {
                $group: {
                    _id: {
                        $dateToString: { format, date: "$timestamp", timezone: "UTC" },
                    },
                    successful: { $sum: { $cond: [{ $and: [{ $lt: ["$statusCode", 400] }, { $eq: ["$chaosApplied", false] }] }, 1, 0] } },
                    errors:     { $sum: { $cond: [{ $and: [{ $gte: ["$statusCode", 400] }, { $eq: ["$chaosApplied", false] }] }, 1, 0] } },
                    injected:   { $sum: { $cond: ["$chaosApplied", 1, 0] } },
                },
            },
            { $sort: { _id: 1 } },
        ]),

        // Busiest endpoints: top 5 by request count
        RequestLog.aggregate([
            matchStage,
            {
                $group: {
                    _id:       { endpointId: "$endpointId", method: "$method", path: "$path" },
                    requests:  { $sum: 1 },
                    errors:    { $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] } },
                },
            },
            { $sort: { requests: -1 } },
            { $limit: 5 },
        ]),
    ]);

    // ── Post-process summary ──────────────────────────────────────
    const summary = summaryResult[0] ?? {
        total: 0, chaosInjected: 0, realErrors: 0, clientErrors: 0, allErrors: 0, latencies: [],
    };

    const { total, chaosInjected, realErrors, clientErrors, allErrors, latencies } = summary;

    // p95 latency — sort the latencies array and pick the 95th percentile
    let p95Latency = 0;
    if (latencies.length > 0) {
        latencies.sort((a, b) => a - b);
        const idx = Math.floor(latencies.length * 0.95);
        p95Latency = latencies[Math.min(idx, latencies.length - 1)] ?? 0;
    }

    const errorRate     = total > 0 ? parseFloat(((allErrors / total) * 100).toFixed(1)) : 0;
    const chaosHitRate  = total > 0 ? parseFloat(((chaosInjected / total) * 100).toFixed(1)) : 0;

    // ── Post-process traffic buckets ──────────────────────────────
    // Fill in empty buckets so the chart always has the right shape
    const bucketMap = new Map(bucketResult.map((b) => [b._id, b]));
    const now = Date.now();
    const trafficBuckets = [];
    for (let i = buckets - 1; i >= 0; i--) {
        const ts = new Date(now - i * stepMs);
        const key = range === "24h"
            ? ts.toISOString().slice(0, 13) + ":00"
            : ts.toISOString().slice(0, 10);
        const entry = bucketMap.get(key) ?? { successful: 0, errors: 0, injected: 0 };
        // Label every ~6th bucket for 24h (every 6h), or every 7th for 30d
        const shouldLabel = range === "24h"
            ? i % 6 === 0
            : (range === "7d" ? true : i % 7 === 0);
        trafficBuckets.push({
            bucket: key,
            label:  shouldLabel ? (range === "24h" ? `${ts.getUTCHours().toString().padStart(2, "0")}:00` : key.slice(5)) : undefined,
            successful: entry.successful,
            errors:     entry.errors,
            injected:   entry.injected,
        });
    }

    // ── Post-process busiest endpoints ────────────────────────────
    const busiestEndpoints = endpointResult.map((e) => ({
        endpointId: e._id.endpointId,
        method:     e._id.method,
        path:       e._id.path,
        requests:   e.requests,
        errorRate:  e.requests > 0 ? parseFloat(((e.errors / e.requests) * 100).toFixed(1)) : 0,
    }));

    return {
        totalRequests: total,
        errorRate,
        p95Latency:    Math.round(p95Latency),
        chaosHitRate,
        chaosInjected,
        realErrors,
        clientErrors,
        trafficBuckets,
        busiestEndpoints,
    };
}
