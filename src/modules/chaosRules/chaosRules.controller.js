import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
//configure chaos for a 

import { 
    upsertRuleService,
    createChaosService,
    updateChaosService,
    deleteChaosService,
    activateChaosService,
    deactivateChaosService
} from "./chaosRules.service.js";

const resolveEndpointId = (req) => {
   return req.params.endpointId ?? null;
}

const createChaos = asyncHandler(async (req, res) => {
     
    const { projectId } = req.params;
    const endpointId = resolveEndpointId(req);
    const { ruleType, probability, config, isEnabled } = req.body;

    if (!projectId) throw new ApiError(400, "projectId is required");
    if (!ruleType || typeof ruleType !== "string") throw new ApiError(400, "ruleType is required and must be a string");
    if (probability !== undefined && (typeof probability !== "number" || probability < 0 || probability > 1)) {
        throw new ApiError(400, "probability must be a number between 0 and 1");
    }
    if (isEnabled !== undefined && typeof isEnabled !== "boolean") {
        throw new ApiError(400, "isEnabled must be a boolean");
    }
    if (config !== undefined && (typeof config !== "object" || Array.isArray(config))) {
        throw new ApiError(400, "config must be an object");
    }

    const rule = await createChaosService({ projectId, endpointId, ruleType, probability, config, isEnabled });
    res.status(201).json(new ApiResponse(201, rule, "Chaos created successfully!"));
 
});

const upsertRule = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const endpointId = resolveEndpointId(req);
    const { ruleType, probability, config, isEnabled } = req.body || {};

    if (!projectId) throw new ApiError(400, "projectId is required");
    if (!ruleType || typeof ruleType !== "string") throw new ApiError(400, "ruleType is required and must be a string");
    if (probability !== undefined && (typeof probability !== "number" || probability < 0 || probability > 1)) {
        throw new ApiError(400, "probability must be a number between 0 and 1");
    }
    if (isEnabled !== undefined && typeof isEnabled !== "boolean") {
        throw new ApiError(400, "isEnabled must be a boolean");
    }
    if (config !== undefined && (typeof config !== "object" || Array.isArray(config))) {
        throw new ApiError(400, "config must be an object");
    }

    const doc = await upsertRuleService({ projectId, endpointId, ruleType, probability, config, isEnabled });
    return res.status(200).json(new ApiResponse(200, doc, "Rule upserted successfully"));
});

const updateChaos = asyncHandler(async (req, res) => {
      const { projectId, ruleType } = req.params;
    const endpointId = resolveEndpointId(req);
    const { probability, config, isEnabled } = req.body;

    if (!projectId) throw new ApiError(400, "projectId is required");
    if (!ruleType || typeof ruleType !== "string") throw new ApiError(400, "ruleType is required in params and must be a string");
    if (probability === undefined && config === undefined && isEnabled === undefined) {
        throw new ApiError(400, "at least one of probability, config or isEnabled must be provided");
    }
    if (probability !== undefined && (typeof probability !== "number" || probability < 0 || probability > 1)) {
        throw new ApiError(400, "probability must be a number between 0 and 1");
    }
    if (isEnabled !== undefined && typeof isEnabled !== "boolean") {
        throw new ApiError(400, "isEnabled must be a boolean");
    }
    if (config !== undefined && (typeof config !== "object" || Array.isArray(config))) {
        throw new ApiError(400, "config must be an object");
    }

    const rule = await updateChaosService({ projectId, endpointId, ruleType, probability, config, isEnabled });
    res.status(200).json(new ApiResponse(200, rule, "updated successfully!"));
});

const deleteChaos = asyncHandler(async(req, res) => {
    const { projectId, ruleType } = req.params;
    const endpointId = resolveEndpointId(req);

    if (!projectId) throw new ApiError(400, "projectId is required");
    if (!ruleType || typeof ruleType !== "string") throw new ApiError(400, "ruleType is required in params and must be a string");

    const rule = await deleteChaosService({ projectId, endpointId, ruleType });
    res.status(200).json(new ApiResponse(200, rule, "deleted Successfully!"));
});

const activateChaos = asyncHandler(async(req, res) => {
    const { projectId, ruleType } = req.params;
    const endpointId = resolveEndpointId(req);

    if (!projectId) throw new ApiError(400, "projectId is required");
    if (!ruleType || typeof ruleType !== "string") throw new ApiError(400, "ruleType is required in params and must be a string");

    const rule = await activateChaosService({ projectId, endpointId, ruleType });
    res.status(200).json(new ApiResponse(200, rule, "activated successfully"));
})

const deactivateChaos = asyncHandler(async(req , res) => {
    const { projectId, ruleType } = req.params;
    const endpointId = resolveEndpointId(req);

    if (!projectId) throw new ApiError(400, "projectId is required");
    if (!ruleType || typeof ruleType !== "string") throw new ApiError(400, "ruleType is required in params and must be a string");

    const rule = await deactivateChaosService({ projectId, endpointId, ruleType });
    res.status(200).json(new ApiResponse(200, rule, "deactivated successfully"));
})

export{
    createChaos,
    deactivateChaos,
    deleteChaos,
    updateChaos,
    activateChaos,
    upsertRule
}