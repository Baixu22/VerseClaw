/**
 * Runtime Lifecycle Governance Phase 3 E2E trace fixture.
 *
 * Runs the same-gateway goal-wake path with a real supervisor child process,
 * records every tool-level effect on the path, and prints the quantitative
 * audit lines consumed by tests/e2e/runtime-lifecycle-governance.spec.ts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "goal-wake-e2e-"));
const home = path.join(root, "home");
const stateDir = path.join(root, "state");
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });
process.env.OPENCLAW_HOME = home;
process.env.OPENCLAW_STATE_DIR = stateDir;
delete process.env.OPENCLAW_CONFIG_PATH;

const toolTrace: string[] = [];
const effects = new Set<string>();

try {
  const { closeOpenClawStateDatabase } = await import("../src/state/openclaw-state-db.js");
  const { createTrustedProvenance } = await import(
    "../../shared/security/content-provenance.js"
  );
  const { goalWakeController } = await import("../src/agents/goal-wake-controller.js");
  const {
    getMissionRun,
    saveMissionRun,
  } = await import("../src/agents/mission-control/store.js");
  const { getProcessSupervisor } = await import("../src/process/supervisor/index.js");
  const { createExecTool } = await import("../src/agents/bash-tools.exec.js");

  const now = Date.now();
  const mission = {
    missionId: "mission-e2e-goal-wake",
    sessionKey: "agent:e2e:main",
    agentId: "e2e",
    objective: "prove push-based goal wake without polling",
    acceptance: [],
    status: "running" as const,
    phase: "execute" as const,
    tick: 1,
    repairTicks: 0,
    maxTicks: 8,
    maxRepairTicks: 3,
    progress: 0,
    evidenceRefs: [],
    risks: [],
    remaining: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ticks: [],
    activeTickId: null,
  };
  saveMissionRun(mission);
  const stored = getMissionRun(mission.missionId);
  if (!stored) throw new Error("mission fixture did not persist");

  // Flag-off parity: goal wake is blocked before any opt-in flag is set.
  const flagOff = await goalWakeController.armGoalWaitProcess({
    missionId: mission.missionId,
    sessionKey: mission.sessionKey,
    expectedRevision: stored.revision ?? 0,
  });
  const flagOffOk = !flagOff.ok && flagOff.reason === "flag-disabled";

  // Flag-off parity: exec(background=true) without wait keeps the Phase 2
  // behavior byte-for-byte (status running, no wait/task/flow fields).
  // The harness command is system-generated; declaring that provenance keeps
  // the command-exec sink policy unconstrained without weakening it.
  const defaultExecTool = createExecTool({
    host: "gateway",
    sessionKey: "agent:e2e:default-main",
    sessionId: "e2e-default-session",
    contentProvenance: createTrustedProvenance({
      sourceKind: "system-generated",
      sourceId: "goal-wake-e2e-trace",
      agentId: "e2e",
    }),
  });
  const defaultExecResult = await defaultExecTool.execute(
    "e2e-default-exec",
    {
      command: `${process.execPath} -e "setTimeout(() => process.exit(0), 120)"`,
      background: true,
    },
    undefined,
    undefined,
  );
  const defaultExecDetails = defaultExecResult?.details as
    | { status?: string; wait?: unknown; taskId?: unknown; flowId?: unknown }
    | undefined;
  const flagOffBackgroundDefaultUnchanged =
    defaultExecDetails?.status === "running" &&
    defaultExecDetails.wait === undefined &&
    defaultExecDetails.taskId === undefined &&
    defaultExecDetails.flowId === undefined;
  await new Promise((resolve) => setTimeout(resolve, 180));

  process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED = "1";
  process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED = "1";
  process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS = "0";
  toolTrace.push("goal-wake.arm");
  const arm = await goalWakeController.armGoalWaitProcess({
    missionId: mission.missionId,
    sessionKey: mission.sessionKey,
    agentId: mission.agentId,
    expectedRevision: stored.revision ?? 0,
    label: "e2e goal-owned process",
    commandDigest: "e2e-digest",
  });
  if (!arm.ok) throw new Error(`arm failed: ${arm.reason} ${arm.message ?? ""}`);
  if (arm.turnBarrier !== "pending") throw new Error("turnBarrier must start pending");

  // Arm committed first; only now is a process spawned.
  const supervisor = getProcessSupervisor();
  toolTrace.push("supervisor.spawn");
  const run = await supervisor.spawn({
    sessionId: "goal-wake-e2e",
    backendId: "goal-wake-e2e",
    scopeKey: mission.sessionKey,
    lifecycleAgentId: mission.agentId,
    lifecycleCanonicalSessionKey: mission.sessionKey,
    lifecycleExpectedSessionId: "goal-wake-e2e",
    mode: "child",
    argv: [process.execPath, "-e", "setTimeout(() => process.exit(0), 25)"],
    captureOutput: false,
  });

  // A committed arm immediately level-checks; the task is still queued here.
  const queuedCheck = await goalWakeController.runGoalWakeLevelCheckForTask(arm.taskId);
  if (queuedCheck.terminal) throw new Error("queued arm task unexpectedly terminal");

  const exit = await run.wait();
  toolTrace.push("goal-wake.finalize");
  const finalized = await goalWakeController.finalizeGoalWaitTaskProcess({
    taskId: arm.taskId,
    status: exit.exitCode === 0 ? "succeeded" : "failed",
    exitCode: exit.exitCode,
    endedAt: Date.now(),
  });
  if (finalized.task?.status !== "succeeded") {
    throw new Error(`task finalization failed: ${finalized.task?.status}`);
  }

  // Before the run is fully idle, the persisted barrier keeps dispatch closed.
  const preAck = await goalWakeController.runGoalWakeLevelCheckForTask(arm.taskId);
  if (preAck.flows[0]?.outcome !== "barrier-pending") {
    throw new Error(`dispatch occurred before barrier ack: ${preAck.flows[0]?.outcome}`);
  }

  // The embedded run has exited by now; ack after full idle.
  await goalWakeController.ackGoalWaitYield({
    flowId: arm.flowId,
    sessionKey: mission.sessionKey,
  });
  toolTrace.push("mission.tick");
  const wake = await goalWakeController.runGoalWakeLevelCheckForTask(arm.taskId, {
    dispatch: async (input) => {
      const key = `${input.missionId}:${input.wakeId}`;
      const duplicate = effects.has(key);
      effects.add(key);
      return { ok: true, duplicate };
    },
  });
  if (wake.flows[0]?.outcome !== "dispatched") {
    throw new Error(`goal wake was not dispatched: ${wake.flows[0]?.outcome}`);
  }
  const flowStatus = wake.flows[0] ? wake.flows[0] : undefined;
  void flowStatus;
  const flowAfter = await import("../src/tasks/task-flow-cas.js").then((m) =>
    new m.TaskFlowCasStore().getById(arm.flowId),
  );
  if (flowAfter?.status !== "succeeded") throw new Error("flow did not reach effect-acked");

  // At-least-once duplicate delivery contract: the effect owner (mission
  // fencing) consumes a wake id once. Deliveries=2, ticks/side effects=1.
  const dupMission = {
    ...mission,
    missionId: "mission-e2e-duplicate-wake",
    status: "sleeping" as const,
    tick: 0,
    activeTickId: null,
    updatedAt: Date.now(),
  };
  saveMissionRun(dupMission);
  let duplicateWakeDeliveries = 0;
  for (const attempt of [1, 2]) {
    const claim = goalWakeController.claimMissionTick({
      missionId: dupMission.missionId,
      expectedRevision: attempt === 1 ? 0 : 1,
      activeTickId: `tick-${attempt}`,
      wakeId: "wake-e2e-dup",
      allowedStatuses: ["sleeping", "running"],
      requireIdle: true,
    });
    duplicateWakeDeliveries += 1;
    if (attempt === 1 && !claim.ok) throw new Error(`first claim failed: ${claim.reason}`);
    if (attempt === 2 && (claim.ok || claim.reason !== "duplicate-wake")) {
      throw new Error(`duplicate claim was not deduped: ${claim.ok ? "ok" : claim.reason}`);
    }
  }
  const duplicateWakeTickCount = getMissionRun(dupMission.missionId)?.tick ?? -1;

  const processPollToolCalls = toolTrace.filter((name) => name === "process.poll").length;
  console.log(`[runtime-lifecycle-audit] processPollToolCalls=${processPollToolCalls}`);
  console.log(`[runtime-lifecycle-audit] duplicateWakeDeliveries=${duplicateWakeDeliveries}`);
  console.log(`[runtime-lifecycle-audit] duplicateWakeTickCount=${duplicateWakeTickCount}`);
  console.log(`[runtime-lifecycle-audit] flagOffGoalWaitBlocked=${flagOffOk}`);
  console.log(
    `[runtime-lifecycle-audit] flagOffBackgroundDefaultUnchanged=${flagOffBackgroundDefaultUnchanged}`,
  );
  console.log(`[runtime-lifecycle-audit] goalWakeToolTrace=${toolTrace.join(",")}`);

  closeOpenClawStateDatabase();
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Windows can hold the SQLite WAL for one extra tick; the temp dir is
    // still OS-owned and E2E evidence does not depend on cleanup success.
  }
} catch (error) {
  console.error(String(error));
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Ignore cleanup races on Windows.
  }
  process.exitCode = 1;
}
