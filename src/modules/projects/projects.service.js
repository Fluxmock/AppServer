import { Project } from "../../models/Project.js"
import { User } from "../../models/User.js";
import ApiError from "../../utils/ApiError.js";
import redisClient from "../../config/redis.js";
import crypto from "crypto";
import Endpoint from "../../models/Endpoint.js";
import { profileEnd } from "console";

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

    // evict from MockServer cache so deleted project stops serving requests immediately
    await redisClient.del(`project:key:${project.projectKey}`);

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

    // invalidate MockServer cache so the change reflects immediately
    await redisClient.del(`project:key:${project.projectKey}`);

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

    // invalidate MockServer cache so the change reflects immediately
    await redisClient.del(`project:key:${project.projectKey}`);

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

    return projects.map((p) => ({
    ...p,
    endpointCount: countMap.get(String(p._id)) ?? 0,
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

export {
    projectCreateService, 
    projectDeleteService,
    // getAllProjectByUserService,
    activateProjectService,
    deactivateProjectService,
    getEndpointCountService,
    getAllActiveProjectService
}