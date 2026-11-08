/** Proves controller restart and same-boundary admission against the existing owner store. */
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
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : process.argv[at + 1];
};
const out = resolve(
  arg(
    "--out",
    join(root, ".audit", "recovery-owner-process-proof", `${Date.now()}-${randomUUID()}`),
  ),
);
if (existsSync(out) && readdirSync(out).length)
  throw new Error("Choose a fresh proof output directory.");
mkdirSync(out, { recursive: true });
const storePath = join(out, "owner-store.json");
const journalPath = join(out, "local-effect.jsonl");
const childScript = join(root, "scripts", "recovery-owner-process-proof-child.mts");
const loader = pathToFileURL(join(root, "openclaw_runtime/node_modules/tsx/dist/loader.mjs")).href;
const sources = [
  "shared/recovery-authority/contract.ts",
  "openclaw_runtime/src/agents/recovery-authority/authority.ts",
  "openclaw_runtime/src/agents/recovery-authority/owner-admission.ts",
  "openclaw_runtime/src/agents/subagent-recovery-state.ts",
  "openclaw_runtime/src/config/sessions/store.ts",
  "openclaw_runtime/src/config/sessions/store-sqlite.ts",
  "scripts/recovery-owner-process-proof.mjs",
  "scripts/recovery-owner-process-proof-child.mts",
];
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const sourceSnapshot = sources.map((path) => ({ path, sha256: sha(join(root, path)) }));
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
const candidate = {
  commit: git("rev-parse", "HEAD"),
  tree: git("rev-parse", "HEAD^{tree}"),
  dirty: Boolean(git("status", "--porcelain")),
};
writeFileSync(
  join(out, "source-snapshot.json"),
  JSON.stringify({ candidate, files: sourceSnapshot }, null, 2),
);
const children = [];
const observations = [];

function launch(mode, ownerStore = storePath, effectJournal = journalPath) {
  const stdout = createWriteStream(join(out, `${mode}.stdout.log`));
  const stderr = createWriteStream(join(out, `${mode}.stderr.log`));
  const child = spawn(
    process.execPath,
    ["--import", loader, childScript, ownerStore, effectJournal, mode],
    {
      cwd: root,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: join(out, "state"),
        OPENCLAW_CONFIG_PATH: join(out, "unused-config.json"),
      },
    },
  );
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  const markers = [];
  const waiters = new Set();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const value = JSON.parse(line);
      if (!value.phase) return;
      assert.equal(value.processId, child.pid, "marker must belong to the actual child");
      markers.push(value);
      for (const check of waiters) check();
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
    }
  });
  const exited = new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => {
      const result = { mode, processId: child.pid, exitCode: code, signal };
      observations.push(result);
      resolveExit(result);
      for (const check of waiters) check();
    });
  });
  const target = { child, markers, exited };
  children.push(target);
  target.marker = (phase) =>
    new Promise((resolveMarker, rejectMarker) => {
      const finish = () => {
        const found = markers.find((item) => item.phase === phase);
        if (found || child.exitCode !== null || child.signalCode !== null) {
          clearTimeout(timer);
          waiters.delete(finish);
          if (found) resolveMarker(found);
          else rejectMarker(new Error(`${mode} exited before ${phase}; inspect its retained logs`));
        }
      };
      const timer = setTimeout(() => {
        waiters.delete(finish);
        rejectMarker(new Error(`${mode} did not reach ${phase} within the bounded fixture budget`));
      }, 90_000);
      waiters.add(finish);
      finish();
    });
  return target;
}

async function killAtBoundary(target) {
  assert.equal(target.child.exitCode, null, "fault requires a live owned process");
  assert(target.child.kill("SIGKILL"), "actual child must accept the fault signal");
  const exit = await waitForExit(target);
  assert.notEqual(exit.exitCode, 0);
  return exit;
}

