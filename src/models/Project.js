import mongoose, { Schema } from "mongoose";

const projectSchema = new Schema(
  {
    projectName: {
      type: String,
      required: true,
      trim: true,
    },
    chaosRules: [
      {
        type: Schema.Types.ObjectId,
        ref: "ChaosRule",
      },
    ],
    projectRoutes: [
      {
        type: Schema.Types.ObjectId,
        ref: "Endpoint",
      },
    ],
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
  },
  { timestamps: true }
);

export const Project = mongoose.model("Project", projectSchema);