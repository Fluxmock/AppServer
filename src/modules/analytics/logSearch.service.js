import mongoose from "mongoose";
import RequestLog from "../../models/RequestLog.js";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function getTimeRangeStart(range) {
  const ms = range === "7d" ? 7 * 86400_000 : range === "30d" ? 30 * 86400_000 : 86400_000;
  return new Date(Date.now() - ms);
}

function getBucketSize(range) {
  return range === "7d" ? 6 * 3600_000 : range === "30d" ? 86400_000 : 3600_000;
}

function formatCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Convert a chaosRules string array → human-readable chaos type label.
 * Rules are stored as the chaos rule NAME strings (e.g. "Checkout 500s", "delay").
 * We infer the type from keywords in the rule name or from chaosApplied flag.
 *
 * Returns one of: "Error" | "Latency" | "Auth" | "None"
 */
function inferChaosType(chaosApplied, chaosRules = []) {
  if (!chaosApplied) return "None";
  const joined = (chaosRules || []).join(" ").toLowerCase();
  if (/auth|401|403|unauthorized|forbidden/.test(joined)) return "Auth";
  if (/delay|latency|slow|timeout/.test(joined))           return "Latency";
  return "Error"; // default for any other injected chaos
}

/**
 * Aggregation stage that adds a derived `chaosType` field so we can
 * filter and group by it even though it's not stored on the document.
 *
 * MongoDB $switch evaluates conditions in order.
 */
const ADD_CHAOS_TYPE_STAGE = {
  $addFields: {
    chaosType: {
      $switch: {
        branches: [
          // Not chaos at all → "None"
          { case: { $eq: ["$chaosApplied", false] }, then: "None" },
          // Auth keywords in any rule name
          {
            case: {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: { $ifNull: ["$chaosRules", []] },
                      as: "r",
                      cond: {
                        $regexMatch: {
                          input: { $toLower: "$$r" },
                          regex: "auth|401|403|unauthorized|forbidden",
                        },
                      },
                    },
                  },
                },
                0,
              ],
            },
            then: "Auth",
          },
          // Latency keywords
          {
            case: {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: { $ifNull: ["$chaosRules", []] },
                      as: "r",
                      cond: {
                        $regexMatch: {
                          input: { $toLower: "$$r" },
                          regex: "delay|latency|slow|timeout",
                        },
                      },
                    },
                  },
                },
                0,
              ],
            },
            then: "Latency",
          },
        ],
        // Everything else that has chaosApplied:true → Error
        default: "Error",
      },
    },
    // Normalise status field name (schema stores it as statusCode)
    status: "$statusCode",
    // mode is not yet stored; default to "Passthrough" for real requests
    mode: { $ifNull: ["$mode", "Passthrough"] },
  },
};

// ─────────────────────────────────────────────────────────────
// Query string parser
// Supports: status:5xx  status:500  chaos.type:error
//           path:/api/*  method:POST
// ─────────────────────────────────────────────────────────────
function parseQuery(queryString) {
  const filter = {};
  if (!queryString?.trim()) return filter;

  queryString.split(/\s+AND\s+/i).forEach((part) => {
    part = part.trim();

    if (/^status:(\d)xx$/i.test(part)) {
      const prefix = parseInt(part.match(/(\d)xx/i)[1]);
      // Use the real schema field statusCode
      filter.statusCode = { $gte: prefix * 100, $lt: (prefix + 1) * 100 };
    } else if (/^status:(\d{3})$/i.test(part)) {
      filter.statusCode = parseInt(part.match(/(\d{3})/)[1]);
    } else if (/^chaos\.type:(\w+)$/i.test(part)) {
      // handled as a post-$addFields filter — stored separately
      filter._chaosTypeQuery = part.match(/chaos\.type:(\w+)/i)[1];
    } else if (/^path:([^\s]+)$/i.test(part)) {
      const raw = part.match(/path:([^\s]+)/i)[1];
      filter.path = new RegExp("^" + raw.replace(/\*/g, ".*"), "i");
    } else if (/^method:(\w+)$/i.test(part)) {
      filter.method = part.match(/method:(\w+)/i)[1].toUpperCase();
    }
  });

  return filter;
}

// ─────────────────────────────────────────────────────────────
// Main exports
// ─────────────────────────────────────────────────────────────

/**
 * Search request logs with filters and pagination.
 */
