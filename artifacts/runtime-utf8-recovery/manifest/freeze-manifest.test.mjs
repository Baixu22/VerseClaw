import assert from "node:assert/strict";
import test from "node:test";

import { buildFrozenManifest } from "./freeze-manifest.mjs";

function span(overrides = {}) {
  return {
    spanId: "openclaw_runtime/extensions/alpha/a.ts@10-13",
    inventoryRecordIds: ["a@10", "a@11"],
    currentOffset: 10,
    removeHex: "e2803f",
    insertHex: "e2809420",
    leftAnchorHex: "61",
    rightAnchorHex: "62",
    sourceId: "upstream:e993",
    ...overrides,
  };
}

test("deduplicates one source span covering multiple inventory records", () => {
  const selected = span();
  const report = {
    schemaVersion: 2,
    spanModel: "source-aligned-variable-length",
    counts: { exact: 0, corroborated: 2, candidate: 0, conflict: 0, unresolved: 0 },
    files: [
      {
        path: "openclaw_runtime/extensions/alpha/a.ts",
        preimageSha256: "a".repeat(64),
        expectedPostimageSha256: "b".repeat(64),
        applicable: true,
        postimageStrictUtf8: true,
      },
    ],
    records: [
      {
        id: "a@10",
        path: "openclaw_runtime/extensions/alpha/a.ts",
        status: "corroborated",
        selectedSpan: selected,
        candidates: [selected, { ...selected, sourceId: "upstream:current" }],
      },
      {
        id: "a@11",
        path: "openclaw_runtime/extensions/alpha/a.ts",
        status: "corroborated",
        selectedSpan: selected,
        candidates: [selected, { ...selected, sourceId: "upstream:current" }],
      },
    ],
  };

  const frozen = buildFrozenManifest(report);

  assert.equal(frozen.manifest.repairs.length, 1);
  assert.equal(frozen.manifest.preimageMode, "git-index");
  assert.equal(frozen.manifest.repairs[0].replacements.length, 1);
  assert.deepEqual(frozen.manifest.repairs[0].replacements[0].inventoryRecordIds, [
    "a@10",
    "a@11",
  ]);
  assert.deepEqual(frozen.manifest.repairs[0].replacements[0].evidenceIds, [
    "upstream:current",
    "upstream:e993",
  ]);
});

test("creates a complete pairwise-disjoint and workload-balanced file partition", () => {
  const files = ["alpha/a.ts", "alpha/b.ts", "beta/a.ts", "gamma/a.ts", "delta/a.ts"].map(
    (relative, index) => ({
      path: `openclaw_runtime/extensions/${relative}`,
      preimageSha256: `${index}`.repeat(64),
      expectedPostimageSha256: `${index + 1}`.repeat(64),
      applicable: true,
      postimageStrictUtf8: true,
    }),
  );
  const records = files.map((file, index) => {
    const selected = span({
      spanId: `${file.path}@${index}-${index + 3}`,
      inventoryRecordIds: [`record-${index}`],
      currentOffset: index,
    });
    return {
      id: `record-${index}`,
      path: file.path,
      status: "corroborated",
      selectedSpan: selected,
      candidates: [selected, { ...selected, sourceId: "upstream:current" }],
    };
  });

  const frozen = buildFrozenManifest({
    schemaVersion: 2,
    spanModel: "source-aligned-variable-length",
    counts: { exact: 0, corroborated: 5, candidate: 0, conflict: 0, unresolved: 0 },
    files,
    records,
  });

  const allPaths = frozen.partitions.flatMap((partition) => partition.paths);
  assert.equal(new Set(allPaths).size, files.length);
  assert.deepEqual(new Set(allPaths), new Set(files.map((file) => file.path)));
  const loads = frozen.partitions.map((partition) => partition.spanCount);
  assert.ok(Math.max(...loads) - Math.min(...loads) <= 1);
  assert.equal(
    frozen.partitions.filter((partition) =>
      partition.paths.some((filePath) => filePath.includes("/alpha/")),
    ).length,
    2,
  );
});

test("refuses to freeze incomplete or overlapping evidence", () => {
  assert.throws(
    () =>
      buildFrozenManifest({
        schemaVersion: 2,
        spanModel: "source-aligned-variable-length",
        counts: { exact: 0, corroborated: 0, candidate: 1, conflict: 0, unresolved: 0 },
        files: [],
        records: [],
      }),
    /non-applicable evidence/,
  );
});
