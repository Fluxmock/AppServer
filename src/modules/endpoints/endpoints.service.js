import Endpoint from "../../models/Endpoint.js";
import { Project } from "../../models/Project.js";
import redisClient from "../../config/redis.js";
import ApiError from "../../utils/ApiError.js";
import asyncHandler from "../../utils/asyncHandler.js";

//updateEndpoints
//deleteEndpoints
//activateEndpointd
//deactivateEndpoints
//usePresets in endpoints


const saveEndpointToRedis = async (projectId, endpoint) => {
  const endpointObj = endpoint.toObject ? endpoint.toObject() : endpoint;
  const projectKey = `project:endpoints:${projectId}`;
  const endpointKey = `endpoint:${endpointObj._id}`;

  const cached = await redisClient.get(projectKey);
  let endpoints = [];

  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      endpoints = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      endpoints = [];
    }
  }

  const existingIndex = endpoints.findIndex(
    (item) => String(item._id || item.id) === String(endpointObj._id)
  );

  if (existingIndex >= 0) {
    endpoints[existingIndex] = endpointObj;
  } else {
    endpoints.push(endpointObj);
  }

  await redisClient.set(endpointKey, JSON.stringify(endpointObj));
  await redisClient.set(projectKey, JSON.stringify(endpoints));

  console.log("redis working!")
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

  await saveEndpointToRedis(projectId, endpoint);

  return endpoint;
};

const updateEndpointService = asyncHandler(async(req, res) => {
    //write to both mongodb and redis at the same time

})

export { configureEndpointService };
