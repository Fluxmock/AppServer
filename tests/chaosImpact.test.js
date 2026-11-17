import test from "node:test";
import assert from "node:assert/strict";
import { Project, RequestLog } from "../src/models/index.js";
import { getChaosImpactData } from "../src/modules/analytics/chaosImpact.service.js";

const projectId = "507f1f77bcf86cd799439011";
const userId = "507f1f77bcf86cd799439012";

// Database-free contract tests; restore the model methods after each test.
test("rejects invalid project ids and ranges before accessing the database", async () => {
  await assert.rejects(getChaosImpactData("invalid", userId), { statusCode: 400 });
  await assert.rejects(getChaosImpactData(projectId, userId, "forever"), { statusCode: 400 });
  await assert.rejects(getChaosImpactData(projectId, userId, "__proto__"), { statusCode: 400 });
});

test("does not query private analytics for another user's project", async (t) => {
  t.mock.method(Project, "exists", async (filter) => {
    assert.deepEqual(filter, { _id: projectId, userId });
    return null;
  });
  const aggregate = t.mock.method(RequestLog, "aggregate", () => { throw new Error("Must not read logs"); });
  await assert.rejects(getChaosImpactData(projectId, userId), { statusCode: 404 });
  assert.equal(aggregate.mock.callCount(), 0);
});

test("empty traffic returns zero counts and unavailable client telemetry", async (t) => {
  t.mock.method(Project, "exists", async () => ({ _id: projectId }));
  t.mock.method(RequestLog, "aggregate", (pipeline) => {
    const match = pipeline[0].$match;
    assert.equal(String(match.projectId), projectId);
    assert.equal(match.timestamp.$lte - match.timestamp.$gte, 7 * 86400_000);
    return { option: async () => [{ summary: [], failures: [] }] };
  });
  const result = await getChaosImpactData(projectId, userId, "7d");
  assert.equal(result.summary.totalRequests, 0);
  assert.equal(result.summary.eventsInjected, 0);
  assert.equal(result.summary.requestsAffected, 0);
  assert.equal(result.summary.chaosHitRate, 0);
  assert.deepEqual(result.failures, []);
  assert.equal(result.clientErrors, null);
  assert.equal(result.recovery, null);
  assert.equal(result.fixes, null);
});

test("keeps rule applications separate from unique affected requests", async (t) => {
  t.mock.method(Project, "exists", async () => ({ _id: projectId }));
  t.mock.method(RequestLog, "aggregate", () => ({ option: async () => [{
    summary: [{ totalRequests: 10, requestsAffected: 2, eventsInjected: 3, endpointsAffected: 1 }],
    failures: [{ _id: "delay", injected: 2 }, { _id: "error", injected: 1 }],
  }] }));
  const result = await getChaosImpactData(projectId, userId);
  assert.equal(result.summary.chaosHitRate, 20);
  assert.equal(result.summary.eventsInjected, 3);
  assert.equal(result.summary.requestsAffected, 2);
  assert.deepEqual(result.failures, [
    { ruleType: "delay", type: "Latency", injected: 2 },
    { ruleType: "error", type: "Error", injected: 1 },
  ]);
});
