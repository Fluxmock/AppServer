import { Router } from "express";
import { verifyJWT } from "../../middlewares/auth.middleware.js";
import { 
    activateEndpoint,
    configureEndpoint, 
    deactivateEndpoint,
    deleteEndpoint, 
    getAllEndpoints,
    updateEndpoint 
} from "./endpoints.controller.js";


const router = Router();

router.route("/:projectId").get(verifyJWT, getAllEndpoints);
router.route("/:projectId/configure").post(verifyJWT, configureEndpoint);
router.route("/:projectId/:endpointId/activate").patch(verifyJWT, activateEndpoint);
router.route("/:projectId/:endpointId/deactivate").patch(verifyJWT, deactivateEndpoint);
router.route("/:projectId/:endpointId/delete").delete(verifyJWT, deleteEndpoint);
router.route("/:projectId/:endpointId").patch(verifyJWT, updateEndpoint);


export default router;