import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import { configureEndpointService } from "./endpoints.service.js";

//configure endpoint
//deleteEndpoint
//getResults of endpoint
//edit endpoint
//emit endpoint --> whenever this is used then the mockserver responds

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

export { configureEndpoint };
