/** Proves the original delivery queue's concurrent admission and restart settlement. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outIndex = process.argv.indexOf("--out");
const out = resolve(
  outIndex < 0
    ? join(root, ".audit", "recovery-delivery-process-proof", `${Date.now()}-${randomUUID()}`)
    : process.argv[outIndex + 1],
);
if (existsSync(out) && readdirSync(out).length)
  throw new Error("Choose a fresh proof output directory.");
mkdirSync(out, { recursive: true });
const sources = [
  "shared/recovery-authority/contract.ts",
  "openclaw_runtime/src/agents/recovery-authority/authority.ts",
  "openclaw_runtime/src/agents/recovery-authority/owner-admission.ts",
  "openclaw_runtime/src/agents/recovery-authority/final-delivery-session.ts",
  "openclaw_runtime/src/agents/agent-command.ts",
  "openclaw_runtime/src/agents/command/delivery.ts",
  "openclaw_runtime/src/channels/message/send.ts",
  "openclaw_runtime/src/infra/outbound/deliver.ts",
  "openclaw_runtime/src/infra/outbound/delivery-queue-storage.ts",
  "openclaw_runtime/src/infra/outbound/delivery-queue-recovery.ts",
  "openclaw_runtime/src/infra/delivery-queue-sqlite.ts",
  "openclaw_runtime/src/config/sessions/store.ts",
  "openclaw_runtime/src/config/sessions/store-sqlite.ts",
  "scripts/recovery-delivery-process-proof.mjs",
  "scripts/recovery-delivery-process-proof-child.mts",
];
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const files = sources.map((path) => ({ path, sha256: sha(join(root, path)) }));
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
const candidate = {
  commit: git("rev-parse", "HEAD"),
  tree: git("rev-parse", "HEAD^{tree}"),
  dirty: Boolean(git("status", "--porcelain")),
};
writeFileSync(
  join(out, "source-snapshot.json"),
  JSON.stringify({ candidate, files }, null, 2) + "\n",
);
const loader = pathToFileURL(join(root, "openclaw_runtime/node_modules/tsx/dist/loader.mjs")).href;
const script = join(root, "scripts/recovery-delivery-process-proof-child.mts");
const children = [],
  observations = [],
  markers = [];
let serial = 0;

function launch(mode, stateDir) {
  mkdirSync(stateDir, { recursive: true });
  const prefix = `${++serial}-${mode}`;
  const stdout = createWriteStream(join(out, `${prefix}.stdout.jsonl`));
  const stderr = createWriteStream(join(out, `${prefix}.stderr.log`));
  const child = spawn(process.execPath, ["--import", loader, script, stateDir, mode], {
    cwd: root,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_CONFIG_PATH: join(stateDir, "unused-config.json"),
      OPENCLAW_RECOVERY_AUTHORITY_MODE: "authority",
      OPENCLAW_DISABLE_BUNDLED_PLUGINS: "1",
    },
  });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  const seen = [],
    waiters = new Set();
  createInterface({ input: child.stdout }).on("line", (line) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    if (!value.phase) return;
    assert.equal(value.processId, child.pid, "Marker must identify its real child PID.");
    seen.push(value);
    markers.push(value);
    for (const check of waiters) check();
  });
  const exited = new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", (code, signal) => {
      const result = { mode, processId: child.pid, exitCode: code, signal };
      observations.push(result);
      resolveExit(result);
      for (const check of waiters) check();
    });
  });
  const target = {
    child,
    exited,
    seen,
    marker(phase) {
      return new Promise((resolveMarker, rejectMarker) => {
        const check = () => {
          const found = seen.find((item) => item.phase === phase);
          if (found || child.exitCode !== null || child.signalCode !== null) {
            clearTimeout(timer);
            waiters.delete(check);
            found
              ? resolveMarker(found)
              : rejectMarker(
                  new Error(`${mode} exited before ${phase}; inspect its retained logs.`),
                );
          }
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          rejectMarker(new Error(`${mode} did not reach ${phase} within 90s.`));
        }, 90_000);
        waiters.add(check);
        check();
      });
    },
  };
  children.push(target);
  return target;
}

async function waitExit(target) {
  let timer;
  try {
    return await Promise.race([
      target.exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Owned proof process did not exit within 30s.")),
          30_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function kill(target) {
  assert.equal(target.child.exitCode, null);
  assert(target.child.kill("SIGKILL"), "The owned fixture must accept the fault signal.");
  assert.notEqual((await waitExit(target)).exitCode, 0);
}

let report;
try {
  const raceDir = join(out, "race");
  const init = launch("init", raceDir);
  await init.marker("initialized");
  assert.equal((await waitExit(init)).exitCode, 0);
  const raceA = launch("race-a", raceDir),
    raceB = launch("race-b", raceDir);
  await Promise.all([raceA.marker("ready"), raceB.marker("ready")]);
  raceA.child.stdin.write("start\n");
  raceB.child.stdin.write("start\n");
  const race = await Promise.all([raceA.marker("admission"), raceB.marker("admission")]);
  assert.equal(race.filter((item) => item.prepared?.admitted).length, 1);
  assert(race.every((item) => item.entry.retryCount === 1));
  const winner = race[0].prepared?.admitted ? raceA : raceB;
  const loser = winner === raceA ? raceB : raceA;
  assert.equal((await waitExit(loser)).exitCode, 0);
  await kill(winner);

  const stateDir = join(out, "restart");
  const live = launch("live-hold", stateDir),
    liveEntry = await live.marker("initialized");
  const liveCompetitor = launch("compete-live", stateDir),
    liveDenied = await liveCompetitor.marker("admission");
  assert.equal(liveDenied.prepared, null);
  assert.equal(liveDenied.entry.retryCount, 0);
  assert.equal((await waitExit(liveCompetitor)).exitCode, 0);
  await kill(live);
  const reserved = launch("hold", stateDir),
    first = await reserved.marker("admission");
  assert.equal(first.prepared.admitted, true);
  assert.equal(first.entry.retryCount, 1);
  const competitor = launch("compete", stateDir),
    denied = await competitor.marker("admission");
  assert.equal(denied.prepared, null);
  assert.equal(denied.entry.retryCount, 1);
  assert.equal((await waitExit(competitor)).exitCode, 0);
  await kill(reserved);
  const effect = launch("effect-hold", stateDir),
    second = await effect.marker("admission");
  assert.equal(second.prepared.admitted, true);
  assert.equal(second.entry.retryCount, 2);
  assert.notEqual(
    first.entry.recoveryAdmission.ownerEpoch,
    second.entry.recoveryAdmission.ownerEpoch,
  );
  const appliedBoundary = await effect.marker("effect-before-ack");
  assert.equal(appliedBoundary.entry.recoveryEffect, "unknown");
  await kill(effect);
  const observer = launch("reconcile-hold", stateDir),
    observed = await observer.marker("admission");
  assert.equal(observed.prepared.admitted, false);
  assert.equal(observed.prepared.decision.kind, "reconcile");
  assert.equal(observed.entry.recoveryAdmission.processId, observer.child.pid);
  assert.equal(observed.entry.activeSendProcessId, observer.child.pid);
  assert.equal(observed.entry.retryCount, 2);
  assert.notEqual(
    observed.entry.recoveryAdmission.ownerEpoch,
    second.entry.recoveryAdmission.ownerEpoch,
  );
  const observerCompetitor = launch("compete-reconcile", stateDir),
    observerDenied = await observerCompetitor.marker("admission");
  assert.equal(observerDenied.prepared, null);
  assert.equal(observerDenied.entry.retryCount, 2);
  assert.equal((await waitExit(observerCompetitor)).exitCode, 0);
  await kill(observer);
  const uncertain = launch("unknown", stateDir),
    held = await uncertain.marker("admission");
  assert.equal(held.prepared.admitted, false);
  assert.equal(held.entry.retryCount, 2);
  assert.equal(held.entry.payloads[0].text, "original durable answer");
  const released = await uncertain.marker("reconciliation-released");
  assert.equal(released.entry.activeSendProcessId, undefined);
  assert.equal(released.entry.recoveryEffect, "unknown");
  assert.equal((await waitExit(uncertain)).exitCode, 0);
  const settler = launch("settle", stateDir),
    decision = await settler.marker("admission"),
    settled = await settler.marker("settled");
  assert.equal(decision.prepared.admitted, false);
  assert.equal(decision.prepared.decision.kind, "settle");
  assert.equal(decision.entry.retryCount, 2);
  assert.equal(settled.acked, true);
  assert.equal(settled.entry, null);
  assert.equal(settled.session.pendingFinalDeliveryText, undefined);
  assert.equal((await waitExit(settler)).exitCode, 0);
  const replay = launch("replay", stateDir),
    replayed = await replay.marker("admission");
  assert.equal(replayed.prepared, null);
  assert.equal(replayed.entry, null);
  assert.equal((await waitExit(replay)).exitCode, 0);
  const effects = readFileSync(join(stateDir, "effect.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(effects.length, 1);
  assert.equal(effects[0].intentId, liveEntry.entry.id);
  assert(files.every((file) => sha(join(root, file.path)) === file.sha256));
  report = {
    status: "PASS",
    concurrentAdmissions: 1,
    duplicateAdmissions: 0,
    concurrentReconciliationOwners: 1,
    duplicateReconciliationAdmissions: 0,
    reconciliationOwnerRebound: true,
    completedReconciliationReleased: true,
    effectCount: effects.length,
    attemptsAfterRestart: decision.entry.retryCount,
    unknownReplyRetained: true,
    originalIntentReused: true,
    pendingReplySettled: true,
    sourceUnchanged: true,
  };
} catch (error) {
  process.exitCode = 1;
  report = { status: "FAIL", error: String(error) };
} finally {
  for (const target of children) {
    if (target.child.exitCode === null && target.child.signalCode === null)
      target.child.kill("SIGKILL");
    await waitExit(target).catch(() => {});
  }
  writeFileSync(
    join(out, "report.json"),
    JSON.stringify(
      {
        schema: "RecoveryDeliveryProcessProof/v1",
        driven_by: "agent",
        actor: "codex/recovery-delivery-process-proof",
        realHumanEvidence: false,
        scope:
          "Production queue admission and Session reference; actual PID interruption and SQLite; controlled local journal effect.",
        candidate,
        source: files,
        observations,
        markers,
        ...report,
        cleanup: {
          activeOwnedChildren: children.filter(
            (item) => item.child.exitCode === null && item.child.signalCode === null,
          ).length,
        },
      },
      null,
      2,
    ) + "\n",
  );
}
console.log(JSON.stringify({ status: report.status, out }));
