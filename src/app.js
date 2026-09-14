import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"

const app = express();

app.use(express.json());//allows to understand the json body
app.use(express.urlencoded({//
    extended : true //allows parsing of nested objects
}));
app.use(express.static("public"));
app.use(cookieParser()); //reads the cookie sent by the browser and makes them available throughout
app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true //the browser needs permission to include credentials in cross-origin requests
}));

export default app;

//why separate app and server --> app.js = how is my application configured, server.js = 
//how do i start this application
//you can import app without starting a real http server
//app.use ==> attaches middleware to express app