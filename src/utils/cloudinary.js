import {v2 as cloudinary} from "cloudinary";
import fs from "fs";
import dotenv from "dotenv"


dotenv.config();

const uploadOnCloudinary = async(files) =>{
    cloudinary.config({
         cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    try{
        if(!Array.isArray(files) || files.length === 0){
            throw new Error("No valid files provided for upload");
        }

        const uploadImage = await Promise.all(
            files.map((file) => {
                return new Promise((resolve, reject) => {
                    const uploadStream = cloudinary.uploader_stream(
                    {resource_type : "image"},
                    (error, result) => {
                        if(error) reject(error);
                        else resolve(result);
                    }
                );
                uploadStream.end(Buffer.from(file));
             });
                
            })
        );

        return uploadImage;
    }catch(error){
        console.log("cloudinary upload error: ", error);
        return null;
    }
};

const deleteFromCloudinary = async (publicID) => {
    cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  try {
    if (!publicId) return null;
    // delete the file on cloudinary
    const response = await cloudinary.uploader.destroy(publicId);
    return response;
  } catch (error) {
    console.log("Error While Deleting the file on Cloudinary,", error);
    return null;
  }
}

export { uploadOnCloudinary, deleteFromCloudinary };