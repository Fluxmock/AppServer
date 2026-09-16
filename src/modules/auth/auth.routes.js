import { Router } from "express";
import { signupUser, loginUser } from "./auth.controller.js";
import { upload } from "../../middlewares/multer.middleware.js";

const router = Router();

router.post("/register", upload.fields([{ name: "avatar", maxCount: 1 }]), signupUser);
router.post("/login", loginUser);

export default router;
