/**
 * MongoDB Timeseries Collection Setup Script
 * 
 * Run this once to create the requestLogs timeseries collection.
 * 
 * Usage: node scripts/setup-timeseries.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, "../.env") });

async function setupTimeseries() {
  try {
    console.log("[setup] Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("[setup] Connected successfully");

    const db = mongoose.connection.db;
    
    // Check if collection already exists
    const collections = await db.listCollections({ name: "requestLogs" }).toArray();
    
    if (collections.length > 0) {
      console.log("[setup] ⚠️  requestLogs collection already exists");
      console.log("[setup] Skipping creation to preserve existing data");
    } else {
      console.log("[setup] Creating requestLogs timeseries collection...");
      
      await db.createCollection("requestLogs", {
        timeseries: {
          timeField: "timestamp",
          metaField: "projectId",
          granularity: "seconds",
        },
        expireAfterSeconds: 2592000, // 30 days retention
      });
      
      console.log("[setup] ✅ requestLogs collection created successfully");
      console.log("[setup] Configuration:");
      console.log("[setup]   - Time field: timestamp");
      console.log("[setup]   - Meta field: projectId");
      console.log("[setup]   - Granularity: seconds");
      console.log("[setup]   - TTL: 30 days");
    }
    
    // Create indexes for better query performance
    console.log("[setup] Creating indexes...");
    await db.collection("requestLogs").createIndex({ projectId: 1, timestamp: -1 });
    await db.collection("requestLogs").createIndex({ endpointId: 1, timestamp: -1 });
    console.log("[setup] ✅ Indexes created");
    
    console.log("[setup] Setup complete!");
    process.exit(0);
  } catch (error) {
    console.error("[setup] ❌ Setup failed:", error.message);
    process.exit(1);
  }
}

setupTimeseries();
