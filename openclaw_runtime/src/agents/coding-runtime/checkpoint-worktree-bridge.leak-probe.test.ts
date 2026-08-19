/**
 * P7 independent-acceptance probe: does an unexpected throw between `prepare`
 * and `apply` leak the workspace restore barrier?
 *
 * `prepare` acquires the P6A workspace barrier and the cross-process restore
 * lock. The bridge then reads the merge queue and computes overlaps *outside* any
 * try/catch. If that region throws, neither `release()` nor `applyAndSettle`'s
 * finally runs, and the workspace barrier stays held for the life of the process
 * -- blocking every UFTK writer and every later restore.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireWorkspaceRestoreBarrier,
  resetCodingRuntimeFileLocksForTest,
  setCodingLockConcurrencyV2Enabled,
} from "./file-lock-manager.js";
import { GitCheckpointService } from "./git-checkpoint.js";
import { CheckpointWorktreeBridge } from "./checkpoint-worktree-bridge.js";
import {
  __resetWorktreeRegistry,
  createWorktreeService,
  type WorktreeService,
} from "../worktree-service.js";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout;
}

let root: string;
let repo: string;
let state: string;
let service: GitCheckpointService;
let worktrees: WorktreeService;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-bridge-leak-"));
  repo = path.join(root, "repo");
  state = path.join(root, "state");
  __resetWorktreeRegistry();
  resetCodingRuntimeFileLocksForTest();
  setCodingLockConcurrencyV2Enabled(true);
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await git(["init", "-q"], repo);
  await git(["config", "user.email", "t@example.invalid"], repo);
  await git(["config", "user.name", "T"], repo);
  await git(["config", "core.autocrlf", "false"], repo);
  await fs.writeFile(path.join(repo, "src", "a.txt"), "a-base\n", "utf8");
  await git(["add", "."], repo);
  await git(["commit", "-qm", "initial"], repo);
  service = new GitCheckpointService({
    workspaceRoot: repo,
    enabled: true,
    pathScopedEnabled: true,
    concurrencyV2Enabled: true,
    stateDir: state,
    warn: () => {},
  });
  worktrees = createWorktreeService(repo);
});

afterEach(async () => {
  setCodingLockConcurrencyV2Enabled(false);
  resetCodingRuntimeFileLocksForTest();
  __resetWorktreeRegistry();
  await fs.rm(root, { recursive: true, force: true });
});

describe("barrier is never leaked between prepare and apply", () => {
  it("releases the workspace barrier when the overlap check throws", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "dirty\n", "utf8");

    // Inject a failure into the region between prepare and apply.
    const exploding: WorktreeService = {
      ...worktrees,
      getMergeQueue: () => {
        throw new Error("merge-queue read blew up");
      },
    };
    const bridge = new CheckpointWorktreeBridge({
      service,
      worktrees: exploding,
      safetySnapshotEnabled: true,
    });

    // Whatever the bridge does with the error, it must not keep the barrier.
    await bridge
      .restoreCheckpoint(created.checkpoint!.id, { paths: ["src"] })
      .catch(() => undefined);

    const barrier = await acquireWorkspaceRestoreBarrier(repo, {
      owner: "leak-probe",
      timeoutMs: 1_500,
    });
    await barrier.release();
  });

  it("reports the failure structurally rather than throwing", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "dirty\n", "utf8");
    const exploding: WorktreeService = {
      ...worktrees,
      getMergeQueue: () => {
        throw new Error("merge-queue read blew up");
      },
    };
    const result = await new CheckpointWorktreeBridge({
      service,
      worktrees: exploding,
      safetySnapshotEnabled: true,
    }).restoreCheckpoint(created.checkpoint!.id, { paths: ["src"] });

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("merge-queue read blew up");
    // Zero change: the apply never ran.
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("dirty\n");
  });
});
