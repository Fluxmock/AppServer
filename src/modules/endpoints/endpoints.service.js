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
  //projectId --> which project this endpoint belongs to
  //endpoint --> the endpoint document/object you want to cache
  const endpointObj = endpoint.toObject ? endpoint.toObject() : endpoint;
  //convert mongoose document into a normal javascript object
  const projectKey = `project:endpoints:${projectId}`; //redis key
  const endpointKey = `endpoint:${endpointObj._id}`;
  
  //if it exists i.e the project then it returns the value
  const cached = await redisClient.get(projectKey);
  let endpoints = []; //if the key doesnt exists i.e cached == null
  //so start with new

  if (cached) {
    try {
      const parsed = JSON.parse(cached); //convert redis string back to js
      endpoints = Array.isArray(parsed) ? parsed : []; //the new endpoint is now the normal javascript array
    } catch (error) {
      endpoints = [];
    }
  }
  
  //check whether the endpoint already exists
  //does this endpoint ecists in the project cached endpoint list?
  const existingIndex = endpoints.findIndex(
    (item) => String(item._id || item.id) === String(endpointObj._id)
  );
  //returns the index number is the cached endpoint is found else returns -1

  if (existingIndex >= 0) {
    //when the cached endpoint is found --> during updation
    //update the exsiting endpoint with the new endpoint
    endpoints[existingIndex] = endpointObj;
  } else {
    //push new endpoint in the endpoint array
    endpoints.push(endpointObj);
  }

  //save the individual endpoint
  await redisClient.set(endpointKey, JSON.stringify(endpointObj));
  //save the projects complete endpoint list
  await redisClient.set(projectKey, JSON.stringify(endpoints));

  console.log("redis working!")
};

const deleteEndpointFromRedis = async (projectId, endpointId) => {
   const projectKey = `project:endpoints:${projectId}`;
   const endpointKey = `endpoint:${endpointId}`;

   const cached = await redisClient.get(projectKey);

   if(!cached){
    await redisClient.del(endpointKey);
    return;
   }

   let endpoints = [];
   try{
    endpoints = JSON.parse(cached);
   }catch{
    endpoints = [];
   }

   const filtered = endpoints.filter(
    (item) => String(item._id || item.id) !== String(endpointId)
  );

  await redisClient.del(endpointKey);

  if(filtered.length == 0){
    //idk if we should delete the project if there is no endpoint
    await redisClient.del(projectKey);
    return;
  }

  await redisClient.set(projectKey, JSON.stringify(filtered));

  console.log("endpoint deleted successfully from REDIS!")
};

const toggleEndpointStatusInRedis = async(projectId, endpointId, isActive) => {
   const projectKey = `project:endpoints:${projectId}`;
   const endpointKey = `endpoint:${endpointId}`;

   const cachedProject = await redisClient.get(projectKey);

   if(!cachedProject){
     const cachedEndpoint = await redisClient.get(endpointKey);
     if(cachedEndpoint){
      const endpoint = JSON.parse(cachedEndpoint);
      endpoint.isActive = isActive;
      await redisClient.set(endpointKey, JSON.stringify(endpoint));
     }
     return;
   }

   let endpoints = [];
   try{
    endpoints = JSON.parse(cachedProject);
   }catch{
    endpoints = [];
   }

   const index = endpoints.findIndex(
    (item) => String(item._id || item.id) === String(endpointId)
   );

   if(index >= 0){
    endpoints[index].isActive = isActive;
    await redisClient.set(projectKey, JSON.stringify(endpoints));
   }

   const cachedEndpoint = await redisClient.get(endpointKey);
   if(cachedEndpoint){
    const endpoint = JSON.parse(cachedEndpoint);
    endpoint.isActive = isActive;
    await redisClient.set(endpointKey, JSON.stringify(endpoint));
   }
}

const getAllEndpointsService = async (projectId, userId) => {
  if (!projectId) {
    throw new ApiError(400, "projectId is required");
  }

  const project = await Project.findOne({
    _id: projectId,
    userId,
  });

  if (!project) {
    throw new ApiError(404, "Project not found or not authorized");
  }

  const projectKey = `project:endpoints:${projectId}`;
  const cached = await redisClient.get(projectKey);

  if (cached) {
    try {
      const endpoints = JSON.parse(cached);
      if (Array.isArray(endpoints)) {
        return endpoints;
      }
    } catch (error) {
      // fall through to Mongo
    }
  }

  const endpoints = await Endpoint.find({ projectId }).sort({ createdAt: -1 });

  if (endpoints.length > 0) {
    await redisClient.set(projectKey, JSON.stringify(endpoints));
  }

  return endpoints;
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

  await saveEndpointToRedis(projectId, updatedEndpoint);

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

   if(endpoint){
    await deleteEndpointFromRedis(projectId, endpointId);
   }

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

     await toggleEndpointStatusInRedis(projectId, endpointId, endpoint.isActive);

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

     await toggleEndpointStatusInRedis(projectId, endpointId, endpoint.isActive);

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
