import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freezeOrchestrationCandidate } from "../../openclaw_runtime/src/agents/orchestration-candidate";
import { createWorktreeService, __resetWorktreeRegistry, writeWorktreeFile } from "../../openclaw_runtime/src/agents/worktree-service";

const roots: string[] = [];
afterEach(async () => {
  __resetWorktreeRegistry();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}
async function makeRepo(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "versegit-e1-"));
  roots.push(root);
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.email", "agent@example.invalid"]);
  git(root, ["config", "user.name", "Agent"]);
  await writeFile(join(root, ".gitignore"), ".openclaw/\n", "utf8");
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, ...rel.split("/"));
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "base"]);
  return root;
}
function state(root: string) {
  return {
    head: git(root, ["rev-parse", "HEAD"]),
    refs: git(root, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]),
    status: git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
  };
}
function makeWorkers(root: string, specs: Record<string, string[]>) {
  const service = createWorktreeService(root, { backend: "git" });
  const workers = Object.entries(specs).map(([id, writeSet], index) => {
    const record = service.create(id, { writeSet });
    return { taskNodeId: `task-${id}`, worktreePath: record.root, worktreeRole: id, declaredWriteSet: writeSet, parentOrder: index };
  });
  return { service, workers };
}
function tsc(cwd: string) {
  return spawnSync(process.execPath, [join(process.cwd(), "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json", "--pretty", "false"], { cwd, encoding: "utf8", windowsHide: true, timeout: 30_000 });
}
function tscFiles(cwd: string, files: string[]) {
  return spawnSync(process.execPath, [join(process.cwd(), "node_modules", "typescript", "bin", "tsc"), "--strict", "--noEmit", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", ...files], { cwd, encoding: "utf8", windowsHide: true, timeout: 30_000 });
}

describe("E1 host Git candidate freeze", () => {
  it("freezes two real worker changes into a disposable candidate without touching main or refs", async () => {
    const root = await makeRepo({ "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n" });
    const { workers } = makeWorkers(root, { a: ["src/a.ts"], b: ["src/b.ts"] });
    writeWorktreeFile(workers[0]!.worktreePath, "src/a.ts", "export const a = 2;\n");
    writeWorktreeFile(workers[1]!.worktreePath, "src/b.ts", "export const b = 2;\n");
    const before = state(root);
    const result = freezeOrchestrationCandidate({ baseRoot: root, workers, expectedBaseOid: before.head });
    expect(result.status).toBe("frozen");
    if (result.status !== "frozen") return;
    expect(result.manifest).toMatchObject({ schema: "clawx.versegit.candidate/v1", mainUnchanged: true, verificationCwdRole: "host-disposable-candidate" });
    expect(result.manifest.workerSnapshots).toHaveLength(2);
    expect(await readFile(join(result.materializedPath, "src/a.ts"), "utf8")).toContain("a = 2");
    expect(await readFile(join(result.materializedPath, "src/b.ts"), "utf8")).toContain("b = 2");
    expect(await readFile(join(root, "src/a.ts"), "utf8")).toContain("a = 1");
    expect(state(root)).toEqual(before);
  });

  it("turns the independent-worker / combined-failure counterexample into a frozen candidate, not a merge", async () => {
    const baseProducer = "export function api(): number { return 1; }\n";
    const baseConsumer = "import { api } from './producer.js';\nconst value: number = api();\nconsole.log(value);\n";
    const tsconfig = JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext" }, include: ["src/**/*.ts"] }, null, 2);
    const root = await makeRepo({ "src/producer.ts": baseProducer, "src/consumer-a.ts": baseConsumer, "src/consumer-b.ts": baseConsumer, "tsconfig.json": tsconfig });
    const { workers } = makeWorkers(root, { a: ["src/producer.ts", "src/consumer-a.ts"], b: ["src/consumer-b.ts"] });
    writeWorktreeFile(workers[0]!.worktreePath, "src/producer.ts", "export function api(): string { return 'one'; }\n");
    writeWorktreeFile(workers[0]!.worktreePath, "src/consumer-a.ts", "import { api } from './producer.js';\nconst value: string = api();\nconsole.log(value);\n");
    writeWorktreeFile(workers[1]!.worktreePath, "src/consumer-b.ts", "// independently safe against the base producer\nimport { api } from './producer.js';\nconst value: number = api();\nconsole.log(value);\n");
    expect(tscFiles(workers[0]!.worktreePath, ["src/producer.ts", "src/consumer-a.ts"]).status).toBe(0);
    expect(tscFiles(workers[1]!.worktreePath, ["src/producer.ts", "src/consumer-b.ts"]).status).toBe(0);
    const before = state(root);
    const result = freezeOrchestrationCandidate({ baseRoot: root, workers, expectedBaseOid: before.head });
    expect(result.status).toBe("frozen");
    if (result.status !== "frozen") return;
    expect(tsc(result.materializedPath).status).not.toBe(0);
    expect(state(root)).toEqual(before);
    expect(await readFile(join(root, "src/producer.ts"), "utf8")).toBe(baseProducer);
  });

  it("reports merge conflicts, user dirt, unexpected untracked files and base drift without mutation", async () => {
    const conflictRoot = await makeRepo({ "src/shared.ts": "export const value = 'base';\n" });
    const conflict = makeWorkers(conflictRoot, { a: ["src/shared.ts"], b: ["src/shared.ts"] });
    writeWorktreeFile(conflict.workers[0]!.worktreePath, "src/shared.ts", "export const value = 'a';\n");
    writeWorktreeFile(conflict.workers[1]!.worktreePath, "src/shared.ts", "export const value = 'b';\n");
    const conflictBefore = state(conflictRoot);
    const conflictResult = freezeOrchestrationCandidate({ baseRoot: conflictRoot, workers: conflict.workers });
    expect(conflictResult).toMatchObject({ status: "conflict", reason: "merge_conflict" });
    if (conflictResult.status !== "conflict") return;
    expect(conflictResult.refsBefore).toEqual(conflictResult.refsAfter);
    expect(state(conflictRoot)).toEqual(conflictBefore);

    const dirtyRoot = await makeRepo({ "src/a.ts": "export const a = 1;\n" });
    const dirty = makeWorkers(dirtyRoot, { a: ["src/a.ts"] });
    writeWorktreeFile(dirty.workers[0]!.worktreePath, "src/a.ts", "export const a = 2;\n");
    await writeFile(join(dirtyRoot, "user-untracked.txt"), "preserve\n", "utf8");
    const dirtyBefore = state(dirtyRoot);
    const dirtyResult = freezeOrchestrationCandidate({ baseRoot: dirtyRoot, workers: dirty.workers });
    expect(dirtyResult).toMatchObject({ status: "rejected", reason: "main_worktree_dirty" });
    expect(state(dirtyRoot)).toEqual(dirtyBefore);
    expect(await readFile(join(dirtyRoot, "user-untracked.txt"), "utf8")).toBe("preserve\n");

    const untrackedRoot = await makeRepo({ "src/a.ts": "export const a = 1;\n" });
    const untracked = makeWorkers(untrackedRoot, { a: ["src/a.ts"] });
    writeWorktreeFile(untracked.workers[0]!.worktreePath, "src/a.ts", "export const a = 2;\n");
    await writeFile(join(untracked.workers[0]!.worktreePath, "unexpected.txt"), "x\n", "utf8");
    const untrackedResult = freezeOrchestrationCandidate({ baseRoot: untrackedRoot, workers: untracked.workers });
    expect(untrackedResult).toMatchObject({ status: "rejected", reason: "untracked" });
    expect(state(untrackedRoot).status).toBe("");

    const driftRoot = await makeRepo({ "src/a.ts": "export const a = 1;\n" });
    const drift = makeWorkers(driftRoot, { a: ["src/a.ts"] });
    writeWorktreeFile(drift.workers[0]!.worktreePath, "src/a.ts", "export const a = 2;\n");
    expect(freezeOrchestrationCandidate({ baseRoot: driftRoot, workers: drift.workers, expectedBaseOid: "0".repeat(40) })).toMatchObject({ status: "rejected", reason: "base_drift" });
  });

  it("creates a new candidate identity after a worker refresh", async () => {
    const root = await makeRepo({ "src/a.ts": "export const a = 1;\n" });
    const { workers } = makeWorkers(root, { a: ["src/a.ts"] });
    writeWorktreeFile(workers[0]!.worktreePath, "src/a.ts", "export const a = 2;\n");
    const first = freezeOrchestrationCandidate({ baseRoot: root, workers });
    expect(first.status).toBe("frozen");
    if (first.status !== "frozen") return;
    writeWorktreeFile(workers[0]!.worktreePath, "src/a.ts", "export const a = 3;\n");
    const second = freezeOrchestrationCandidate({ baseRoot: root, workers });
    expect(second.status).toBe("frozen");
    if (second.status !== "frozen") return;
    expect(second.manifest.candidateId).not.toBe(first.manifest.candidateId);
    expect(second.manifest.baseOid).toBe(first.manifest.baseOid);
    expect(second.manifest.workerSnapshots[0]?.treeOid).not.toBe(first.manifest.workerSnapshots[0]?.treeOid);
  });
});
