import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import { User } from "../../models/User.js";
import { signupUserService, loginUserService } from "./auth.services.js";
import { uploadOnCloudinary } from "../../utils/cloudinary.js";

//signup useer --> local signup
//loginUser --> local login
//googleloginStart --> redirect to google consent screen
//googleLoginCallback --> receive googel profile, find/create user, generate JWT
//loginUser --> refresh token or cookie

const generateAccesAndRefreshToken = async (userId) => {
    try{
        const user = await User.findById(userId);
        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();

        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false });

        return { accessToken, refreshToken };
    } catch (error) {
        throw new ApiError(
            500,
            "something went wrong while creating refresh and access token : auth.controller"
        );
    }
};

const signupUser = asyncHandler(async (req, res) => {
    const { username, email, password } = req.body;
    const uploadedAvatar = req.files?.avatar?.[0];

    if (!username || !email || !password) {
        throw new ApiError(400, "All fields are required");
    }

    let avatarUrl = null;
    if (uploadedAvatar) {
        const uploadResult = await uploadOnCloudinary([uploadedAvatar]);
        avatarUrl = uploadResult?.[0]?.secure_url || null;
    }

    const createdUser = await signupUserService({
        username,
        email,
        password,
        avatar: avatarUrl,
    });

    return res.status(201).json(
        new ApiResponse(201, createdUser, "User created successfully!")
    );
});

const loginUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        throw new ApiError(400, "Email and password are required");
    }

    const result = await loginUserService({ email, password });

    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
    };

    res.cookie("accessToken", result.accessToken, cookieOptions);
    res.cookie("refreshToken", result.refreshToken, cookieOptions);

    return res.status(200).json(
        new ApiResponse(200, {
            user: result.user,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
        }, "User logged in successfully!")
    );
});

export { signupUser, loginUser, generateAccesAndRefreshToken };

//login route
//google login
//edit user creds
//getUser projects
//