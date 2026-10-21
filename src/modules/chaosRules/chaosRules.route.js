// routes/chaosRules.routes.js
import { Router } from "express";
import { verifyJWT } from "../../middlewares/auth.middleware.js";
import {
  createChaos,
  updateChaos,
  deleteChaos,
  activateChaos,
  deactivateChaos,
  upsertRule,
  getChaosRules,
  getAllProjectChaosRules,
} from "./chaosRules.controller.js";

// mergeParams lets this pick up :projectId / :endpointId from wherever it's mounted
const router = Router({ mergeParams: true });

// get ALL rule sets for a project in one shot (must be before /:projectId/:endpointId)
router.get("/:projectId/all", verifyJWT, getAllProjectChaosRules);

// get all rules for a scope
router.get("/:projectId", verifyJWT, getChaosRules);
router.get("/:projectId/:endpointId", verifyJWT, getChaosRules);

// idempotent upsert — replaces if exists, creates if not
router.put("/:projectId/rule", verifyJWT, upsertRule);
router.put("/:projectId/:endpointId/rule", verifyJWT, upsertRule);

// partial update — 404 if the rule doesn't exist yet6aaafbe0376930d9b2172928
router.patch("/:projectId/rule/:ruleType", verifyJWT, updateChaos);
router.patch("/:projectId/:endpointId/rule/:ruleType", verifyJWT, updateChaos);

// delete single rule
router.delete("/:projectId/rule/:ruleType", verifyJWT, deleteChaos);
router.delete("/:projectId/:endpointId/rule/:ruleType", verifyJWT, deleteChaos);

// activate / deactivate single rule
router.patch("/:projectId/rule/:ruleType/activate", verifyJWT, activateChaos);
router.patch("/:projectId/:endpointId/rule/:ruleType/activate", verifyJWT, activateChaos);
router.patch("/:projectId/rule/:ruleType/deactivate", verifyJWT, deactivateChaos);
router.patch("/:projectId/:endpointId/rule/:ruleType/deactivate", verifyJWT, deactivateChaos);

export default router;