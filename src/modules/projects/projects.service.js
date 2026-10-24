import { Project } from "../../models/Project.js"
import { User } from "../../models/User.js";
import ApiError from "../../utils/ApiError.js";
import redisClient from "../../config/redis.js";
import crypto from "crypto";
import Endpoint from "../../models/Endpoint.js";
import ChaosRuleSet from "../../models/ChaosRule.js";
import { invalidateProjectCache, removeProjectRuntimeCaches } from "../../services/runtimeCache.service.js";

const generateProjectKey = () => {
  return "pk_" + crypto.randomBytes(16).toString("hex");
};

const projectCreateService = async(projectName, userId) => {
    const normalizedName = projectName.trim();
    const existingProject = await Project.findOne({
        userId, 
        projectName: normalizedName
    });

    if(existingProject){
        throw new ApiError(400, "Project with this name already exists");
    }

    const projectKey = generateProjectKey();

    const project = await Project.create({
        userId,
        projectName : normalizedName,
        isActive: true,
        projectKey,
    });

    return {
        _id : project._id,
        projectName : project.projectName,
        isActive: project.isActive,
        projectKey: project.projectKey,
    }
}

const projectDeleteService = async(projectId, userId) => {
    const project = await Project.findOneAndDelete({
        _id: projectId,
        userId
    });
    if(!project){
        throw new ApiError(404, "Project not found or not authorized");
    }

    // Endpoint and chaos documents are private configuration owned by this
    // project. Capture endpoint ids before deleting them so their scoped cache
    // keys can be removed without unsafe key scanning.
    const endpoints = await Endpoint.find({ projectId: project._id }, "_id").lean();
    const endpointIds = endpoints.map((endpoint) => String(endpoint._id));

    // Idempotent cache cleanup is retried by the cache service if Redis is
    // unavailable. Project-key removal happens after the durable deletion.
    await removeProjectRuntimeCaches(String(project._id), [project.projectKey], endpointIds);

    await Promise.all([
        Endpoint.deleteMany({ projectId: project._id }),
        ChaosRuleSet.deleteMany({ projectId: project._id }),
    ]);

    return project;
}
//same as the getAllProjects by user with the endpoint count
// const getAllProjectByUserService = async(userId) =>{
//     return await Project.find({ userId }).sort({ createdAt: -1 });
// }

const activateProjectService = async(projectId, userId) => {
    const project = await Project.findOne({
        _id : projectId,
        userId
    });

    if(!project){
        throw new ApiError(404, "Project not found or not authorized");
    }

    if(project.isActive){
        return project;
    }

    project.isActive = true;
    await project.save();

    await invalidateProjectCache(String(project._id), [project.projectKey]);

    return project;
}

const deactivateProjectService = async(projectId, userId)=>{
    const project = await Project.findOne({
        _id : projectId,
        userId
    });

    if(!project){
        throw new ApiError(404, "project not found");
    }

    if(!project.isActive) return project;

    project.isActive = false;
    await project.save();

    await invalidateProjectCache(String(project._id), [project.projectKey]);

    return project;
}

const getEndpointCountService = async(userId) => {
    if(!userId) throw new ApiError(400, "userId is required!");

    const projects = await Project.find({userId}).lean();
    const ids = projects.map((p) => p._id);

    const counts = await Endpoint.aggregate([
        {
            $match : {
                projectId : {$in : ids}
            }
        },
        {
            $group : {
                _id : "$projectId",
                count: {
                    $sum : 1
                }
            }
        },
    ]);

    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

    const since = Date.now() - (24 * 60 * 60 * 1000);
    const requestCounts = await Promise.all(
        projects.map(async (project) => {
            try {
                return await redisClient.zcount(
                    `project:${project._id}:request-events:24h`,
                    since,
                    "+inf"
                );
            } catch (error) {
                console.error("Failed to fetch project request count from Redis:", error);
                return 0;
            }
        })
    );

    return projects.map((p, index) => ({
        ...p,
        endpointCount: countMap.get(String(p._id)) ?? 0,
        requestsToday: requestCounts[index] ?? 0,
    }));
};

const getAllActiveProjectService = async(userId) => {
    if(!userId) throw new ApiError(400, "userId required!");

    const projects = await Project.find({ userId, isActive: true })
        .sort({ createdAt: -1 })
        .lean();

    const ids = projects.map((p) => p._id);

    const counts = await Endpoint.aggregate([
        { $match: { projectId: { $in: ids } } },
        { $group: { _id: "$projectId", count: { $sum: 1 } } },
    ]);

    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

    return projects.map((p) => ({
        ...p,
        endpointCount: countMap.get(String(p._id)) ?? 0,
    }));
}

const getProjectByIdService = async(projectId, userId) => {
    if(!projectId) throw new ApiError(400, "projectId required!");
    if(!userId) throw new ApiError(400, "userId required!");

    const project = await Project.findOne({
        _id: projectId,
        userId
    }).lean();

    if(!project) {
        throw new ApiError(404, "Project not found or not authorized");
    }

    // Get endpoint count for this project
    const endpointCount = await Endpoint.countDocuments({ projectId: project._id });

    // Get chaos rules stats
    const chaosRuleSets = await ChaosRuleSet.find({ projectId: project._id }).lean();
    
    let totalRules = 0;
    let totalProbability = 0;
    let enabledRulesCount = 0;

    chaosRuleSets.forEach(ruleSet => {
        if (ruleSet.rules && Array.isArray(ruleSet.rules)) {
            ruleSet.rules.forEach(rule => {
                totalRules++;
                if (rule.isEnabled) {
                    enabledRulesCount++;
                    totalProbability += (rule.probability || 0);
                }
            });
        }
    });

    const averageProbability = enabledRulesCount > 0 
        ? (totalProbability / enabledRulesCount) 
        : 0;

    // MockServer writes one unique event per resolved endpoint request. A
    // sorted set lets this remain an exact rolling 24-hour number rather than
    // a counter that resets 24 hours after its first request.
    let requestsToday = 0;
    try {
        const since = Date.now() - (24 * 60 * 60 * 1000);
        requestsToday = await redisClient.zcount(
            `project:${projectId}:request-events:24h`,
            since,
            "+inf"
        );
    } catch (err) {
        console.error("Failed to fetch request count from Redis:", err);
    }

    return {
        ...project,
        endpointCount,
        chaosRulesCount: totalRules,
        averageProbability: Math.round(averageProbability * 100) / 100, // round to 2 decimals
        requestsToday
    };
}

export {
    projectCreateService, 
    projectDeleteService,
    // getAllProjectByUserService,
    activateProjectService,
    deactivateProjectService,
    getEndpointCountService,
    getAllActiveProjectService,
    getProjectByIdService
}
