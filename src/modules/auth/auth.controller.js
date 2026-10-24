import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import { User } from "../../models/User.js";
import { signupUserService, loginUserService } from "./auth.services.js";
import { uploadOnCloudinary } from "../../utils/cloudinary.js";

const PASSWORD_REQUIREMENTS = "Password must be at least 8 characters and include an uppercase letter, lowercase letter, number, and special character.";
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email?.trim());
const isStrongPassword = (password) => (
    typeof password === "string" &&
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
);

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
    if (!isValidEmail(email)) {
        throw new ApiError(400, "Enter a valid email address");
    }
    if (!isStrongPassword(password)) {
        throw new ApiError(400, PASSWORD_REQUIREMENTS);
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

    if (!email || !password || !isValidEmail(email)) {
        throw new ApiError(401, "Invalid email or password");
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

const serializeUser = (user) => ({
    _id: user._id,
    username: user.username,
    email: user.email,
    avatar: user.avatar || null,
    authProvider: user.authProvider,
    createdAt: user.createdAt,
});

const getCurrentUser = asyncHandler(async (req, res) => {
    return res.status(200).json(
        new ApiResponse(200, serializeUser(req.user), "User fetched successfully")
    );
});

const updateProfile = asyncHandler(async (req, res) => {
    const username = req.body.username?.trim();
    const uploadedAvatar = req.files?.avatar?.[0];

    if (username !== undefined && !username) {
        throw new ApiError(400, "Username cannot be empty");
    }

    const user = await User.findById(req.user._id);
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    if (username) user.username = username;

    if (uploadedAvatar) {
        const uploadResult = await uploadOnCloudinary([uploadedAvatar]);
        user.avatar = uploadResult?.[0]?.secure_url || user.avatar;
    }

    await user.save({ validateBeforeSave: false });

    return res.status(200).json(
        new ApiResponse(200, serializeUser(user), "Profile updated successfully")
    );
});

const updatePassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        throw new ApiError(400, "Current and new passwords are required");
    }
    if (!isStrongPassword(newPassword)) {
        throw new ApiError(400, PASSWORD_REQUIREMENTS);
    }

    const user = await User.findById(req.user._id);
    if (!user || !(await user.isPasswordCorrect(currentPassword))) {
        throw new ApiError(401, "Current password is incorrect");
    }

    user.password = newPassword;
    await user.save();

    return res.status(200).json(
        new ApiResponse(200, null, "Password updated successfully")
    );
});

const logoutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(req.user._id, { $unset: { refreshToken: 1 } });
    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
    };

    res.clearCookie("accessToken", cookieOptions);
    res.clearCookie("refreshToken", cookieOptions);

    return res.status(200).json(new ApiResponse(200, null, "Signed out successfully"));
});

export {
    signupUser,
    loginUser,
    getCurrentUser,
    updateProfile,
    updatePassword,
    logoutUser,
    generateAccesAndRefreshToken,
};

//login route
//google login
//edit user creds
//getUser projects
//
