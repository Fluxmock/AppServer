import { Server } from "socket.io";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { Project } from "../models/Project.js";

let io;

export function initSocket(httpServer) {
    // ── Job 1: Socket.IO server ───────────────────────────────────
    io = new Server(httpServer, {
        cors: {
            origin: process.env.CORS_ORIGIN || "http://localhost:3000",
            credentials: true,
        },
    });

    // Configuration events can contain private project data. Authenticate once
    // at connection time and verify project ownership before admitting a room.
    io.use(async (socket, next) => {
        try {
            const cookie = socket.handshake.headers.cookie ?? "";
            const token = socket.handshake.auth?.token ?? cookie
                .split(";")
                .map((part) => part.trim())
                .find((part) => part.startsWith("accessToken="))
                ?.slice("accessToken=".length);
            if (!token) return next(new Error("Unauthorized socket"));

            const decoded = jwt.verify(decodeURIComponent(token), process.env.ACCESS_TOKEN_SECRET);
            const user = await User.findById(decoded?._id).select("_id").lean();
            if (!user) return next(new Error("Unauthorized socket"));
            socket.data.userId = String(user._id);
            return next();
        } catch {
            return next(new Error("Unauthorized socket"));
        }
    });

    io.on("connection", (socket) => {
        console.log("[ws] socket connected  :", socket.id);

        // Browser emits this when it opens a project page
        socket.on("join:project", async (projectId) => {
            try {
                const project = await Project.exists({ _id: projectId, userId: socket.data.userId });
                if (!project) {
                    socket.emit("project:join-error", { projectId, message: "Not authorized for this project" });
                    return;
                }
                socket.join(`project:${projectId}`);
                console.log(`[ws] joined room → project:${projectId} (socketId:${socket.id})`);
                // Acknowledge so the frontend knows it's live
                socket.emit("joined:project", { projectId });
            } catch {
                socket.emit("project:join-error", { projectId, message: "Not authorized for this project" });
            }
        });

        // Browser emits this when it navigates away
        socket.on("leave:project", (projectId) => {
            socket.leave(`project:${projectId}`);
            console.log(`[ws] left room  → project:${projectId} (socketId:${socket.id})`);
        });

        socket.on("disconnect", (reason) => {
            console.log("[ws] socket disconnected:", socket.id, reason);
        });
    });

    // ── Job 2: Redis subscriber ───────────────────────────────────
    // Separate IORedis instance — a connection in subscribe mode
    // cannot run any other commands (GET, SET, etc.), so it must be
    // its own connection, not the shared redisClient.
    const redisSub = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

    redisSub.on("connect", () => {
        console.log("[ws] Redis subscriber connected");
    });

    redisSub.on("error", (err) => {
        console.error("[ws] Redis subscriber error:", err.message);
    });

    // psubscribe = pattern subscribe, matches every project channel
    // channel format published by MockServer: "project:<projectId>:requests"
    redisSub.psubscribe("project:*:requests", (err) => {
        if (err) {
            console.error("[ws] psubscribe failed:", err.message);
            return;
        }
        console.log("[ws] subscribed to pattern → project:*:requests");
    });

    // Fires whenever MockServer publishes a log event
    redisSub.on("pmessage", (pattern, channel, message) => {
        // channel = "project:abc123:requests"
        // split(":")[1] extracts "abc123"
        const projectId = channel.split(":")[1];

        let logEvent;
        try {
            logEvent = JSON.parse(message);
        } catch (err) {
            console.error("[ws] failed to parse Redis message:", err.message);
            return;
        }

        // Forward to every browser socket sitting in this project room
        io.to(`project:${projectId}`).emit("request:log", logEvent);

        console.log(
            `[ws] forwarded → room:project:${projectId}`,
            `| ${logEvent.method} ${logEvent.path}`,
            `| ${logEvent.statusCode} ${logEvent.responseTime}ms`,
            logEvent.chaosApplied ? `| chaos:[${logEvent.chaosRules.join(",")}]` : ""
        );
    });

    return io;
}

// Let controllers or other modules emit events after boot
export function getIO() {
    if (!io) throw new Error("Socket.IO not initialized — call initSocket first");
    return io;
}

// Controllers call this only after MongoDB has committed and cache
// invalidation has been scheduled. Delivery is best-effort; REST revalidation
// remains the recovery path for disconnected clients.
export function emitProjectConfigChange(projectId, change) {
    if (!io) {
        console.warn("[ws] configuration change not broadcast: Socket.IO is not initialized");
        return;
    }
    io.to(`project:${projectId}`).emit("project:config", { projectId, ...change });
}

