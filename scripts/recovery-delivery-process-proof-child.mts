// Agent-driven component fixture: production queue admission, real SQLite/PIDs, one fsynced local effect.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  loadSessionStore,
  updateSessionStoreAtomic,
} from "../openclaw_runtime/src/config/sessions.js";
import {
  bindPendingFinalDeliveryIntent,
  pendingFinalDeliveryIdentity,
} from "../openclaw_runtime/src/agents/recovery-authority/final-delivery-session.js";
import { getRecoveryAdmissionIdentity } from "../openclaw_runtime/src/agents/recovery-authority/owner-admission.js";
import { isEntryEligibleForRecoveryRetry } from "../openclaw_runtime/src/infra/outbound/delivery-queue-recovery.js";
import {
  ackDelivery,
  admitQueuedDeliveryRecovery,
  enqueueDelivery,
  finishQueuedDeliveryRecovery,
  loadPendingDelivery,
  markDeliveryPlatformOutcomeUnknown,
  markDeliveryPlatformSendAttemptStarted,
  queuedDeliveryEffect,
  recordQueuedDeliveryEffect,
} from "../openclaw_runtime/src/infra/outbound/delivery-queue-storage.js";
import { closeOpenClawAgentDatabasesForTest } from "../openclaw_runtime/src/state/openclaw-agent-db.js";
import { closeOpenClawStateDatabase } from "../openclaw_runtime/src/state/openclaw-state-db.js";

const [stateDir, mode] = process.argv.slice(2);
if (
  !stateDir ||
  !mode ||
  ![
    "init",
    "inspect",
    "live-hold",
    "hold",
    "compete-live",
    "compete",
    "effect-hold",
    "unknown",
    "reconcile-hold",
    "compete-reconcile",
    "settle",
    "replay",
    "race-a",
    "race-b",
  ].includes(mode)
) {
  throw new Error("Choose a state directory and a delivery proof mode.");
}
const key = "agent:main:delivery-process-proof";
const storePath = join(stateDir, "sessions.json");
const intentPath = join(stateDir, "intent.json");
const journalPath = join(stateDir, "effect.jsonl");
const marker = (phase: string, data: Record<string, unknown> = {}) =>
  process.stdout.write(JSON.stringify({ phase, mode, processId: process.pid, ...data }) + "\n");
const hold = async () => {
  process.stdin.resume();
  await new Promise<void>(() => {});
};

if (mode === "init" || mode === "live-hold") {
  const session = {
    sessionId: "delivery-generation",
    updatedAt: 1,
    lifecycleRunId: "producer-run",
    pendingFinalDelivery: true,
    pendingFinalDeliveryText: "original durable answer",
    pendingFinalDeliveryRunId: "producer-run",
    pendingFinalDeliveryCreatedAt: 1,
    pendingFinalDeliveryContext: { channel: "telegram", to: "fixture-chat" },
  };
  await updateSessionStoreAtomic(storePath, (store) => {
    store[key] = session;
  });
  const binding = { storePath, sessionKey: key, expected: pendingFinalDeliveryIdentity(session) };
  const id = await enqueueDelivery(
    {
      channel: "telegram",
      to: "fixture-chat",
      payloads: [{ text: "original durable answer" }],
      session: { key },
      pendingFinalDelivery: binding,
    },
    stateDir,
    { activeSend: mode === "live-hold" },
  );
  await bindPendingFinalDeliveryIntent({
    ...binding,
    intent: { id, channel: "telegram", to: "fixture-chat", queuePolicy: "required" },
  });
  writeFileSync(intentPath, JSON.stringify({ id }) + "\n");
  marker("initialized", {
    entry: await loadPendingDelivery(id, stateDir),
    session: loadSessionStore(storePath, { skipCache: true })[key],
  });
  if (mode === "live-hold") await hold();
} else if (mode === "inspect") {
  const { id } = JSON.parse(readFileSync(intentPath, "utf8")) as { id: string };
  marker("inspection", { entry: await loadPendingDelivery(id, stateDir) });
} else {
  if (mode.startsWith("race-")) {
    const start = new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
    marker("ready");
    await start;
    process.stdin.pause();
  }
  const { id } = JSON.parse(readFileSync(intentPath, "utf8")) as { id: string };
  let entry = await loadPendingDelivery(id, stateDir);
  if (entry && mode === "effect-hold" && queuedDeliveryEffect(entry) === "not_applied") {
    const eligibility = isEntryEligibleForRecoveryRetry(entry, Date.now());
    if (!eligibility.eligible) {
      marker("backoff", { remainingMs: eligibility.remainingBackoffMs });
      await delay(eligibility.remainingBackoffMs);
      entry = await loadPendingDelivery(id, stateDir);
    }
  }
  if (entry && mode === "settle") {
    const effects = readFileSync(journalPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { intentId: string });
    if (effects.length !== 1 || effects[0]?.intentId !== id)
      throw new Error("The local effect journal must prove exactly this original intent.");
    entry = recordQueuedDeliveryEffect(entry, "applied", stateDir);
  }
  const prepared = entry ? admitQueuedDeliveryRecovery(entry, stateDir) : null;
  marker("admission", { prepared, entry: await loadPendingDelivery(id, stateDir) });
  if (prepared?.admitted && mode === "effect-hold") {
    if (existsSync(journalPath) && readFileSync(journalPath, "utf8").trim())
      throw new Error("Duplicate local delivery effect.");
    const identity = getRecoveryAdmissionIdentity(prepared.record);
    await markDeliveryPlatformSendAttemptStarted(id, stateDir, identity);
    appendFileSync(
      journalPath,
      JSON.stringify({ intentId: id, processId: process.pid, sequence: 1 }) + "\n",
      { flush: true },
    );
    await markDeliveryPlatformOutcomeUnknown(id, stateDir, identity);
    marker("effect-before-ack", { entry: await loadPendingDelivery(id, stateDir) });
    await hold();
  } else if (prepared?.decision.kind === "settle") {
    const acked = await ackDelivery(id, stateDir, prepared.entry);
    marker("settled", {
      acked,
      entry: await loadPendingDelivery(id, stateDir),
      session: loadSessionStore(storePath, { skipCache: true })[key],
    });
  } else if (prepared && mode === "unknown") {
    finishQueuedDeliveryRecovery(prepared.entry, "controlled reconciliation unresolved", stateDir);
    marker("reconciliation-released", { entry: await loadPendingDelivery(id, stateDir) });
  } else if (prepared?.decision.kind === "reconcile" && mode === "reconcile-hold") {
    await hold();
  } else if (mode === "hold" || (mode.startsWith("race-") && prepared?.admitted)) {
    await hold();
  }
}
closeOpenClawAgentDatabasesForTest();
closeOpenClawStateDatabase();
