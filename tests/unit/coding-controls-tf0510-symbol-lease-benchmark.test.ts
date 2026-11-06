// @vitest-environment node
/**
 * TF-0510: real multi-process (multi-writer) benchmark for symbol-lease WAL mode.
 *
 * The earlier suite proved WAL correctness with a single test process. This benchmark
 * spawns actual child processes that contend for the same symbol lease and each perform a
 * side effect inside the critical section, so it measures a genuine multi-writer outcome
 * instead of asserting a single-process store.
 *
 * Success metrics reported:
 *   - acquisitions / denials per worker (real cross-process contention)
 *   - duplicateMutationSideEffects: side-effect lines minus successful acquisitions
 *     (must be 0 - no two overlapping holders may both write)
 *   - wall-clock duration and throughput
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

const WORKERS = 4;
const ROUNDS = 12;
const WORKER = "tests/unit/fixtures/coding-controls-tf0510/symbol-lease-worker.mts";
const TSX = path.join(process.cwd(), "openclaw_runtime", "node_modules", ".bin", "tsx.CMD");

type WorkerResult = { holderId: string; acquired: number; denied: number; effects: number; overlaps: number };

function runWorker(job: unknown): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    // .CMD cannot be execFile'd directly on Windows (spawn EINVAL); route via cmd.exe.
    execFile(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", TSX + " " + WORKER + " " + Buffer.from(JSON.stringify(job), "utf8").toString("base64")],
      { cwd: process.cwd(), windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message)));
          return;
        }
        try {
          resolve(JSON.parse(String(stdout).trim()) as WorkerResult);
        } catch {
          reject(new Error("unparseable worker output: " + String(stdout).slice(0, 300)));
        }
      },
    );
  });
}

describe("TF-0510 symbol-lease multi-process benchmark", () => {
  let root = "";
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("serializes overlapping writers across real processes with zero duplicate side effects", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tf0510-lease-bench-"));
    const effectsPath = path.join(root, "effects.txt");
    fs.writeFileSync(effectsPath, "");

    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: WORKERS }, (_unused, index) =>
        runWorker({
          workspaceRoot: root,
          holderId: "worker-" + index,
          rounds: ROUNDS,
          symbol: "shared::critical-section",
          effectsPath,
        }),
      ),
    );
    const durationMs = Date.now() - started;

    const totals = results.reduce(
      (acc, entry) => ({
        acquired: acc.acquired + entry.acquired,
        denied: acc.denied + entry.denied,
        effects: acc.effects + entry.effects,
        overlaps: acc.overlaps + entry.overlaps,
      }),
      { acquired: 0, denied: 0, effects: 0, overlaps: 0 },
    );

    const sideEffectLines = fs
      .readFileSync(effectsPath, "utf8")
      .split(/\r?\n/u)
      .filter((line) => line.trim().length > 0);

    // Count correspondence alone cannot prove exclusion; the worker also
    // records overlapping critical sections through an independent marker.
    const duplicateMutationSideEffects = sideEffectLines.length - totals.acquired;

    const report = {
      driven_by: 'agent',
      actor: 'codex-r1-multiprocess-benchmark',
      workers: WORKERS,
      roundsPerWorker: ROUNDS,
      durationMs,
      throughputAcquiresPerSecond: durationMs > 0 ? Number(((totals.acquired / durationMs) * 1000).toFixed(2)) : 0,
      totals,
      sideEffectLines: sideEffectLines.length,
      duplicateMutationSideEffects,
      contentionObserved: results.some((entry) => entry.denied > 0),
      perWorker: results,
    };
    console.log(JSON.stringify(report, null, 1));
    const evidenceDir = path.join(process.cwd(), 'artifacts/runs/autonomy-resource-admission');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'contention-' + randomUUID() + '.json'), JSON.stringify(report, null, 2) + '\n');

    // Correctness: every side effect corresponds to exactly one successful acquisition.
    expect(duplicateMutationSideEffects).toBe(0);
    expect(totals.overlaps).toBe(0);
    expect(sideEffectLines.length).toBe(totals.acquired);
    // Each worker must have completed its rounds (acquired + denied).
    for (const entry of results) {
      expect(entry.acquired + entry.denied, entry.holderId).toBe(ROUNDS);
      expect(entry.effects, entry.holderId).toBe(entry.acquired);
    }
    // Real contention across processes must occur, otherwise this is not a multi-writer result.
    expect(report.contentionObserved).toBe(true);
    expect(totals.acquired).toBeGreaterThan(0);
  }, 180_000);
});
