import mongoose from 'mongoose';

const endpointSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    method: {
      type: String,
      required: true,
      uppercase: true,
      enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    },
    path: {
      type: String,
      required: true,
      trim: true,
    },
    statusCode: {
      type: Number,
      default: 200,
    },
    responseHeaders: {
      type: Map,
      of: String,
      default: {},
    },
    responseBodyTemplate: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Enforce uniqueness of method+path within a project (replaces the Postgres unique constraint)
endpointSchema.index({ projectId: 1, method: 1, path: 1 }, { unique: true });

const Endpoint = mongoose.model('Endpoint', endpointSchema);

export default Endpoint;