export async function searchLogs(projectId, options = {}) {
  const {
    query      = "",
    statusCodes = [],
    chaosTypes  = [],
    modes       = [],
    range       = "24h",
    limit       = 100,
    offset      = 0,
  } = options;

  const projectObjectId = new mongoose.Types.ObjectId(projectId);
  const parsedQuery = parseQuery(query);
  const chaosTypeFromQuery = parsedQuery._chaosTypeQuery;
  delete parsedQuery._chaosTypeQuery;

  // Base $match — uses real stored field names only
  const baseMatch = {
    projectId: projectObjectId,
    timestamp: { $gte: getTimeRangeStart(range) },
    ...parsedQuery,
  };

  // statusCodes filter — real field is statusCode
  if (statusCodes.length > 0) {
    baseMatch.statusCode = { $in: statusCodes.map(Number) };
  }
  // chaosApplied quick-filter: if user asked only for chaos types
  // (not "None") we can pre-filter before the expensive $addFields
  const onlyNone    = chaosTypes.length > 0 && chaosTypes.every((t) => t === "None");
  const hasRealChaos = chaosTypes.some((t) => t !== "None");
  if (onlyNone)     baseMatch.chaosApplied = false;
  if (hasRealChaos && !chaosTypes.includes("None")) baseMatch.chaosApplied = true;

  const pipeline = [
    { $match: baseMatch },
    ADD_CHAOS_TYPE_STAGE,
  ];

  // Post-addFields filters (need derived fields)
  const postMatch = {};
  if (chaosTypeFromQuery) {
    postMatch.chaosType = new RegExp(chaosTypeFromQuery, "i");
  }
  if (chaosTypes.length > 0) {
    postMatch.chaosType = { $in: chaosTypes };
  }
  if (modes.length > 0) {
    postMatch.mode = { $in: modes };
  }
  if (Object.keys(postMatch).length > 0) {
    pipeline.push({ $match: postMatch });
  }

  // Sort + paginate
  pipeline.push({ $sort: { timestamp: -1 } });

  // Run count and page in parallel
  const [countResult, logs] = await Promise.all([
    RequestLog.aggregate([...pipeline, { $count: "total" }]),
    RequestLog.aggregate([...pipeline, { $skip: offset }, { $limit: limit }]),
  ]);

  return {
    logs,
    total: countResult[0]?.total ?? 0,
    limit,
    offset,
  };
}

/**
 * Return filter sidebar options with counts (Status, Chaos type, Mode).
 */
export async function getFilterOptions(projectId, range = "24h") {
  const projectObjectId = new mongoose.Types.ObjectId(projectId);

  const baseMatch = {
    projectId: projectObjectId,
    timestamp: { $gte: getTimeRangeStart(range) },
  };

  const [statusAgg, chaosTypeAgg, modeAgg] = await Promise.all([
    // Status — group by real statusCode field
    RequestLog.aggregate([
      { $match: baseMatch },
      { $group: { _id: "$statusCode", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),

    // Chaos type — derive with $addFields then group
    RequestLog.aggregate([
      { $match: baseMatch },
      ADD_CHAOS_TYPE_STAGE,
      { $group: { _id: "$chaosType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),

    // Mode — derive with $addFields then group
    RequestLog.aggregate([
      { $match: baseMatch },
      ADD_CHAOS_TYPE_STAGE,
      { $group: { _id: "$mode", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  return {
    status: statusAgg.map((item) => ({
      value: String(item._id),
      count: item.count,
      label: `${item._id} (${formatCount(item.count)})`,
    })),
    chaosType: chaosTypeAgg.map((item) => ({
      value: item._id,
      count: item.count,
      label: `${item._id} (${formatCount(item.count)})`,
    })),
    mode: modeAgg.map((item) => ({
      value: item._id,
      count: item.count,
      label: `${item._id} (${formatCount(item.count)})`,
    })),
  };
}

/**
 * Return histogram buckets (count per time bucket) for matching logs.
 */
export async function getLogHistogram(projectId, options = {}) {
  const {
    query      = "",
    statusCodes = [],
    chaosTypes  = [],
    modes       = [],
    range       = "24h",
  } = options;

  const projectObjectId = new mongoose.Types.ObjectId(projectId);
  const parsedQuery = parseQuery(query);
  const chaosTypeFromQuery = parsedQuery._chaosTypeQuery;
  delete parsedQuery._chaosTypeQuery;

  const baseMatch = {
    projectId: projectObjectId,
    timestamp: { $gte: getTimeRangeStart(range) },
    ...parsedQuery,
  };

  if (statusCodes.length > 0) {
    baseMatch.statusCode = { $in: statusCodes.map(Number) };
  }
  const onlyNone    = chaosTypes.length > 0 && chaosTypes.every((t) => t === "None");
  const hasRealChaos = chaosTypes.some((t) => t !== "None");
  if (onlyNone)     baseMatch.chaosApplied = false;
  if (hasRealChaos && !chaosTypes.includes("None")) baseMatch.chaosApplied = true;

  const pipeline = [{ $match: baseMatch }, ADD_CHAOS_TYPE_STAGE];

  const postMatch = {};
  if (chaosTypeFromQuery) postMatch.chaosType = new RegExp(chaosTypeFromQuery, "i");
  if (chaosTypes.length > 0) postMatch.chaosType = { $in: chaosTypes };
  if (modes.length > 0)      postMatch.mode     = { $in: modes };
  if (Object.keys(postMatch).length > 0) pipeline.push({ $match: postMatch });

  const bucketSize = getBucketSize(range);
  pipeline.push(
    {
      $group: {
        _id: {
          $toDate: {
            $subtract: [
              { $toLong: "$timestamp" },
              { $mod: [{ $toLong: "$timestamp" }, bucketSize] },
            ],
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } }
  );

  const rawBuckets = await RequestLog.aggregate(pipeline);

  // Gap-fill
  const startTime = getTimeRangeStart(range).getTime();
  const now       = Date.now();
  const buckets   = [];

  for (let t = startTime; t <= now; t += bucketSize) {
    const ts  = new Date(t);
    const hit = rawBuckets.find((b) => b._id.getTime() === ts.getTime());
    buckets.push({ timestamp: ts, count: hit ? hit.count : 0 });
  }

  return {
    buckets,
    total: rawBuckets.reduce((s, b) => s + b.count, 0),
  };
}
