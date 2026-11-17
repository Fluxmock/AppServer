import test from "node:test";
import assert from "node:assert/strict";
import { Project } from "../src/models/Project.js";
import requireProjectOwner from "../src/middlewares/projectOwner.middleware.js";

const userId = "507f1f77bcf86cd799439012";
const projectOne = "507f1f77bcf86cd799439011";
const projectTwo = "507f1f77bcf86cd799439013";

function runMiddleware(req) {
  return new Promise((resolve, reject) => {
    requireProjectOwner(req, {}, (error) => (error ? reject(error) : resolve()));
  });
}

test("allows one owner to access each of their projects", async (t) => {
  const seen = [];
  t.mock.method(Project, "exists", async (filter) => {
    seen.push(filter);
    return { _id: filter._id };
  });

  const first = { params: { projectId: projectOne }, user: { _id: userId } };
  const second = { params: { projectId: projectTwo }, user: { _id: userId } };
  await runMiddleware(first);
  await runMiddleware(second);

  assert.equal(seen.length, 2);
  assert.equal(seen[0].userId, userId);
  assert.equal(seen[1].userId, userId);
  assert.equal(first.project._id, projectOne);
  assert.equal(second.project._id, projectTwo);
});

test("rejects a project the authenticated user does not own", async (t) => {
  t.mock.method(Project, "exists", async () => null);
  const request = { params: { projectId: projectTwo }, user: { _id: userId } };

  await assert.rejects(runMiddleware(request), { statusCode: 404 });
  assert.equal(request.project, undefined);
});

test("rejects malformed ids before querying MongoDB", async (t) => {
  const exists = t.mock.method(Project, "exists", async () => {
    throw new Error("MongoDB should not be queried");
  });
  const request = { params: { projectId: "not-an-object-id" }, user: { _id: userId } };

  await assert.rejects(runMiddleware(request), { statusCode: 404 });
  assert.equal(exists.mock.callCount(), 0);
});
