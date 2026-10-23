import Endpoint from "../../models/Endpoint.js";
import { Project } from "../../models/Project.js";
import ChaosRuleSet from "../../models/ChaosRule.js";
import ApiError from "../../utils/ApiError.js";
import { invalidateChaosCache, invalidateEndpointCache } from "../../services/runtimeCache.service.js";

//updateEndpoints
//deleteEndpoints
//activateEndpointd
//deactivateEndpoints
//usePresets in endpoints


// Endpoint cache mutations are invalidation-only. Updating an array in Redis
// with read/modify/write loses concurrent writes; MockServer rebuilds the list
// from MongoDB under a version guard on the next request instead.
const synchronizeEndpointCache = (projectId) => invalidateEndpointCache(projectId);

const getAllEndpointsService = async (projectId, userId) => {
  if (!projectId) {
    throw new ApiError(400, "projectId is required");
  }

  const project = await Project.findOne({ _id: projectId, userId });
  if (!project) {
    throw new ApiError(404, "Project not found or not authorized");
  }

  // Always fetch fresh from Mongo so chaosRulesCount is accurate
  const endpoints = await Endpoint.find({ projectId })
    .sort({ createdAt: -1 })
    .lean();

  if (endpoints.length === 0) return [];

  // Get chaos rules counts for all endpoints in one query
  const endpointIds = endpoints.map((e) => e._id);
  const ruleSets = await ChaosRuleSet.find({
    projectId,
    endpointId: { $in: endpointIds },
  }).lean();

  const chaosCountMap = new Map();
  for (const rs of ruleSets) {
    const enabledCount = (rs.rules || []).filter((r) => r.isEnabled).length;
    chaosCountMap.set(String(rs.endpointId), enabledCount);
  }

  const enriched = endpoints.map((ep) => ({
    ...ep,
    chaosRulesCount: chaosCountMap.get(String(ep._id)) ?? 0,
  }));

  return enriched;
};

const configureEndpointService = async ({
  projectId,
  userId,
  method,
  path,
  statusCode = 200,
  responseHeaders = {},
  responseBodyTemplate = {},
  isActive = true,
}) => {
  if (!projectId || !method || !path) {
    throw new ApiError(400, "projectId, method and path are required");
  }

  const normalizedMethod = method.toUpperCase();
  const normalizedPath = path.trim();

  const project = await Project.findOne({
    _id: projectId,
    userId,
  });

  if (!project) {
    throw new ApiError(404, "Project not found or not authorized");
  }

  const existingEndpoint = await Endpoint.findOne({
    projectId,
    method: normalizedMethod,
    path: normalizedPath,
  });

  let endpoint;

  if (existingEndpoint) {
    existingEndpoint.statusCode = statusCode;
    existingEndpoint.responseHeaders = responseHeaders;
    existingEndpoint.responseBodyTemplate = responseBodyTemplate;
    existingEndpoint.isActive = isActive;
    endpoint = await existingEndpoint.save();
  } else {
    endpoint = await Endpoint.create({
      projectId,
      method: normalizedMethod,
      path: normalizedPath,
      statusCode,
      responseHeaders,
      responseBodyTemplate,
      isActive,
    });
  }

  await synchronizeEndpointCache(projectId);

  return endpoint;
};

const filterUpdatedEndpointFields = (existingEndpoint, payload = {}) => {
  const allowedFields = [
    "method",
    "path",
    "statusCode",
    "responseHeaders",
    "responseBodyTemplate",
    "isActive",
  ];

  const updatePayload = {};

  for (const field of allowedFields) {
    //loop through all allowed fields that can be updated
    if (payload[field] === undefined) continue; //ignore fields that werent send

    const currentValue = existingEndpoint[field]; //get old value
    const nextValue = payload[field]; //get new value
    
    //check if the value is same, object type checking and primitive checking
    const isSameValue =
      typeof nextValue === "object" && nextValue !== null
        ? JSON.stringify(nextValue) === JSON.stringify(currentValue ?? {})
        : nextValue === currentValue;

    if (!isSameValue) {
      //normalize method and path
      updatePayload[field] = field === "method" && typeof nextValue === "string"
        ? nextValue.toUpperCase()
        : field === "path" && typeof nextValue === "string"
          ? nextValue.trim()
          : nextValue;
    }
  }

  return updatePayload; //pass only updated field
};

const updateEndpointService = async ({
  projectId,
  userId,
  endpointId,
  payload = {},
}) => {
  if (!projectId || !endpointId) {
    throw new ApiError(400, "projectId and endpointId are required");
  }

  const project = await Project.findOne({
    _id: projectId,
    userId,
  });

  if (!project) {
    throw new ApiError(404, "Project not found or not authorized");
  }

  const existingEndpoint = await Endpoint.findOne({
    _id: endpointId,
    projectId,
  });

  if (!existingEndpoint) {
    throw new ApiError(404, "Endpoint not found");
  }

  const updatePayload = filterUpdatedEndpointFields(existingEndpoint.toObject(), payload);

  //when nothing has changed
  if (Object.keys(updatePayload).length === 0) {
    return existingEndpoint;
  }

  const updatedEndpoint = await Endpoint.findByIdAndUpdate(
    endpointId,
    { $set: updatePayload },
    { new: true, runValidators: true }
  );

  if (!updatedEndpoint) {
    throw new ApiError(500, "Failed to update endpoint");
  }

  await synchronizeEndpointCache(projectId);

  return updatedEndpoint;
};

const deleteEndpointService = async(projectId, endpointId) => {
   const endpoint = await Endpoint.findOneAndDelete({
    _id : endpointId,
    projectId
   });

   if(!endpoint){
    throw new ApiError("404", "Endpoint not found or not authorized!");
   }

   await ChaosRuleSet.deleteMany({ projectId, endpointId });
   await synchronizeEndpointCache(projectId);
   await invalidateChaosCache(projectId, endpointId);

   return endpoint
}

const activateEndpointService = async(projectId, endpointId) => {
     const endpoint = await Endpoint.findOneAndUpdate(
      {_id : endpointId, projectId},
      {$set : {isActive : true}},
      {new : true}
     )

     if(!endpoint){
      throw new ApiError(404, "Endpoint not found or not authorized!");
     }

     await synchronizeEndpointCache(projectId);

     return endpoint;
}

const deactivateEndpointService = async(projectId, endpointId) => {
     const endpoint = await Endpoint.findOneAndUpdate(
      {_id : endpointId, projectId},
      {$set : {isActive : false}},
      {new : true}
     )

     if(!endpoint){
      throw new ApiError(404, "Endpoint not found or not authorized!");
     }

     await synchronizeEndpointCache(projectId);

     return endpoint;
}

export { 
  configureEndpointService, 
  updateEndpointService,
  deleteEndpointService,
  activateEndpointService,
  deactivateEndpointService,
  getAllEndpointsService
 };
