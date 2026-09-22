# AppServer

AppServer is the control plane for FluxMock. It owns authentication, project configuration, endpoint management, chaos rule definitions, and the admin-facing API used by the dashboard and internal tooling.

This service is separate from MockServer. MockServer is the runtime request engine that serves mocked traffic; AppServer is the configuration layer that defines what should happen.

---

## What this service does

AppServer is responsible for:

- user authentication and authorization
- project CRUD and project key generation
- endpoint configuration for mock routes
- chaos rule creation and management
- API key and access management
- audit trails and analytics metadata
- Redis-backed background jobs and queue workers

The main request flow is:

1. user signs in through the dashboard or API
2. project/endpoint/chaos data is created or updated
3. AppServer stores the config in MongoDB
4. MockServer reads the relevant runtime config during request execution
5. logs and job events are emitted to Redis or worker queues

---

## Core architecture

AppServer uses a modular Express application structure, where each feature lives in its own folder under `src/modules`.

### HTTP entrypoints

The app is assembled in [src/app.js](src/app.js):

- `/api/v1/auth` → authentication routes
- `/api/v1/project` → project routes
- `/api/v1/endpoint` → endpoint routes
- `/api/v1/chaos` → chaos rule routes

The server boots in [src/server.js](src/server.js), which connects MongoDB and starts the HTTP server.

### Runtime boundary

- AppServer = source of truth for config data
- MockServer = runtime execution layer that consumes config
- Redis = cache + queue + event coordination
- MongoDB = durable record storage for project metadata and runtime state

---

## Folder structure

```text
AppServer/
├── .env
├── .gitignore
├── package.json
├── package-lock.json
├── scripts/
│   ├── migrate/
│   └── seed/
├── src/
│   ├── app.js
│   ├── server.js
│   ├── config/
│   │   ├── constant.js
│   │   ├── db.js
│   │   ├── env.js
│   │   └── redis.js
│   ├── jobs/
│   │   ├── analyticsRollup.queue.js
│   │   └── webhookDispatch.queue.js
│   ├── middlewares/
│   │   ├── auth.middleware.js
│   │   ├── multer.middleware.js
│   │   ├── rbac.middleware.js
│   │   └── validate.middleware.js
│   ├── models/
│   │   ├── ChaosRule.js
│   │   ├── Endpoint.js
│   │   ├── Project.js
│   │   ├── User.js
│   │   └── index.js
│   ├── modules/
│   │   ├── analytics/
│   │   ├── apiKeys/
│   │   ├── auditLogs/
│   │   ├── auth/
│   │   ├── chaosRules/
│   │   ├── endpoints/
│   │   ├── presets/
│   │   ├── projects/
│   │   ├── teams/
│   │   ├── users/
│   │   └── webhooks/
│   ├── services/
│   ├── utils/
│   │   ├── ApiError.js
│   │   ├── ApiResponse.js
│   │   ├── asyncHandler.js
│   │   ├── cloudinary.js
│   │   ├── hash.js
│   │   ├── logger.js
│   │   └── pagination.js
│   ├── workers/
│   │   ├── analyticsRollup.worker.js
│   │   └── webhookDispath.worker.js
│   └── ...
└── node_modules/
```

---

## Module breakdown

### Auth module

Responsible for authentication and secured access.

Typical flow:

- register/login
- JWT token creation
- session or cookie handling
- protected route middleware

### Projects module

Handles project creation, update, activation, and project key generation.

Project-level metadata usually includes:

- project name
- created user
- active/inactive status
- generated public project key
- associated endpoints and rules

### Endpoints module

Defines the mock request route behavior.

A mock endpoint usually stores:

- HTTP method
- route path
- status code
- response headers
- response body template
- active flag

### ChaosRules module

Defines runtime behaviors to inject into mocked traffic.

Examples:

- delay
- error injection
- payload mutation
- rate limiting
- auth failures
- schema mismatch
- network failure simulation

Rules can be scoped to:

- the whole project
- a specific endpoint

### Other modules

The remaining modules cover:

- analytics
- API keys
- audit logs
- teams and users
- presets
- webhooks
- admin and audit tooling

---

## Data models

The main models live in [src/models](src/models):

- [src/models/User.js](src/models/User.js)
- [src/models/Project.js](src/models/Project.js)
- [src/models/Endpoint.js](src/models/Endpoint.js)
- [src/models/ChaosRule.js](src/models/ChaosRule.js)

The shared model index is in [src/models/index.js](src/models/index.js).

These models define the source-of-truth configuration used by the frontend and consumed by MockServer during runtime.

---

## Environment variables

Create a `.env` file in the AppServer root with values similar to:

```env
PORT=8000
MONGODB_URI=mongodb://localhost:27017
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_jwt_secret
CORS_ORIGIN=http://localhost:3000
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### Meaning of the main variables

- PORT
  - port for the AppServer HTTP API

- MONGODB_URI
  - MongoDB connection URI

- REDIS_URL
  - Redis connection for queues, cache, and pub/sub tasks

- JWT_SECRET
  - secret used to sign auth tokens

- CORS_ORIGIN
  - allowed frontend origin

---

## Dependencies

The AppServer stack is currently based on:

- express — API server
- mongoose — MongoDB ODM
- redis / ioredis — queues and cache
- bullmq — background jobs
- zod — validation
- bcrypt — password hashing
- jsonwebtoken — JWT auth
- cors — cross-origin support
- cookie-parser — cookie access
- multer — file uploads
- cloudinary — media uploads
- dotenv — environment loading
- morgan — request logging
- luxon — date/time helpers
- winston — structured logs

---

## Installation

From the AppServer folder:

```bash
cd AppServer
npm install
```

Start in development mode:

```bash
npm run dev
```

Start in production mode:

```bash
npm start
```

---

## Startup sequence

When the server boots:

1. environment variables are loaded
2. MongoDB is connected from [src/config/db.js](src/config/db.js)
3. the Express app is created in [src/app.js](src/app.js)
4. the app listens on `PORT` in [src/server.js](src/server.js)
5. the API routes are exposed for frontend and control-plane usage

---

## Typical control-plane flow

```text
Frontend Dashboard
        ↓
AppServer API
        ↓
MongoDB config storage
        ↓
MockServer reads runtime config
```

This keeps the app admin layer separate from the real mock execution engine.

---

## Summary

AppServer is the management and orchestration layer of FluxMock. It defines the rules, projects, endpoints, users, and chaos configuration that the runtime MockServer executes against live traffic.
