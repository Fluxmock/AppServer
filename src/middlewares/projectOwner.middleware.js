import mongoose from "mongoose";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { Project } from "../models/Project.js";

/**
 * Require the authenticated user to own the project in :projectId.
 *
 * Project-scoped routers use this middleware before their controllers so a
 * project id can never be treated as an authorization credential by itself.
 * A 404 for both a missing and an inaccessible project also avoids exposing
 * whether another user's project exists.
 */
const requireProjectOwner = asyncHandler(async (req, _res, next) => {
  const { projectId } = req.params;
  const userId = req.user?._id;

  if (!mongoose.isObjectIdOrHexString(projectId) || !userId) {
    throw new ApiError(404, "Project not found or not authorized");
  }

  const project = await Project.exists({ _id: projectId, userId });
  if (!project) {
    throw new ApiError(404, "Project not found or not authorized");
  }

  // Controllers/services can reuse this without another ownership query.
  req.project = project;
  next();
});

export default requireProjectOwner;
