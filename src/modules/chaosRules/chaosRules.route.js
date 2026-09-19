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
} from "./chaosRules.controller.js";

// mergeParams lets this pick up :projectId / :endpointId from wherever it's mounted
const router = Router({ mergeParams: true });

// // strict create — 409 if the ruleType already exists in this scope
// router.post("/:projectId/rule", verifyJWT, createChaos);
// router.post("/:projectId/:endpointId/rule", verifyJWT, createChaos);

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