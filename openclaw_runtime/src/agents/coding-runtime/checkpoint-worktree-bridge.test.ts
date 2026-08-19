/**
 * P7: checkpoint restore coordinated with the worktree merge queue.
 *
 * The acceptance requirement is that conflicts are visible and user content is
 * never silently lost. So the tests here check two things above all: that a
 * pending merge overlapping a restore blocks the restore with the worktree's own
 * conflict policy attached, and that blocking leaves the worktree byte-unchanged
 * under every policy -- "escalate" and "return to worker" route the decision,
 * they do not grant permission to discard the worker's files.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCheckpointService } from "./git-checkpoint.js";
import {
  CheckpointWorktreeBridge,
  findWorktreeMergeOverlaps,
} from "./checkpoint-worktree-bridge.js";
import {
  __resetWorktreeRegistry,
  createWorktreeService,
  type MergeConflictPolicy,
  type WorktreeService,
} from "../worktree-service.js";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

let root: string;
let repo: string;
let state: string;
let warnings: string[];
let service: GitCheckpointService;
let worktrees: WorktreeService;

function bridge(options: { conflictPolicy?: MergeConflictPolicy } = {}): CheckpointWorktreeBridge {
  return new CheckpointWorktreeBridge({
    service,
    worktrees,
    safetySnapshotEnabled: true,
    ...(options.conflictPolicy ? { conflictPolicy: options.conflictPolicy } : {}),
  });
}

/** Register a worker worktree with a pending merge over `changedFiles`. */
function enqueueWorkerMerge(id: string, changedFiles: string[]): void {
  worktrees.create(id, { writeSet: changedFiles });
  worktrees.enqueueMerge({ worktreeId: id, changedFiles });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-ckpt-worktree-"));
  repo = path.join(root, "repo");
  state = path.join(root, "state");
  warnings = [];
  __resetWorktreeRegistry();
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await fs.mkdir(path.join(repo, "docs"), { recursive: true });
  await git(["init", "-q"], repo);
  await git(["config", "user.email", "test@example.invalid"], repo);
  await git(["config", "user.name", "UFTK Test"], repo);
  await git(["config", "core.autocrlf", "false"], repo);
  await fs.writeFile(path.join(repo, "src", "a.txt"), "a-base\n", "utf8");
  await fs.writeFile(path.join(repo, "docs", "d.txt"), "d-base\n", "utf8");
  await git(["add", "."], repo);
  await git(["commit", "-qm", "initial"], repo);
  service = new GitCheckpointService({
    workspaceRoot: repo,
    enabled: true,
    pathScopedEnabled: true,
    concurrencyV2Enabled: true,
    stateDir: state,
    warn: (message) => warnings.push(message),
  });
  worktrees = createWorktreeService(repo);
});

afterEach(async () => {
  __resetWorktreeRegistry();
  await fs.rm(root, { recursive: true, force: true });
});

describe("overlap detection", () => {
  it("matches directory containment in both directions", () => {
    const overlaps = findWorktreeMergeOverlaps({
      queue: [
        { worktreeId: "wt-file-in-dir", changedFiles: ["src/deep/a.ts"], status: "pending" },
        { worktreeId: "wt-dir-over-file", changedFiles: ["src"], status: "pending" },
        { worktreeId: "wt-elsewhere", changedFiles: ["docs/d.md"], status: "pending" },
      ],
      paths: ["src/deep"],
    });
    expect(overlaps.map((entry) => entry.worktreeId)).toEqual([
      "wt-file-in-dir",
      "wt-dir-over-file",
    ]);
    expect(overlaps[0]?.paths).toEqual(["src/deep/a.ts"]);
  });

  it("ignores queue items that can no longer land", () => {
    const overlaps = findWorktreeMergeOverlaps({
      queue: [
        { worktreeId: "merged", changedFiles: ["src/a.txt"], status: "merged" },
        { worktreeId: "conflict", changedFiles: ["src/a.txt"], status: "conflict" },
        { worktreeId: "rework", changedFiles: ["src/a.txt"], status: "rework" },
      ],
      paths: ["src/a.txt"],
    });
    // `rework` is still going to land; `merged` and `conflict` are not.
    expect(overlaps.map((entry) => entry.worktreeId)).toEqual(["rework"]);
  });

  it("normalizes windows separators on both sides", () => {
    const overlaps = findWorktreeMergeOverlaps({
      queue: [{ worktreeId: "wt", changedFiles: ["src\\a.txt"], status: "pending" }],
      paths: ["src/a.txt"],
    });
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]?.paths).toEqual(["src/a.txt"]);
  });
});

