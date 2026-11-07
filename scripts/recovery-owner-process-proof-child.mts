/** Component fixture: real Session SQLite, real controller PIDs, one local journal effect. */
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RecoveryAuthorityRequest } from "../shared/recovery-authority/contract.js";
import { updateSessionStoreAtomic } from "../openclaw_runtime/src/config/sessions/store.js";
import { closeSqliteSessionStoreDatabase } from "../openclaw_runtime/src/config/sessions/store-sqlite.js";
import { SUBAGENT_RECOVERY_MAX_AUTOMATIC_ATTEMPTS } from "../openclaw_runtime/src/agents/subagent-recovery-state.js";
import {
  buildRecoveryAdmissionKey,
  prepareOwnerRecoveryAdmission,
} from "../openclaw_runtime/src/agents/recovery-authority/owner-admission.js";

const [storePath, journalPath, mode] = process.argv.slice(2);
if (
  !storePath ||
  !journalPath ||
  !["hold", "compete", "effect-hold", "settle", "race-a", "race-b"].includes(mode)
) {
  throw new Error("This fixture requires a store, a local journal, and a proof mode.");
}
const sessionKey = "agent:main:subagent:process-proof";
const sessionId = "process-proof-generation";
const ownerId = "original-process-proof-run";
const idempotencyKey = buildRecoveryAdmissionKey("subagent-orphan", ownerId, sessionId, ownerId);
const marker = (phase: string, details: Record<string, unknown> = {}) =>
  process.stdout.write(JSON.stringify({ phase, mode, processId: process.pid, ...details }) + "\n");
if (mode.startsWith("race-")) {
  const start = new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
  marker("ready");
  await start;
  process.stdin.pause();
  marker("acquiring");
}
const effects = existsSync(journalPath)
  ? readFileSync(journalPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  : [];
const maxAttempts = SUBAGENT_RECOVERY_MAX_AUTOMATIC_ATTEMPTS;
const prepared = await updateSessionStoreAtomic(storePath, (store) => {
  if (mode.startsWith("race-")) marker("transaction-entered");
  if (mode === "race-a") {
    const releasePath = join(dirname(storePath), "race-release");
    const wait = new Int32Array(new SharedArrayBuffer(4));
    const deadline = Date.now() + 30_000;
    while (!existsSync(releasePath)) {
      if (Date.now() > deadline) throw new Error("fixture transaction release timed out");
      Atomics.wait(wait, 0, 0, 10);
    }
  }
  const entry = store[sessionKey] ?? {
    sessionId,
    updatedAt: Date.now(),
    lifecycleRunId: ownerId,
    status: "running" as const,
    abortedLastRun: true,
  };
  if (entry.sessionId !== sessionId) throw new Error("fixture generation changed");
  const request: RecoveryAuthorityRequest = {
    requestId: idempotencyKey,
    entry: "subagent-orphan",
    owner: { kind: "subagent-run", ownerId, sessionKey, runId: ownerId },
    admission: {
      trigger: "gateway-restart",
      requiredPreState: "active-subagent-run",
      admitted: true,
      visibleOutputObserved: false,
    },
    budget: {
      attempts: { current: 0, max: maxAttempts },
      backoff: { initialMs: 5000, multiplier: 2 },
      wedge: { afterAttempts: maxAttempts, wedged: false },
    },
    replayClass: "reconcile",
    effect: effects.length ? "applied" : "not_applied",
    requestedAction: "resume",
    idempotencyKey,
    // This fixture's entire effect is an append to this fsynced local journal.
    evidence: [{ kind: "domain-journal", ref: journalPath, role: "effect-truth" }],
    requestedAt: Date.now(),
  };
  const result = prepareOwnerRecoveryAdmission(request, entry.subagentRecovery?.authority);
  if (result.record)
    entry.subagentRecovery = { ...entry.subagentRecovery, authority: result.record };
  if (result.decision.kind === "settle") {
    entry.status = "done";
    entry.abortedLastRun = false;
  }
  store[sessionKey] = entry;
  return result;
});

marker("admission-committed", prepared);
if ((mode === "effect-hold" || mode.startsWith("race-")) && prepared.admitted) {
  if (effects.length) throw new Error("fixture effect already exists");
  const fd = openSync(journalPath, "a", 0o600);
  try {
    writeSync(fd, JSON.stringify({ idempotencyKey, processId: process.pid, sequence: 1 }) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  marker("effect-before-ack");
}
closeSqliteSessionStoreDatabase(storePath);
if (mode === "hold" || mode === "effect-hold" || mode === "race-a") {
  process.stdin.resume();
  await new Promise(() => {});
}
