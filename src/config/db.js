import mongoose from 'mongoose';
import {MONGODB_DB_NAME} from './constant.js';

const connectDB = async () => {
  try{
    const connnectionInstance = await mongoose.connect(`${process.env.MONGODB_URI}/${MONGODB_DB_NAME}`);
    console.log(`MONGODB connection!! DB HOST : ${connnectionInstance.connection.host}`);
  }catch(error){
    console.log("connection error MONGODB ", error);
    process.exit(1);
  }
}

export default connectDB;

