//validate local credentials
//create google user if not found
//sync user data with google profile
//issue access and refresh token
//return user payload and token pair

import { User } from "../../models/User.js";
import ApiError from "../../utils/ApiError.js";

const signupUserService = async ({ username, email, password, avatar }) => {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
        throw new ApiError(409, "User already exists");
    }

    const user = await User.create({
        username,
        email,
        password,
        authProvider: "local",
        ...(avatar ? { avatar } : {}),
    });

    return {
        _id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar || null,
    };
};

const loginUserService = async ({ email, password }) => {
    if (!email || !password) {
        throw new ApiError(400, "Email and password are required");
    }

    const user = await User.findOne({ email });
    if (!user) {
        throw new ApiError(401, "Invalid credentials");
    }

    const isPasswordValid = await user.isPasswordCorrect(password);
    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid credentials");
    }

    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    return {
        user: {
            _id: user._id,
            username: user.username,
            email: user.email,
            avatar: user.avatar || null,
        },
        accessToken,
        refreshToken,
    };
};

export { signupUserService, loginUserService };