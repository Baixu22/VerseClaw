import assert from "node:assert/strict";
import test from "node:test";

import {
  coalesceNearbyRanges,
  corroborateCommentBySignature,
  deriveSourceSpans,
  mapLinesByStableAnchors,
} from "./source-span-evidence.mjs";

test("recovers a swallowed closing quote as part of the insert span", () => {
  const currentLine = Buffer.from("22e3813f2c", "hex");
  const sourceLine = Buffer.from("22e3818c222c", "hex");

  const spans = deriveSourceSpans({
    currentLine,
    sourceLine,
    ranges: [{ currentOffset: 1, length: 3 }],
    anchorBytes: 16,
  });

  assert.deepEqual(spans, [
    {
      currentOffset: 1,
      removeHex: "e3813f",
      insertHex: "e3818c22",
      leftAnchorHex: "22",
      rightAnchorHex: "2c",
      sourceOffset: 1,
      sourceLength: 4,
    },
  ]);
});

test("derives multiple variable-length spans against current-line offsets", () => {
  const currentLine = Buffer.from("61e3813f2c62e2863f3f63", "hex");
  const sourceLine = Buffer.from("61e3818c222c62e2869263", "hex");

  const spans = deriveSourceSpans({
    currentLine,
    sourceLine,
    ranges: [
      { currentOffset: 1, length: 3 },
      { currentOffset: 6, length: 4 },
    ],
    anchorBytes: 16,
  });

  assert.equal(spans[0].removeHex, "e3813f");
  assert.equal(spans[0].insertHex, "e3818c22");
  assert.equal(spans[1].removeHex, "e2863f3f");
  assert.equal(spans[1].insertHex, "e28692");
});

test("includes a complete variation-selector and ZWJ tail swallowed by corruption", () => {
  const currentLine = Buffer.from("5b41e29d3f2c425d", "hex");
  const sourceLine = Buffer.from("5b41e29da4efb88fe2808df09f92bb2c425d", "hex");

  const [span] = deriveSourceSpans({
    currentLine,
    sourceLine,
    ranges: [{ currentOffset: 2, length: 3 }],
    anchorBytes: 16,
  });

  assert.equal(span.removeHex, "e29d3f");
  assert.equal(span.insertHex, "e29da4efb88fe2808df09f92bb");
  assert.equal(span.leftAnchorHex, "5b41");
  assert.equal(span.rightAnchorHex, "2c425d");
});

test("rejects source lines whose preserved prefix or suffix does not match", () => {
  assert.throws(
    () =>
      deriveSourceSpans({
        currentLine: Buffer.from("61e2863f62", "hex"),
        sourceLine: Buffer.from("7ae2869279", "hex"),
        ranges: [{ currentOffset: 1, length: 3 }],
      }),
    /preserved prefix or suffix/,
  );
});

test("rejects ambiguous internal preserved segments", () => {
  assert.throws(
    () =>
      deriveSourceSpans({
        currentLine: Buffer.from("61e2863f62e2803f63", "hex"),
        sourceLine: Buffer.from("61e286926262e2809463", "hex"),
        ranges: [
          { currentOffset: 1, length: 3 },
          { currentOffset: 5, length: 3 },
        ],
      }),
    /ambiguous preserved segment/,
  );
});

test("coalesces adjacent scanner units into one source-aligned repair span", () => {
  assert.deepEqual(
    coalesceNearbyRanges(
      [
        { currentOffset: 10, length: 3, recordIds: ["a"] },
        { currentOffset: 13, length: 3, recordIds: ["b"] },
        { currentOffset: 18, length: 3, recordIds: ["c"] },
        { currentOffset: 40, length: 3, recordIds: ["d"] },
      ],
      8,
    ),
    [
      {
        currentOffset: 10,
        length: 11,
        recordIds: ["a", "b", "c"],
      },
      {
        currentOffset: 40,
        length: 3,
        recordIds: ["d"],
      },
    ],
  );
});

test("maps damaged lines only inside equal-length stable-anchor intervals", () => {
  const current = ["header", "same", "bad-a", "bad-b", "tail"].map((line) =>
    Buffer.from(line),
  );
  const source = ["header", "same", "good-a", "good-b", "tail"].map((line) =>
    Buffer.from(line),
  );

  assert.deepEqual(mapLinesByStableAnchors(current, source), [0, 1, 2, 3, 4]);
});

test("does not position-map an interval containing a source-only line", () => {
  const current = ["before", "bad", "after"].map((line) => Buffer.from(line));
  const source = ["before", "inserted", "good", "after"].map((line) => Buffer.from(line));

  const mapping = mapLinesByStableAnchors(current, source);

  assert.equal(mapping[0], 0);
  assert.equal(mapping[1], undefined);
  assert.equal(mapping[2], 3);
});

test("corroborates only comment candidates with a strong independent signature", () => {
  const support = new Map([
    [
      "e2803f:e2809420",
      {
        recordCount: 42,
        sourceIds: ["upstream:e993", "upstream:2026.6.11"],
      },
    ],
  ]);
  const candidate = {
    status: "candidate",
    risk: "comment-line",
    selectedSpan: {
      removeHex: "e2803f",
      insertHex: "e2809420",
    },
  };

  assert.equal(corroborateCommentBySignature(candidate, support, 20), true);
  assert.equal(candidate.status, "corroborated");
  assert.equal(candidate.corroboratingEvidence[0].supportRecordCount, 42);
});

test("does not use a corruption signature for behavior-sensitive values", () => {
  const support = new Map([
    [
      "e2803f:e2809420",
      {
        recordCount: 42,
        sourceIds: ["upstream:e993", "upstream:2026.6.11"],
      },
    ],
  ]);
  const candidate = {
    status: "candidate",
    risk: "runtime-string",
    selectedSpan: {
      removeHex: "e2803f",
      insertHex: "e2809420",
    },
  };

  assert.equal(corroborateCommentBySignature(candidate, support, 20), false);
  assert.equal(candidate.status, "candidate");
});
