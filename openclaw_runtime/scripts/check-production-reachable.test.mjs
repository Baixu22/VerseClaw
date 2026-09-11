import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import {
  buildExportInventoryReport,
  enumerateRuntimeExportsFromSource,
} from "./check-production-reachable.mjs";

test("enumerates runtime exports and reports syntax outside the inventory", () => {
  const result = enumerateRuntimeExportsFromSource(
    [
      "export function live() {}",
      "export const value = 1;",
      "export type { TypeOnly };",
      "export { live as alias };",
      'export * from "./other.js";',
      "export default function () {}",
    ].join("\n"),
    "fixture.ts",
  );

  assert.deepEqual(
    result.exports.map(({ name, kind }) => ({ name, kind })),
    [
      { name: "live", kind: "export" },
      { name: "value", kind: "export" },
      { name: "alias", kind: "export" },
    ],
  );
  assert.deepEqual(
    result.blindSpots.map(({ kind, detail }) => ({ kind, detail })),
    [
      { kind: "wildcard-export", detail: '"./other.js"' },
      { kind: "default-export", detail: "anonymous" },
    ],
  );
});

test("builds a machine-readable export report without hiding blind spots", () => {
  const file = path.resolve("src", "fixture.ts");
  const sources = new Map([[file, "export function live() {}\nexport * from './missing.js';"]]);
  const graph = {
    sources,
    stripped: new Map([[file, "export function live() {}\nexport * from './missing.js';"]]),
    specifierText: new Map([[file, "export function live() {}\nexport * from './missing.js';"]]),
    unresolved: new Map([[file, ["./missing.js"]]]),
  };
  const report = buildExportInventoryReport([file], graph, new Set([file]));

  assert.equal(report.schema, "production-reachability.exports/v1");
  assert.equal(report.scannedFiles, 1);
  assert.equal(report.exportStatusCounts["not-production-reachable"], 1);
  assert.equal(report.exportBlindSpots[0]?.kind, "wildcard-export");
  assert.ok(report.moduleBlindSpots.some((spot) => spot.kind === "unresolved-relative-import"));
  assert.equal(report.moduleBlindSpotCount, report.moduleBlindSpots.length);
});
