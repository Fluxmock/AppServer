import { Router } from "express";
import {
    signupUser,
    loginUser,
    getCurrentUser,
    updateProfile,
    updatePassword,
    logoutUser,
} from "./auth.controller.js";
import { upload } from "../../middlewares/multer.middleware.js";
import { verifyJWT } from "../../middlewares/auth.middleware.js";

const router = Router();

router.post("/register", upload.fields([{ name: "avatar", maxCount: 1 }]), signupUser);
router.post("/login", loginUser);
router.get("/me", verifyJWT, getCurrentUser);
router.patch("/profile", verifyJWT, upload.fields([{ name: "avatar", maxCount: 1 }]), updateProfile);
router.patch("/password", verifyJWT, updatePassword);
router.post("/logout", verifyJWT, logoutUser);

export default router;
