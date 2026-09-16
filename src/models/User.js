import mongoose, {Schema} from 'mongoose';
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

const userSchema = new Schema(
  {
    authProvider : {
      type : String,
      enum : ['local', 'google'],
      default: 'local',
      required: true
    },
    googleId:{
      type : String
    },
    avatar : {
      type : String
    },
    isEmailVerfied : {
      type : Boolean
    },
    lastLoginAt: {
      type : String
    },
    username : {
      type : String,
      required : true,
      trim: true,
      index: true
    },
    email : {
      type: String,
      required : true,
      unique : true,
      trim: true,
    },
    password : {
      type : String,
      required : true
    },
    refreshToken: {
      type: String
    },
    projects : {
      type : Schema.Types.ObjectId,
      ref: "Project"
    }
  },
  {timestamps : true}
);

//before a customer is saved run this function
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.isPasswordCorrect = async function(password){
  return await bcrypt.compare(password, this.password)
}

userSchema.methods.generateAccessToken = function(){
  return jwt.sign(
    {
      _id: this._id,
      email : this.email,
      username: this.username,
    },
    process.env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
    }
  );
};

userSchema.methods.generateRefreshToken = function(){
  return jwt.sign(
    {
      _id: this._id,
    },
    process.env.REFRESH_TOKEN_SECRET,
    {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRY,
    }
  );
};

export const User = mongoose.model("User", userSchema);

//schema.pre is provided by mongoose, and is a middleware hook
//schema,method is your own method added to mongoose
//gives every document a custom function