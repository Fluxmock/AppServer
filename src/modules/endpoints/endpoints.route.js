import { Router } from "express";
import { verifyJWT } from "../../middlewares/auth.middleware.js";
import requireProjectOwner from "../../middlewares/projectOwner.middleware.js";
import { 
    activateEndpoint,
    configureEndpoint, 
    deactivateEndpoint,
    deleteEndpoint, 
    getAllEndpoints,
    updateEndpoint 
} from "./endpoints.controller.js";


const router = Router();

router.use(verifyJWT);
router.param("projectId", requireProjectOwner);

router.route("/:projectId").get(getAllEndpoints);
router.route("/:projectId/configure").post(configureEndpoint);
router.route("/:projectId/:endpointId/activate").patch(activateEndpoint);
router.route("/:projectId/:endpointId/deactivate").patch(deactivateEndpoint);
router.route("/:projectId/:endpointId/delete").delete(deleteEndpoint);
router.route("/:projectId/:endpointId").patch(updateEndpoint);


export default router;