async function waitForExit(target) {
  let timer;
  try {
    return await Promise.race([
      target.exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("owned proof process did not exit within 30s")),
          30_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

let report;
try {
  const raceStore = join(out, "race-store.json");
  const raceJournal = join(out, "race-effect.jsonl");
  const raceA = launch("race-a", raceStore, raceJournal);
  const raceB = launch("race-b", raceStore, raceJournal);
  await Promise.all([raceA.marker("ready"), raceB.marker("ready")]);
  raceA.child.stdin.write("start\n");
  await raceA.marker("transaction-entered");
  raceB.child.stdin.write("start\n");
  await raceB.marker("acquiring");
  await delay(250);
  assert(!raceB.markers.some((item) => item.phase === "transaction-entered"));
  writeFileSync(join(out, "race-release"), "release");
  const raceWinner = await raceA.marker("admission-committed");
  const raceDenied = await raceB.marker("admission-committed");
  assert.equal(raceWinner.admitted, true);
  assert.equal(raceDenied.admitted, false);
  assert.equal(raceDenied.record.attempts, 1);
  assert.equal((await waitForExit(raceB)).exitCode, 0);
  await raceA.marker("effect-before-ack");
  assert.equal(readFileSync(raceJournal, "utf8").split("\n").filter(Boolean).length, 1);
  await killAtBoundary(raceA);

  const first = launch("hold");
  const admitted = await first.marker("admission-committed");
  assert.equal(admitted.admitted, true);
  assert.equal(admitted.record.attempts, 1);
  const concurrent = launch("compete");
  const denied = await concurrent.marker("admission-committed");
  assert.equal(denied.admitted, false);
  assert.equal(denied.record.attempts, 1);
  assert.equal((await waitForExit(concurrent)).exitCode, 0);
  await killAtBoundary(first);

  const restart = launch("effect-hold");
  const resumed = await restart.marker("admission-committed");
  assert.equal(resumed.admitted, true);
  assert.equal(resumed.record.attempts, 2);
  assert.notEqual(resumed.record.processId, admitted.record.processId);
  assert.notEqual(resumed.record.ownerEpoch, admitted.record.ownerEpoch);
  await restart.marker("effect-before-ack");
  await killAtBoundary(restart);

  const reconcile = launch("settle");
  const settled = await reconcile.marker("admission-committed");
  assert.equal((await waitForExit(reconcile)).exitCode, 0);
  assert.equal(settled.admitted, false);
  assert.equal(settled.decision.kind, "settle");
  assert.equal(settled.record.state, "settled");
  assert.equal(settled.record.attempts, 2);
  const effects = readFileSync(journalPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(effects.length, 1);
  assert.equal(effects[0].idempotencyKey, admitted.record.idempotencyKey);
  assert(
    sourceSnapshot.every((file) => sha(join(root, file.path)) === file.sha256),
    "source changed during proof",
  );
  report = {
    status: "PASS",
    candidate,
    sourceSnapshot,
    observations,
    admissions: 2,
    duplicateAdmissions: 0,
    concurrentDenied: 1,
    atomicRace: {
      transactionExcludedCompetitor: true,
      admitted: 1,
      denied: 1,
      effects: 1,
      markers: [raceWinner, raceDenied],
    },
    effectCount: effects.length,
    markers: [admitted, denied, resumed, settled],
    sourceUnchanged: true,
    scope: "owner admission kernel, Session SQLite and local journal fixture",
  };
} catch (error) {
  report = {
    status: "FAIL",
    candidate,
    sourceSnapshot,
    observations,
    error: String(error),
    scope: "component proof; incomplete results are retained",
  };
  process.exitCode = 1;
} finally {
  for (const target of children) {
    if (target.child.exitCode === null && target.child.signalCode === null)
      target.child.kill("SIGKILL");
    await target.exited.catch(() => {});
  }
  writeFileSync(
    join(out, "report.json"),
    JSON.stringify(
      {
        schema: "RecoveryOwnerProcessProof/v1",
        ...report,
        driven_by: "agent",
        actor: "recovery-ga-process-proof",
        realHumanEvidence: false,
        liveQualityMeasured: false,
        cleanup: {
          activeOwnedChildren: children.filter(
            (item) => item.child.exitCode === null && item.child.signalCode === null,
          ).length,
        },
      },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify({ status: report.status, output: out }));
