import mongoose, { Schema } from "mongoose";

const projectSchema = new Schema(
  {
    userId : {
      type : Schema.Types.ObjectId,
      ref : "User",
      required : true
    },
    projectName: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
  },
  { timestamps: true }
);

export const Project = mongoose.model("Project", projectSchema);