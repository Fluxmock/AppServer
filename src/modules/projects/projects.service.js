import { Project } from "../../models/Project.js"
import { User } from "../../models/User.js";
import ApiError from "../../utils/ApiError.js";

const projectCreateService = async(projectName, userId) => {
    const normalizedName = projectName.trim();
    const existingProject = await Project.findOne({
        userId, 
        projectName: normalizedName
    });

    if(existingProject){
        throw new ApiError(400, "Project with this name already exists");
    }

    const project = await Project.create({
        userId,
        projectName : normalizedName,
        isActive: true
    });

    return {
        _id : project._id,
        projectName : project.projectName,
        isActive: project.isActive
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
    return project;
}

const getAllProjectByUserService = async(userId) =>{
    return await Project.find({ userId }).sort({ createdAt: -1 });
}

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

    return project;
}

export {
    projectCreateService, 
    projectDeleteService,
    getAllProjectByUserService,
    activateProjectService,
    deactivateProjectService
}