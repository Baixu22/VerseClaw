import { fork, execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");

const output = resolve(
  process.env.TASK_SYSTEM_EVIDENCE_DIR ?? join(tmpdir(), "durable-task-system-evidence"),
);
await mkdir(output, { recursive: true });
const bundle = join(output, "task-store.cjs");
await build({
  entryPoints: ["shared/task-system/store.ts"],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
});
const identityBundle = join(output, "task-identity.cjs");
await build({
  entryPoints: ["shared/task-system/identity.ts"],
  outfile: identityBundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
});
const { TaskSystemStore } = require(bundle);
const { resolveTaskDomain } = require(identityBundle);
const root = await mkdtemp(join(output, "repository-"));
const git = (...args) => execFileSync("git", args, { cwd: root, windowsHide: true, stdio: "pipe" });
git("init");
git(
  "-c",
  "user.name=Agent",
  "-c",
  "user.email=agent@example.invalid",
  "commit",
  "--allow-empty",
  "-m",
  "task fixture",
);
const linked = join(root, "linked");
git("worktree", "add", "--detach", linked);
const domain = resolveTaskDomain(root);
const store = new TaskSystemStore(domain);
const contract = (objective) => ({
  objective,
  target: "source.txt",
  constraints: ["Keep the goal after compaction"],
  acceptance: [
    {
      id: "review",
      description: "Independent behavior check",
      verification: { kind: "owner-receipt", owner: "fixture-verifier" },
    },
  ],
});
const contested = store.create(contract("One shared implementation"), "contested").task.contract
  .taskNodeId;
const worker = join(output, "worker.cjs");
await writeFile(
  worker,
  `const {TaskSystemStore}=require(process.argv[2]);const {resolveTaskDomain}=require(process.argv[3]);const s=new TaskSystemStore(resolveTaskDomain(process.argv[4]));process.send({ready:true});process.on('message',()=>{let r;try{const v=s.claim(process.argv[5],process.argv[6],'generation',process.argv[6]);r={granted:true,claim:v.claim};}catch(e){r={granted:false,error:e.message};}finally{s.close();}process.send(r,()=>process.exit(0));});`,
);
const children = [];
const ready = [];
const results = [];
for (let i = 0; i < 16; i++) {
  const child = fork(
    worker,
    [bundle, identityBundle, i % 2 ? linked : root, contested, `worker-${i}`],
    { cwd: root, windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  children.push(child);
  ready.push(
    new Promise((res, rej) => {
      child.once("error", rej);
      child.once("message", res);
    }),
  );
  results.push(
    new Promise((res, rej) => {
      child.on("message", (message) => {
        if (!message.ready) child.result = message;
      });
      child.once("error", rej);
      child.once("exit", (code) =>
        code === 0 && child.result
          ? res({ ...child.result, exitCode: code })
          : rej(new Error(`worker exit ${code}`)),
      );
    }),
  );
}
const timer = setTimeout(() => {
  for (const child of children) child.kill();
}, 30_000);
let outcomes;
try {
  await Promise.all(ready);
  for (const child of children) child.send("go");
  outcomes = await Promise.all(results);
} finally {
  clearTimeout(timer);
}
assert.equal(outcomes.filter((x) => x.granted).length, 1);
assert.equal(outcomes.filter((x) => !x.granted).length, 15);
const crashedTask = store.create(
  contract("Recover partial output after process exit"),
  "crash-case",
).task.contract.taskNodeId;
const crashWorker = join(output, "crash-worker.cjs");
await writeFile(
  crashWorker,
  `const fs=require('node:fs');const {TaskSystemStore}=require(process.argv[2]);const {resolveTaskDomain}=require(process.argv[3]);const s=new TaskSystemStore(resolveTaskDomain(process.argv[4]));const c=s.claim(process.argv[5],'crashed-writer','generation','crash-claim').claim;s.beginOperation(c,'crashed-operation','write');fs.writeFileSync(process.argv[6],'partial artifact');process.exit(23);`,
);
const crashPath = join(root, "partial.txt");
const crash = spawnSync(
  process.execPath,
  [crashWorker, bundle, identityBundle, root, crashedTask, crashPath],
  { windowsHide: true, stdio: "pipe" },
);
assert.equal(crash.status, 23);
assert.equal(store.get(crashedTask).pendingOperations, 1);
const recoveredStore = new TaskSystemStore(domain, () => Date.now() + 120_001);
const recovered = recoveredStore.recover(crashedTask, "recovery-session", "new-generation", root);
assert.equal(recovered.pendingOperations, 0);
assert.equal(recovered.claim.sessionKey, "recovery-session");
assert.ok(recovered.checkpoint.unresolved.some((x) => x.includes("crashed-operation")));
assert.equal(await readFile(crashPath, "utf8"), "partial artifact");
recoveredStore.close();
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
const measurements = [];
for (const count of [1_000, 10_000]) {
  const before = performance.now();
  // Seed through the production creation path, with distinct objectives.
  for (let i = measurements.length ? 1_000 : 0; i < count; i++)
    store.create(contract(`Task ${i}`), `seed-${i}`);
  const seedMs = performance.now() - before;
  const reads = [],
    claims = [],
    contexts = [],
    renews = [],
    pages = [],
    suggestions = [];
  for (let i = 0; i < 100; i++) {
    const view = store.create(contract(`measure-${count}-${i}`), `measure-${count}-${i}`).task;
    let t = performance.now();
    store.get(view.contract.taskNodeId);
    reads.push(performance.now() - t);
    t = performance.now();
    store.claim(
      view.contract.taskNodeId,
      `measure-session-${count}-${i}`,
      "g",
      `claim-${count}-${i}`,
    );
    claims.push(performance.now() - t);
    t = performance.now();
    const context = store.context(`measure-session-${count}-${i}`, "g");
    contexts.push(performance.now() - t);
    assert.ok(context.length < 12_000);
    t = performance.now();
    store.control(store.get(view.contract.taskNodeId).claim, "renew");
    renews.push(performance.now() - t);
    t = performance.now();
    assert.equal(store.page({ limit: 50 }).tasks.length, 50);
    pages.push(performance.now() - t);
    t = performance.now();
    assert.ok(store.suggest("Task").length <= 5);
    suggestions.push(performance.now() - t);
  }
  const stats = (values) => ({ p50: percentile(values, 0.5), p95: percentile(values, 0.95) });
  measurements.push({
    tasks: count,
    seedMs,
    read: stats(reads),
    claim: stats(claims),
    context: stats(contexts),
    renew: stats(renews),
    page50: stats(pages),
    suggest500: stats(suggestions),
    databaseBytes: (await stat(domain.database)).size,
  });
}
const history = store.history(contested);
assert.ok(history.some((x) => x.kind === "claimed"));
store.close();
const report = {
  schema: "DurableTaskSystemMeasurement/v1",
  driven_by: "agent",
  actor: "codex-durable-task-system",
  node: process.version,
  platform: process.platform,
  repository: root,
  worktrees: [root, linked],
  contenders: 16,
  granted: 1,
  denied: 15,
  outcomes,
  measurements,
  crashRecovery: {
    exitCode: crash.status,
    pendingBefore: 1,
    pendingAfter: recovered.pendingOperations,
    partialArtifactPreserved: true,
    uncertainWriteRecorded: true,
  },
  scope:
    "Local Windows, two actual Git worktrees, production SQLite store; timings in milliseconds",
  passed: true,
};
await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
const readback = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
assert.equal(readback.passed, true);
console.log(
  JSON.stringify({ report: join(output, "report.json"), measurements, granted: 1, denied: 15 }),
);
