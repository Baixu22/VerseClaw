import { test } from "node:test";
import assert from "node:assert/strict";
import { grade, aggregate, GRADES } from "../lib/grade.js";

test("critical failure -> F regardless of other checks", () => {
  const r = grade({
    checks: { accepted: true, "tools.exec": false, hasAnswer: true },
    criticalChecks: ["tools.exec"],
    metrics: { elapsedMs: { value: 100, good: 1000, bad: 5000 } },
  });
  assert.equal(r.grade, GRADES.F.label);
  assert.equal(r.score, 10);
});

test("aggregate of no tasks is explicit, not a zero score", () => {
  const r = aggregate([]);
  assert.equal(r.score, null);
  assert.equal(r.grade, "not executed");
});
