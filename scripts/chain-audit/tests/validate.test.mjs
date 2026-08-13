import { test } from "node:test";
import assert from "node:assert/strict";
import { collectMatrixErrors, collectRpcErrors } from "../lib/validate.js";

test("matrix validation catches duplicate ids, unknown checks, bad regexes", () => {
  const matrix = {
    chains: [
      { id: "a", tasks: [{ id: "t1", message: "m", checks: ["nope"], expectTools: [] }] },
      { id: "a", tasks: [{ id: "t1", message: "m", checks: ["hasAnswer"], expectTools: [] }] },
      { id: "b", tasks: [{ id: "t2", message: "m", checks: ["fileCheck.f"], fileChecks: [{ label: "f", path: "x", positive: ["("] }] }] },
    ],
  };
  const errors = collectMatrixErrors(matrix);
  assert.ok(errors.some((e) => e.includes("nope")));
  assert.ok(errors.some((e) => e.includes("duplicate/missing chain id: a")));
  assert.ok(errors.some((e) => e.includes("invalid positive regex")));
});

test("rpc validation catches duplicate mode+method+params probes", () => {
  const cfg = {
    groups: [
      { id: "g", checks: [{ method: "m", params: {} }], adminOnly: [{ method: "m", params: {} }] },
      { id: "g2", checks: [{ method: "m2", params: {}, expectError: "(" }] },
    ],
  };
  const errors = collectRpcErrors(cfg);
  assert.ok(errors.some((e) => e.includes("invalid expectError")));
});
