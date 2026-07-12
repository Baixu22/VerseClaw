import assert from "node:assert/strict";
import test from "node:test";
import { resolveDiffBase } from "./git.mjs";

test("resolveDiffBase prefers CLI, then task config, then origin/main", () => {
  assert.equal(resolveDiffBase("release/main", "task-start"), "release/main");
  assert.equal(resolveDiffBase(undefined, "task-start"), "task-start");
  assert.equal(resolveDiffBase(undefined, undefined), "origin/main");
});
