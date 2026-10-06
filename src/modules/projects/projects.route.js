import { Router } from "express";
import { verifyJWT } from "../../middlewares/auth.middleware.js";
import { 
    activateProject,
    createProject, 
    deactiavteProject, 
    deleteProject,
    getAllProjects
} from "./projects.controller.js";

const router = Router();

router.route("/create").post(verifyJWT, createProject);
router.route("/delete/:id").delete(verifyJWT, deleteProject);
router.route("/activate/:projectId").patch(verifyJWT, activateProject);
router.route("/deactivate/:projectId").patch(verifyJWT, deactiavteProject);
router.route("/all").get(verifyJWT, getAllProjects);

export default router;