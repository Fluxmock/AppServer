import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import { 
  configureEndpointService, 
  updateEndpointService,
  deleteEndpointService,
  activateEndpointService,
  deactivateEndpointService,
  getAllEndpointsService
 } from "./endpoints.service.js";

//configure endpoint
//deleteEndpoint
//getAll endpoints
//edit endpoint
//activate ednpoint
//deactivate endpoint

//for the project rules in MVP we are keeping the chaos to the project level --> further we will add hierarchieal chaos to 
//endpoint level where the endpoint level chaos overrides the project level chaos

const configureEndpoint = asyncHandler(async (req, res) => {
  const { method, path, statusCode, responseHeaders, responseBodyTemplate, isActive } = req.body;
  const { projectId } = req.params;

  if (!projectId || !method || !path) {
    throw new ApiError(400, "Endpoint not configured properly!");
  }

  const endpoint = await configureEndpointService({
    projectId,
    userId: req.user._id,
    method,
    path,
    statusCode,
    responseHeaders,
    responseBodyTemplate,
    isActive,
  });

  return res.status(200).json(
    new ApiResponse(200, endpoint, "Endpoint configured successfully")
  );
});

const updateEndpoint = asyncHandler(async (req, res) => {
  const { projectId, endpointId } = req.params;
  const payload = req.body || {};

  if (!projectId || !endpointId) {
    throw new ApiError(400, "projectId and endpointId are required");
  }

  const endpoint = await updateEndpointService({
    projectId,
    userId: req.user._id,
    endpointId,
    payload,
  });

  return res.status(200).json(
    new ApiResponse(200, endpoint, "Endpoint updated successfully")
  );
});

const deleteEndpoint = asyncHandler(async(req, res) => {
  const {projectId, endpointId} = req.params;

  if(!projectId || !endpointId){
    throw new ApiError(400, "project or endpoint not found");
  }

  const deletedEndpoint = await deleteEndpointService(projectId, endpointId);
  
  return res.status(200)
    .json(new ApiResponse(200, deletedEndpoint, "Endpoint deleted successfully!"));

});

const activateEndpoint = asyncHandler(async(req, res) => {
    const {projectId, endpointId} = req.params;

    if(!projectId || !endpointId){
      throw new ApiError(404, "project or endpoint not found");
    }

    const endpoint = await activateEndpointService(projectId, endpointId);

    return res.status(200).json(
      new ApiResponse(200, endpoint, "endpoint activated successfully!")
    )
});

const deactivateEndpoint = asyncHandler(async(req, res) => {
    const {projectId, endpointId} = req.params;

    if(!projectId || !endpointId){
      throw new ApiError(404, "project or endpoint not found");
    }

    const endpoint = await deactivateEndpointService(projectId, endpointId);

    return res.status(200).json(
      new ApiResponse(200, endpoint, "endpoint deactivated successfully!")
    )
});

const getAllEndpoints = asyncHandler(async (req, res) => {
   const { projectId } = req.params;

   if (!projectId) {
    throw new ApiError(400, "projectId is required!");
   }

   const endpoints = await getAllEndpointsService(projectId, req.user._id);

   return res.status(200).json(
     new ApiResponse(200, endpoints, "Endpoints fetched successfully")
   );
});

export { 
  configureEndpoint, 
  updateEndpoint,
  deleteEndpoint,
  activateEndpoint,
  deactivateEndpoint,
  getAllEndpoints
};
