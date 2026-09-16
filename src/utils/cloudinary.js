import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";

dotenv.config();

const cloudinaryConfig = () => {
  const requiredEnv = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ];

  for (const key of requiredEnv) {
    if (!process.env[key]) {
      throw new Error(`Missing Cloudinary env: ${key}`);
    }
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
};

const uploadOnCloudinary = async (files) => {
  cloudinaryConfig();

  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("No valid files provided for upload");
  }

  const uploadImage = await Promise.all(
    files.map(async (file) => {
      if (!file) {
        throw new Error("Invalid file object for Cloudinary upload");
      }

      if (file.buffer) {
        return await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            { resource_type: "image" },
            (error, result) => {
              if (error) return reject(error);
              resolve(result);
            }
          );

          uploadStream.end(file.buffer);
        });
      }

      if (file.path) {
        return await cloudinary.uploader.upload(file.path, {
          resource_type: "image",
        });
      }

      throw new Error("Uploaded file is missing buffer or path");
    })
  );

  return uploadImage;
};

const deleteFromCloudinary = async (publicID) => {
  cloudinaryConfig();

  try {
    if (!publicID) return null;
    const response = await cloudinary.uploader.destroy(publicID);
    return response;
  } catch (error) {
    console.log("Error While Deleting the file on Cloudinary,", error);
    return null;
  }
};

export { uploadOnCloudinary, deleteFromCloudinary };