describe("restore blocked by a pending merge", () => {
  it("refuses with the conflict policy attached and zero worktree change", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "worker-in-flight\n", "utf8");
    const beforeStatus = await git(["status", "--porcelain=v1"], repo);
    enqueueWorkerMerge("worker-1", ["src/a.txt"]);

    const result = await bridge().restoreCheckpoint(created.checkpoint!.id, { paths: ["src"] });

    expect(result.status).toBe("conflict");
    expect(result.error?.code).toBe("E_GIT_CHECKPOINT_CONFLICT");
    expect(result.disposition).toBe("mark_conflict");
    expect(result.overlaps).toEqual([
      { worktreeId: "worker-1", paths: ["src/a.txt"], queueStatus: "pending" },
    ]);
    // The conflict is visible in the reason, not just the status.
    expect(result.reason).toContain("worker-1");
    expect(result.reason).toContain("src/a.txt");
    // The worker's content survives byte-identical.
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("worker-in-flight\n");
    expect(await git(["status", "--porcelain=v1"], repo)).toBe(beforeStatus);
  });

  it.each(["mark_conflict", "return_worker", "escalate_lead"] as const)(
    "leaves the worktree unchanged under the %s policy",
    async (policy) => {
      const created = await service.createCheckpoint({ paths: ["src"] });
      await fs.writeFile(path.join(repo, "src", "a.txt"), "worker-in-flight\n", "utf8");
      enqueueWorkerMerge("worker-1", ["src/a.txt"]);

      const result = await bridge({ conflictPolicy: policy }).restoreCheckpoint(
        created.checkpoint!.id,
        { paths: ["src"] },
      );
      expect(result.status).toBe("conflict");
      expect(result.disposition).toBe(policy);
      expect(result.reason?.startsWith(`${policy}:`)).toBe(true);
      // No policy is permission to discard the worker's file.
      expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe(
        "worker-in-flight\n",
      );
    },
  );

  it("releases the restore barrier when it refuses", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "worker-in-flight\n", "utf8");
    enqueueWorkerMerge("worker-1", ["src/a.txt"]);

    const result = await bridge().restoreCheckpoint(created.checkpoint!.id, { paths: ["src"] });
    expect(result.status).toBe("conflict");

    const { acquireWorkspaceRestoreBarrier } = await import("./file-lock-manager.js");
    const barrier = await acquireWorkspaceRestoreBarrier(repo, {
      owner: "post-conflict-probe",
      timeoutMs: 2_000,
    });
    await barrier.release();
  });

  it("does not run the merge queue as a side effect of asking", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "worker-in-flight\n", "utf8");
    enqueueWorkerMerge("worker-1", ["src/a.txt"]);

    await bridge().restoreCheckpoint(created.checkpoint!.id, { paths: ["src"] });

    // The queue item is untouched: probing must not consume or apply it.
    const queue = worktrees.getMergeQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ worktreeId: "worker-1", status: "pending" });
  });
});

describe("restore allowed to proceed", () => {
  it("restores when no pending merge overlaps the scope", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "dirty\n", "utf8");
    // A pending merge over a different subtree must not block.
    enqueueWorkerMerge("worker-docs", ["docs/d.txt"]);

    const result = await bridge().restoreCheckpoint(created.checkpoint!.id, { paths: ["src"] });
    expect(result.status).toBe("restored");
    expect(result.overlaps).toEqual([]);
    expect(result.paths).toContain("src/a.txt");
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-base\n");
    expect(result.safetyRef).toMatch(/^refs\/openclaw\/uftk-safety\//);
  });

  it("restores when the queue is empty", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "dirty\n", "utf8");
    const result = await bridge().restoreCheckpoint(created.checkpoint!.id, { paths: ["src"] });
    expect(result.status).toBe("restored");
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-base\n");
  });

  it("passes P6B rejections straight through without inventing a status", async () => {
    const result = await bridge().restoreCheckpoint(
      "0000000000000000000000000000000000000000",
      { paths: ["src"] },
    );
    expect(result.status).toBe("not_found");
    expect(result.error?.code).toBe("E_GIT_CHECKPOINT_NOT_FOUND");
    expect(result.overlaps).toEqual([]);
  });

  it("reports disabled when path-scoped restore is off", async () => {
    const scopedOff = new GitCheckpointService({
      workspaceRoot: repo,
      enabled: true,
      stateDir: state,
      warn: (message) => warnings.push(message),
    });
    const result = await new CheckpointWorktreeBridge({
      service: scopedOff,
      worktrees,
      safetySnapshotEnabled: true,
    }).restoreCheckpoint("abc", { paths: ["src"] });
    expect(result).toMatchObject({ status: "disabled" });
    expect(result.reason).toContain("pathScoped");
  });
});

describe("merge semantics stay in worktree-service", () => {
  it("does not import or reimplement the merge apply path", async () => {
    const source = await fs.readFile(
      path.join(import.meta.dirname, "checkpoint-worktree-bridge.ts"),
      "utf8",
    );
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // The bridge reads the queue; it never processes it.
    expect(codeOnly).toContain("getMergeQueue");
    expect(codeOnly).not.toContain("processMergeQueue");
    expect(codeOnly).not.toContain("enqueueMerge");
    // And it never reaches for the forbidden restore primitives.
    expect(codeOnly).not.toContain("reset --hard");
    expect(codeOnly).not.toContain("clean -f");
  });
});
