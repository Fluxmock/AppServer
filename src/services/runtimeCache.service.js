import redisClient from "../config/redis.js";

// These keys are consumed by MockServer. MongoDB remains authoritative; Redis
// is only a rebuildable data-plane cache.
export const RUNTIME_CACHE_TTL_SECONDS = 300;

export const runtimeCacheKeys = {
  project: (projectKey) => `project:key:${projectKey}`,
  projectVersion: (projectKey) => `cache:version:project-key:${projectKey}`,
  endpoints: (projectId) => `project:endpoints:${projectId}`,
  legacyEndpoint: (endpointId) => `endpoint:${endpointId}`,
  endpointsVersion: (projectId) => `cache:version:endpoints:${projectId}`,
  chaos: (projectId, endpointId = null) =>
    endpointId
      ? `chaos:rules:project:${projectId}:endpoint:${endpointId}`
      : `chaos:rules:project:${projectId}`,
  chaosVersion: (projectId, endpointId = null) =>
    endpointId
      ? `cache:version:chaos:${projectId}:endpoint:${endpointId}`
      : `cache:version:chaos:${projectId}`,
  chaosAll: (projectId) => `chaos:rules:project:${projectId}:all`,
  requestEvents: (projectId) => `project:${projectId}:request-events:24h`,
};

const RETRY_DELAYS_MS = [1_000, 5_000, 30_000];

/**
 * Cache invalidation is intentionally used instead of updating cached arrays.
 * A later MockServer read rebuilds from MongoDB and writes only if the version
 * observed before its read is still current. This avoids lost updates and stale
 * rebuilds resurrecting deleted entries.
 */
function runCacheSync(name, operation, attempt = 0) {
  return operation().catch((error) => {
    console.error(`[cache] ${name} failed (attempt ${attempt + 1}):`, error.message);
    if (attempt < RETRY_DELAYS_MS.length) {
      setTimeout(() => {
        runCacheSync(name, operation, attempt + 1).catch(() => {});
      }, RETRY_DELAYS_MS[attempt]);
    } else {
      console.error(`[cache] ${name} exhausted retries; MongoDB is authoritative and the cache will recover on the next successful invalidation/rebuild`);
    }
    // The database mutation has already committed. Do not report a false API
    // failure, but make the degraded cache state observable and retry it.
    return false;
  });
}

export function invalidateEndpointCache(projectId) {
  const endpointKey = runtimeCacheKeys.endpoints(projectId);
  const versionKey = runtimeCacheKeys.endpointsVersion(projectId);
  return runCacheSync(`invalidate endpoints for ${projectId}`, async () => {
    await redisClient.multi().incr(versionKey).del(endpointKey).exec();
    return true;
  });
}

export function invalidateChaosCache(projectId, endpointId = null) {
  const ruleKey = runtimeCacheKeys.chaos(projectId, endpointId);
  const versionKey = runtimeCacheKeys.chaosVersion(projectId, endpointId);
  return runCacheSync(`invalidate chaos rules for ${projectId}/${endpointId ?? "project"}`, async () => {
    await redisClient.multi()
      .incr(versionKey)
      .del(ruleKey)
      .del(runtimeCacheKeys.chaosAll(projectId))
      .exec();
    return true;
  });
}

export function invalidateProjectCache(projectId, projectKeys = []) {
  return runCacheSync(`invalidate project ${projectId}`, async () => {
    const tx = redisClient.multi()
      .del(`project:${projectId}:request-history`)
      .del(runtimeCacheKeys.endpoints(projectId))
      .incr(runtimeCacheKeys.endpointsVersion(projectId))
      .del(runtimeCacheKeys.chaos(projectId))
      .del(runtimeCacheKeys.chaosAll(projectId))
      .incr(runtimeCacheKeys.chaosVersion(projectId));

    for (const projectKey of projectKeys.filter(Boolean)) {
      tx.incr(runtimeCacheKeys.projectVersion(projectKey));
      tx.expire(runtimeCacheKeys.projectVersion(projectKey), RUNTIME_CACHE_TTL_SECONDS);
      tx.del(runtimeCacheKeys.project(projectKey));
    }

    await tx.exec();
    return true;
  });
}

export function removeProjectRuntimeCaches(projectId, projectKeys = [], endpointIds = []) {
  return runCacheSync(`remove runtime cache for project ${projectId}`, async () => {
    const tx = redisClient.multi()
      .del(`project:${projectId}:request-history`)
      .del(runtimeCacheKeys.requestEvents(projectId))
      .del(runtimeCacheKeys.endpoints(projectId))
      .del(runtimeCacheKeys.endpointsVersion(projectId))
      .del(runtimeCacheKeys.chaos(projectId))
      .del(runtimeCacheKeys.chaosVersion(projectId))
      .del(runtimeCacheKeys.chaosAll(projectId));

    for (const projectKey of projectKeys.filter(Boolean)) {
      tx.incr(runtimeCacheKeys.projectVersion(projectKey));
      // Retain the tombstone only long enough to reject a concurrent old
      // rebuild, then allow all deletion-related keys to disappear.
      tx.expire(runtimeCacheKeys.projectVersion(projectKey), RUNTIME_CACHE_TTL_SECONDS);
      tx.del(runtimeCacheKeys.project(projectKey));
    }
    for (const endpointId of endpointIds) {
      tx.del(runtimeCacheKeys.legacyEndpoint(endpointId));
      tx.del(runtimeCacheKeys.chaos(projectId, endpointId));
      tx.del(runtimeCacheKeys.chaosVersion(projectId, endpointId));
    }

    await tx.exec();
    return true;
  });
}
