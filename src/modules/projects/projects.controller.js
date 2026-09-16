import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import { Project } from "../../models/Project.js";
import { 
    projectCreateService, 
    projectDeleteService,
    getAllProjectByUserService,
    activateProjectService,
    deactivateProjectService 
} from "./projects.service.js";

//create project
//delete project
//getProjectROutes
//activate project
//deactivate project

const createProject = asyncHandler(async (req, res) => {
   const {projectName} = req.body;
   const userId = req.user._id;

   if(!userId){
    throw new ApiError(400, "user not found!");
   }
   
   const createProject = await projectCreateService(projectName, userId);

   if(!createProject){
    throw new ApiError(500, "Error creating new project");
   }

   return res.status(201).json(
    new ApiResponse(200, createProject, "Project created successfully!")
   )
});

const deleteProject = asyncHandler(async (req, res) => {
    const {id} = req.params;
    const userId = req.user._id;
    if(!id){
        throw new ApiError(400,"project not found!");
    }
    const deletedProject = await projectDeleteService(id, userId);
     
    return res.status(200).json(
        new ApiResponse(200,deletedProject, "Project deleted successfully!")
    )
});

const getAllProjects = asyncHandler(async(req, res) => {
    const userId = req.user._id;
    if(!userId){
        throw new ApiError("no user found");
    }
    const projects = await getAllProjectByUserService(userId);

    return res.status(200).json(
        new ApiResponse(200, projects, "Projects fetched successfully")
    )
});

const activateProject = asyncHandler(async (req, res) => {
    const {projectId} = req.params;
    const userId = req.user._id;
    if(!projectId){
        throw new ApiError(400,"Project ID is required!");
    }

    const project = await activateProjectService(projectId, userId);
//     Where to emit Socket.IO
// The Socket.IO event should be emitted from the realtime layer, not from the DB service.

// A clean pattern is:

// AppServer service updates project row
// AppServer controller calls a realtime helper
// realtime helper emits to MockServer or uses a pub/sub channel
// MockServer socket server listens and emits to room project:<projectId>
// This keeps the business logic unaffected by transport details.

// Simple event flow
// HTTP request hits controller
// controller calls service
// service updates isActive = true
// controller triggers realtime event
// socket room receives event
// frontend receives live update

    //realtime notification
    //emitProjectActivated(project) --> mockserver
    return res.status(200)
              .json(new ApiResponse(200, project, "Project Activated Succesfully!"))
    
});

const deactiavteProject = asyncHandler(async (req, res) => {
    const {projectId} = req.params;
    const userId = req.user._id;

    if(!projectId){
        throw new ApiError(400,"ProjectId is required");
    }

    const project = await deactivateProjectService(projectId, userId);
    //all of this to be added in service not here
    //same deactivating logic as activating
    //remove the socket room for this project 
    //stop accepting the request from this project in the mockserver
    //remove all the logs of this project
    return res.status(200).json(new ApiResponse(200, project, "Project deactivated successfully!"));
});

export {
    createProject, 
    deleteProject,
    getAllProjects,
    activateProject,
    deactiavteProject
}