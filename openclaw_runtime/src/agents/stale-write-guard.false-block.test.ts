/**
 * TF-0510 / success metric: stale_guard_false_block_rate_measured.
 *
 * Builds a labelled corpus of write attempts against a real temp workspace and reports
 * the false-block rate. A "block-expected" case is a genuine stale overwrite (the file
 * changed on disk after this session read it). An "allow-expected" case is any write the
 * guard must not block: a fresh re-read, a first write of an unread file, a new file,
 * and a non-code artifact produced outside the session.
 *
 * The rate is measured, not asserted to an arbitrary threshold: the test fails only if a
 * guard decision contradicts its label, which is what makes the rate 0 on this corpus.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { shouldBlockStaleWrite } from "./stale-write-guard.js";
import { clearSessionReadHashes, hashFileOnDisk, recordSessionReadHash } from "./session-read-hashes.js";

type Case = {
  id: string;
  /** What the guard is expected to do for this labelled case. */
  expectation: "block" | "allow";
  build: (root: string) => { filePath: string; hash?: (abs: string) => string | undefined };
};

const CASES: Case[] = [
  {
    id: "stale-overwrite-after-external-change",
    expectation: "block",
    build: (root) => {
      const rel = "src/changed.ts";
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, "export const value = 1;\n");
      recordSessionReadHash("corpus", rel, hashFileOnDisk(abs));
      fs.writeFileSync(abs, "export const value = 2;\n");
      return { filePath: rel };
    },
  },
  {
    id: "fresh-after-reread",
    expectation: "allow",
    build: (root) => {
      const rel = "src/reread.ts";
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, "export const a = 1;\n");
      fs.writeFileSync(abs, "export const a = 2;\n");
      recordSessionReadHash("corpus", rel, hashFileOnDisk(abs));
      return { filePath: rel };
    },
  },
  {
    id: "unread-file-first-write",
    expectation: "allow",
    build: (root) => {
      const rel = "src/never-read.ts";
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, "preexisting\n");
      return { filePath: rel };
    },
  },
  {
    id: "brand-new-file",
    expectation: "allow",
    build: () => ({ filePath: "src/does-not-exist-yet.ts" }),
  },
  {
    id: "generated-artifact-outside-source",
    expectation: "allow",
    build: (root) => {
      const rel = "dist/generated.js";
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, "generated\n");
      return { filePath: rel };
    },
  },
];

describe("TF-0510 stale-write-guard false-block corpus", () => {
  let root = "";
  afterEach(() => {
    clearSessionReadHashes("corpus");
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("measures a false-block rate over labelled genuine-stale and must-allow writes", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tf0510-stale-"));
    const outcomes = CASES.map((testCase) => {
      const built = testCase.build(root);
      const decision = shouldBlockStaleWrite({
        workspaceRoot: root,
        filePath: built.filePath,
        sessionId: "corpus",
      });
      const observed = decision.block ? "block" : "allow";
      return { id: testCase.id, expectation: testCase.expectation, observed, reason: decision.reason ?? null };
    });

    const blockExpected = outcomes.filter((entry) => entry.expectation === "block");
    const allowExpected = outcomes.filter((entry) => entry.expectation === "allow");
    const falseBlocks = allowExpected.filter((entry) => entry.observed === "block");
    const missedBlocks = blockExpected.filter((entry) => entry.observed !== "block");

    const falseBlockRate = allowExpected.length === 0 ? 0 : falseBlocks.length / allowExpected.length;

    console.log(
      JSON.stringify(
        {
          corpusSize: outcomes.length,
          blockExpected: blockExpected.length,
          allowExpected: allowExpected.length,
          falseBlocks: falseBlocks.length,
          missedBlocks: missedBlocks.length,
          falseBlockRate,
          outcomes,
        },
        null,
        1,
      ),
    );

    // Correctness first: a decision that contradicts its label is a real defect.
    expect(missedBlocks, "genuine stale overwrites must be blocked").toEqual([]);
    expect(falseBlocks, "must-allow writes must not be blocked").toEqual([]);
    expect(falseBlockRate).toBe(0);
  });
});