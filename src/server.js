import dotenv from "dotenv";
import { createServer } from "node:http";
import connectDB from "./config/db.js";
import app from "./app.js";
import { initSocket } from "./config/socket.js";

dotenv.config({ path: ".env" });

const PORT = process.env.PORT || 8000;

// Wrap Express in a plain HTTP server so Socket.IO can share the
// same port — no extra port or proxy config needed
const httpServer = createServer(app);

// Boot Socket.IO + Redis subscriber before the DB connects
// so the WebSocket endpoint is ready from the first request
initSocket(httpServer);

connectDB()
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`AppServer running on port ${PORT}`);
      console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.log("MONGO DB CONNECTION FAILED :-( ", err);
  });
