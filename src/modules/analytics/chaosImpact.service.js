import mongoose from "mongoose";
import { Project, RequestLog } from "../../models/index.js";
import ApiError from "../../utils/ApiError.js";

const RANGE_MS = { "24h": 86400_000, "7d": 7 * 86400_000, "30d": 30 * 86400_000 };
const TYPE_LABELS = {
    delay: "Latency", error: "Error", authFail: "Auth", payload: "Payload",
    network: "Network", rateLimit: "Rate limit", dataSchema: "Data schema",
    availability: "Availability", consistency: "Consistency",
};

export async function getChaosImpactData(projectId, userId, range = "24h") {
    if (!mongoose.isObjectIdOrHexString(projectId)) throw new ApiError(400, "Invalid projectId");
    if (!Object.hasOwn(RANGE_MS, range)) throw new ApiError(400, "range must be one of: 24h, 7d, 30d");
    // Check ownership before reading any private request analytics.
    const project = await Project.exists({ _id: projectId, userId });
    if (!project) throw new ApiError(404, "Project not found or not authorized");

    const end = new Date();
    const start = new Date(end.getTime() - RANGE_MS[range]);
    const [result] = await RequestLog.aggregate([
        { $match: { projectId: new mongoose.Types.ObjectId(projectId), timestamp: { $gte: start, $lte: end } } },
        // Project only the fields needed by this page. All grouping stays in MongoDB;
        // no request documents or unbounded arrays are returned to the application.
        { $project: {
            endpointId: 1, method: 1, path: 1, chaosApplied: 1,
            rules: { $cond: ["$chaosApplied", { $setUnion: [{ $ifNull: ["$chaosRules", []] }, []] }, []] },
        } },
        { $facet: {
            summary: [
                { $group: {
                    _id: { $ifNull: ["$endpointId", { method: "$method", path: "$path" }] },
                    totalRequests: { $sum: 1 },
                    requestsAffected: { $sum: { $cond: ["$chaosApplied", 1, 0] } },
                    eventsInjected: { $sum: { $size: "$rules" } },
                } },
                { $group: {
                    _id: null,
                    totalRequests: { $sum: "$totalRequests" },
                    requestsAffected: { $sum: "$requestsAffected" },
                    eventsInjected: { $sum: "$eventsInjected" },
                    endpointsAffected: { $sum: { $cond: [{ $gt: ["$requestsAffected", 0] }, 1, 0] } },
                } },
                { $project: { _id: 0 } },
            ],
            failures: [
                { $match: { chaosApplied: true } },
                { $set: { rules: { $cond: [{ $gt: [{ $size: "$rules" }, 0] }, "$rules", ["unknown"]] } } },
                { $unwind: "$rules" },
                { $group: { _id: "$rules", injected: { $sum: 1 } } },
                { $sort: { injected: -1, _id: 1 } },
            ],
        } },
    ]).option({ maxTimeMS: 15_000 });

    const summary = result?.summary[0] ?? {
        totalRequests: 0, requestsAffected: 0, eventsInjected: 0, endpointsAffected: 0,
    };
    return {
        range,
        summary: {
            ...summary, windowStart: start.toISOString(), windowEnd: end.toISOString(),
            chaosHitRate: summary.totalRequests ? Math.round(summary.requestsAffected / summary.totalRequests * 1000) / 10 : 0,
        },
        failures: (result?.failures ?? []).map(({ _id, injected }) => ({
            ruleType: _id, type: TYPE_LABELS[_id] ?? _id, injected,
        })),
        // Request logs contain no browser telemetry. Do not infer client crashes,
        // recovery or actionable frontend diagnoses from server response status.
        clientErrors: null,
        recovery: null,
        fixes: null,
    };
}
