import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { updateSessionStoreAtomic } from "../openclaw_runtime/src/config/sessions/store.js";
import { closeOpenClawAgentDatabasesForTest } from "../openclaw_runtime/src/state/openclaw-agent-db.js";
import {
  closeOpenClawStateDatabase,
  openOpenClawStateDatabase,
} from "../openclaw_runtime/src/state/openclaw-state-db.js";
import { armGoalWaitProcess } from "../openclaw_runtime/src/agents/goal-wake-arm.js";
import { ackGoalWaitYield } from "../openclaw_runtime/src/agents/goal-wake-runtime.js";
import { createDurableHelperIntent } from "../openclaw_runtime/src/agents/goal-wake-helper-protocol.js";
import { spawnDurableHelperProcess } from "../openclaw_runtime/src/agents/goal-wake-helper-host.js";
import { runGoalWakeHelperEntry } from "../openclaw_runtime/src/agents/goal-wake-helper-entry.js";
import { runDurableHelperSweepOnce } from "../openclaw_runtime/src/agents/goal-wake-recovery.js";
import {
  claimMissionTick,
  finishMissionTick,
} from "../openclaw_runtime/src/agents/goal-wake-fencing.js";
import {
  getMissionRun,
  saveMissionRun,
} from "../openclaw_runtime/src/agents/mission-control/store.js";
import type { MissionRunRecord } from "../openclaw_runtime/src/agents/mission-control/types.js";
import type { GoalWakeDispatch } from "../openclaw_runtime/src/agents/goal-wake-types.js";

const missionId = "g3-native-goal-mission";
const sessionKey = "agent:main:g3-native-goal";
const runId = "run_g3_native_goal";
const home = process.argv[2];
const mode = process.argv[3];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let keepAlive: ReturnType<typeof setInterval> | undefined;

function report(type: string, extra = {}) {
  const { db, path: databasePath } = openOpenClawStateDatabase();
  const task = db.prepare("SELECT * FROM task_runs WHERE run_id = ?").get(runId);
  const mission = db.prepare("SELECT * FROM mission_runs WHERE mission_id = ?").get(missionId);
  process.stdout.write(
    JSON.stringify({ type, pid: process.pid, databasePath, task, mission, ...extra }) + "\n",
  );
}

async function hold(): Promise<never> {
  keepAlive ??= setInterval(() => {}, 1000);
  return await new Promise<never>(() => {});
}

async function proof() {
  fs.mkdirSync(home, { recursive: true });
  const store = path.join(home, "agents/main/sessions/sessions.json");
  const cfg = { session: { store } };
  const options = { rootDir: path.join(home, "background-processes") };
  if (mode === "launch") {
    keepAlive = setInterval(() => {}, 1000);
    await updateSessionStoreAtomic(store, (sessions) => {
      sessions[sessionKey] = { sessionId: "native-goal-generation", updatedAt: 1 };
    });
    const now = Date.now();
    const mission: MissionRunRecord = {
      missionId,
      sessionKey,
      agentId: "main",
      objective: "native durable helper restart proof",
      acceptance: [],
      status: "running",
      phase: "execute",
      tick: 0,
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
    const command =
      "const fs=require('node:fs'),p=require('node:path'),home=process.argv[1];const t=setInterval(()=>{if(!fs.existsSync(p.join(home,'release-effect')))return;clearInterval(t);const f=fs.openSync(p.join(home,'effects.jsonl'),'a');fs.writeSync(f,JSON.stringify({effect:'helper-command',driven_by:'agent'})+'\\n');fs.fsyncSync(f);fs.closeSync(f);},20);";
    const argv = [process.execPath, "-e", command, home];
    const commandDigest = createHash("sha256").update(JSON.stringify(argv)).digest("hex");
    const ownerEpoch = createHash("sha256")
      .update(`native-goal-generation\u0000${missionId}`)
      .digest("hex");
    const intent = await createDurableHelperIntent(
      { runId, commandDigest, ownerEpoch, policyRevision: "runtime-lifecycle-phase4-v1" },
      options,
    );
    const arm = await armGoalWaitProcess(
      {
        missionId,
        sessionKey,
        agentId: "main",
        expectedRevision: 0,
        commandDigest,
        durableRun: {
          runId,
          nonce: intent.nonce,
          ownerEpoch,
          policyRevision: intent.policyRevision,
        },
      },
      cfg,
    );
    if (!arm.ok) throw new Error(`Goal wait arm failed: ${arm.reason}`);
    await ackGoalWaitYield({ flowId: arm.flowId, sessionKey });
    const childFile = fileURLToPath(import.meta.url);
    const handle = await spawnDurableHelperProcess({
      runId,
      rootDir: options.rootDir,
      nonce: intent.nonce,
      ownerEpoch,
      commandDigest,
      argv,
      env: { TEMP: "D:/tmp", TMP: "D:/tmp", SystemRoot: process.env.SystemRoot },
      cwd: home,
      timeoutMs: 45000,
      launch: {
        file: process.execPath,
        args: [
          "--import",
          pathToFileURL(path.join(root, "openclaw_runtime/node_modules/tsx/dist/loader.mjs")).href,
          childFile,
        ],
      },
    });
    const started = await handle.started;
    if (!started) throw new Error("The original helper did not start.");
    await runDurableHelperSweepOnce({ options, cfg });
    report("helper-running", { started, arm });
    await hold();
  }
  const dispatch: GoalWakeDispatch = async (input) => {
    if (mode === "before-wake") {
      report("task-terminal-before-wake");
      await hold();
    }
    const mission = getMissionRun(missionId);
    if (!mission) return { ok: false, reason: "mission-missing", retryable: false };
    const tickId = `tick_${randomUUID()}`;
    const claim = claimMissionTick({
      missionId,
      expectedRevision: mission.revision ?? 0,
      activeTickId: tickId,
      wakeId: input.wakeId,
      allowedStatuses: ["running", "sleeping"],
      requireIdle: true,
    });
    if (!claim.ok)
      return claim.reason === "duplicate-wake"
        ? { ok: true, duplicate: true }
        : { ok: false, reason: claim.reason, retryable: true };
    const fd = fs.openSync(path.join(home, "wake-effects.jsonl"), "a");
    fs.writeSync(fd, JSON.stringify({ wakeId: input.wakeId, tickId, driven_by: "agent" }) + "\n");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    const finished = finishMissionTick({
      missionId,
      expectedRevision: claim.revision,
      activeTickId: tickId,
      lastWakeId: input.wakeId,
      status: "running",
    });
    if (!finished.ok) throw new Error(`Mission tick finish failed: ${finished.reason}`);
    return { ok: true, duplicate: false };
  };
  const outcomes = await runDurableHelperSweepOnce({ options, cfg, dispatch });
  report("observed", { outcomes });
}

try {
  if (home === "goal-wake-helper-run") process.exitCode = await runGoalWakeHelperEntry();
  else await proof();
} finally {
  if (keepAlive) clearInterval(keepAlive);
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabase();
}
