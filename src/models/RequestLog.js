import mongoose from "mongoose";

const requestLogSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    endpointId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Endpoint",
      default: null,
    },

    method:       { type: String, required: true },
    path:         { type: String, required: true },
    statusCode:   { type: Number, required: true },
    responseTime: { type: Number, required: true }, // ms

    chaosApplied: { type: Boolean, default: false },
    chaosRules:   [{ type: String }], // e.g. ["delay", "error"]

    timestamp: { type: Date, default: Date.now },
  },
  {
    // MongoDB 5+ native time-series collection:
    //   - Columnar storage — much cheaper than a normal collection for append-only data
    //   - Built-in TTL via expireAfterSeconds — no separate TTL index needed
    //   - NOTE: timeseries collections do NOT support secondary indexes declared
    //     in the schema, so we rely on the implicit time + meta indexes.
    timeseries: {
      timeField: "timestamp",
      metaField: "projectId",
      granularity: "seconds",
    },
    expireAfterSeconds: 30 * 24 * 60 * 60, // auto-drop docs older than 30 days
  }
);

export default mongoose.model("RequestLog", requestLogSchema, "requestLogs");
