/**
 * Child process for the TF-0510 multi-writer benchmark.
 *
 * Takes ONE base64-encoded JSON argument (shell quoting cannot corrupt it). Each worker
 * repeatedly tries to acquire the same symbol lease in WAL mode and, when it wins, appends
 * one line to a shared side-effect file. If the lease is correct, the number of side-effect
 * lines can never exceed the number of successful acquisitions.
 */
import { appendFileSync } from "node:fs";
import { acquireSymbolLease, releaseSymbolLease } from "../../../../openclaw_runtime/src/context-engine/factstore/symbol-lease.js";

type Job = {
  workspaceRoot: string;
  holderId: string;
  rounds: number;
  symbol: string;
  effectsPath: string;
};

const encoded = process.argv[2] ?? "";
if (!encoded) {
  process.stderr.write("missing base64 job argument\n");
  process.exit(2);
}
const job = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Job;

// Hold the lease long enough that sibling processes really overlap: without this the
// 12 rounds finish in milliseconds and the workers never contend (a vacuous result).
const HOLD_MS = Number(process.env.TF0510_LEASE_HOLD_MS ?? 25);
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
let acquired = 0;
let denied = 0;
let effects = 0;

for (let round = 0; round < job.rounds; round += 1) {
  const result = acquireSymbolLease({
    workspaceRoot: job.workspaceRoot,
    holderId: job.holderId,
    symbolName: job.symbol,
    mode: "wal",
    ttlMs: 60_000,
  });
  if (!result.ok) {
    denied += 1;
    continue;
  }
  acquired += 1;
  appendFileSync(job.effectsPath, job.holderId + ":" + round + "\n");
  effects += 1;
  // Keep the critical section open so peers actually contend.
  await sleep(HOLD_MS);
  releaseSymbolLease({
    workspaceRoot: job.workspaceRoot,
    holderId: job.holderId,
    symbolName: job.symbol,
    mode: "wal",
  });
}

process.stdout.write(JSON.stringify({ holderId: job.holderId, acquired, denied, effects }));