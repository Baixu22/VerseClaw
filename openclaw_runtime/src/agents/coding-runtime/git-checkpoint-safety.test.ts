import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCheckpointService } from "./git-checkpoint.js";
import { computeAtRiskPaths, resolveRecoveryDir } from "./git-checkpoint-safety.js";
import { GitCheckpointTransactionService } from "./git-checkpoint-transaction.js";

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

function transaction(options: { safetySnapshotEnabled?: boolean } = {}): GitCheckpointTransactionService {
  return new GitCheckpointTransactionService({
    service,
    ...(options.safetySnapshotEnabled !== undefined
      ? { safetySnapshotEnabled: options.safetySnapshotEnabled }
      : {}),
  });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-git-safety-"));
  repo = path.join(root, "repo");
  state = path.join(root, "state");
  warnings = [];
  await fs.mkdir(repo, { recursive: true });
  await git(["init", "-q"], repo);
  await git(["config", "user.email", "test@example.invalid"], repo);
  await git(["config", "user.name", "UFTK Test"], repo);
  await git(["config", "core.autocrlf", "false"], repo);
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await fs.writeFile(path.join(repo, "src", "a.txt"), "a-base\n", "utf8");
  await fs.writeFile(path.join(repo, "src", "b.txt"), "b-base\n", "utf8");
  await fs.writeFile(path.join(repo, "keep.txt"), "keep-base\n", "utf8");
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
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("at-risk detection", () => {
  it("flags only content that a restore would actually destroy", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    const id = created.checkpoint!.id;

    // a.txt: modified -> at risk. b.txt: untouched -> not at risk.
    // added.txt: absent from tree, present on disk -> removed, so at risk.
    // missing.txt: in tree but absent on disk -> restore only creates it.
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-dirty\n", "utf8");
    await fs.writeFile(path.join(repo, "src", "added.txt"), "added\n", "utf8");

    const atRisk = await computeAtRiskPaths({
      root: repo,
      checkpointId: id,
      restorePaths: ["src/a.txt", "src/b.txt", "src/missing.txt"],
      removePaths: ["src/added.txt"],
      env: process.env,
      timeoutMs: 30_000,
    });
    expect(atRisk).toEqual(["src/a.txt", "src/added.txt"]);
  });

  it("returns nothing when the worktree already matches the checkpoint", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    const atRisk = await computeAtRiskPaths({
      root: repo,
      checkpointId: created.checkpoint!.id,
      restorePaths: ["src/a.txt", "src/b.txt"],
      removePaths: [],
      env: process.env,
      timeoutMs: 30_000,
    });
    expect(atRisk).toEqual([]);
  });
});

describe("two-phase restore with safety snapshot", () => {
  it("captures a safety ref plus raw backups and reports them on success", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    const id = created.checkpoint!.id;
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-dirty\n", "utf8");
    await fs.writeFile(path.join(repo, "src", "added.txt"), "added\n", "utf8");

    const restored = await transaction({ safetySnapshotEnabled: true }).restoreCheckpoint(id, {
      paths: ["src"],
    });
    expect(restored.status).toBe("restored");
    // P7 carry-over A: safety refs live in their own namespace, outside the one
    // lifecycle retention enumerates.
    expect(restored.safetyRef).toMatch(/^refs\/openclaw\/uftk-safety\//);
    expect(restored.recoveryRef).toBeTruthy();

    // The restore happened.
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-base\n");
    await expect(fs.access(path.join(repo, "src", "added.txt"))).rejects.toThrow();

    // Pre-restore content is recoverable from both the safety ref and raw bytes.
    const safetyTree = await git(
      ["ls-tree", "-r", "--name-only", restored.safetyRef!],
      repo,
    );
    expect(safetyTree).toContain("src/a.txt");
    expect(safetyTree).toContain("src/added.txt");
    expect(
      await git(["show", `${restored.safetyRef}:src/a.txt`], repo),
    ).toBe("a-dirty\n");
    expect(
      await fs.readFile(path.join(restored.recoveryRef!, "src", "a.txt"), "utf8"),
    ).toBe("a-dirty\n");
    expect(
      await fs.readFile(path.join(restored.recoveryRef!, "src", "added.txt"), "utf8"),
    ).toBe("added\n");
  });

  it("snapshots a scope that names files absent from disk", async () => {
    // A restore scope legitimately names a deleted file that is about to be put
    // back. `git add -A -- <absent path>` fails on an unmatched pathspec, and a
    // temp index starts empty, so the snapshot has to tolerate the miss rather
    // than leave the restore with no safety net. P6B only ever scoped by
    // directory, which always matches, so this shape went unexercised.
    const created = await service.createCheckpoint({ paths: ["src"] });
    const id = created.checkpoint!.id;
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-dirty\n", "utf8");
    await fs.rm(path.join(repo, "src", "b.txt"));

    const restored = await transaction({ safetySnapshotEnabled: true }).restoreCheckpoint(id, {
      paths: ["src/a.txt", "src/b.txt"],
    });
    expect(restored.status).toBe("restored");
    expect(restored.safetyRef).toBeTruthy();

    // The deleted file is back, and the safety tree records that it was absent.
    expect(await fs.readFile(path.join(repo, "src", "b.txt"), "utf8")).toBe("b-base\n");
    const safetyTree = await git(["ls-tree", "-r", "--name-only", restored.safetyRef!], repo);
    expect(safetyTree).toContain("src/a.txt");
    expect(safetyTree).not.toContain("src/b.txt");
    expect(await git(["show", `${restored.safetyRef}:src/a.txt`], repo)).toBe("a-dirty\n");
  });

  it("keeps the raw recovery backup outside the workspace so git status stays clean", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-dirty\n", "utf8");

    const restored = await transaction({ safetySnapshotEnabled: true }).restoreCheckpoint(
      created.checkpoint!.id,
      { paths: ["src"] },
    );
    expect(restored.status).toBe("restored");
    expect(path.resolve(restored.recoveryRef!).startsWith(path.resolve(state))).toBe(true);
    expect(path.resolve(restored.recoveryRef!).startsWith(path.resolve(repo))).toBe(false);
    // No stray untracked entry appeared inside the repository.
    expect(await git(["status", "--porcelain=v1"], repo)).toBe("");
  });

  it("reports a recoveryRef that resolveRecoveryDir reproduces exactly", async () => {
    // P6B shipped two copies of this path construction that had already drifted
    // (one resolved `stateDir`, the other did not). An operator following
    // recovery advice on a relative stateDir would have been sent to a directory
    // the snapshot never wrote to, so pin that the helper and the writer agree.
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-dirty\n", "utf8");

    const prepared = await transaction({ safetySnapshotEnabled: true }).prepare(
      created.checkpoint!.id,
      { paths: ["src"] },
    );
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;
    const { restoreId } = prepared.prepared;
    const settled = await transaction({ safetySnapshotEnabled: true }).applyAndSettle(
      prepared.prepared,
    );
    expect(settled.status).toBe("restored");

    expect(settled.recoveryRef).toBe(resolveRecoveryDir(state, restoreId));
    // And the reproduced path is the one that actually holds the bytes.
    expect(
      await fs.readFile(path.join(resolveRecoveryDir(state, restoreId), "src", "a.txt"), "utf8"),
    ).toBe("a-dirty\n");
  });

  it("refuses to overwrite dirty in-scope content when the safety flag is off", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "precious-edit\n", "utf8");

    const result = await transaction({ safetySnapshotEnabled: false }).restoreCheckpoint(
      created.checkpoint!.id,
      { paths: ["src"] },
    );
    expect(result.status).toBe("conflict");
    expect(result.error?.code).toBe("E_GIT_CHECKPOINT_CONFLICT");
    expect(result.reason).toContain("safetySnapshot");
    // Zero change: the user's edit survives untouched.
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("precious-edit\n");
  });

  it("proceeds with the safety flag off when nothing in scope is dirty", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.rm(path.join(repo, "src", "a.txt"));

    const result = await transaction({ safetySnapshotEnabled: false }).restoreCheckpoint(
      created.checkpoint!.id,
      { paths: ["src"] },
    );
    expect(result.status).toBe("restored");
    expect(result.safetyRef).toBeUndefined();
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-base\n");
  });

  it("leaves the target zero-changed when prepare hits a structural conflict", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    const id = created.checkpoint!.id;
    // Replace a checkpoint file with a directory: checkout cannot proceed.
    await fs.rm(path.join(repo, "src", "a.txt"));
    await fs.mkdir(path.join(repo, "src", "a.txt"), { recursive: true });
    // Non-empty: git can delete an empty directory to place a file, but not this.
    await fs.writeFile(path.join(repo, "src", "a.txt", "blocker.txt"), "blocked-x", "utf8");
    await fs.writeFile(path.join(repo, "src", "a.txt", "inner.txt"), "inner\n", "utf8");

    const result = await transaction({ safetySnapshotEnabled: true }).restoreCheckpoint(id, {
      paths: ["src"],
    });
    expect(result.status).toBe("conflict");
    expect(result.error?.code).toBe("E_GIT_CHECKPOINT_CONFLICT");
    // The blocking directory and its content are still there, unmodified.
    expect((await fs.stat(path.join(repo, "src", "a.txt"))).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(repo, "src", "a.txt", "inner.txt"), "utf8")).toBe("inner\n");
  });

  it("returns structured not_found without touching the worktree", async () => {
    const beforeStatus = await git(["status", "--porcelain=v1"], repo);
    const result = await transaction({ safetySnapshotEnabled: true }).restoreCheckpoint(
      "0000000000000000000000000000000000000000",
      { paths: ["src"] },
    );
    expect(result.status).toBe("not_found");
    expect(result.error?.code).toBe("E_GIT_CHECKPOINT_NOT_FOUND");
    expect(await git(["status", "--porcelain=v1"], repo)).toBe(beforeStatus);
  });

  it("returns structured disabled when path scoping is off", async () => {
    const flagOff = new GitCheckpointService({
      workspaceRoot: repo,
      enabled: true,
      stateDir: state,
      warn: (message) => warnings.push(message),
    });
    const result = await new GitCheckpointTransactionService({
      service: flagOff,
      safetySnapshotEnabled: true,
    }).restoreCheckpoint("abc", { paths: ["src"] });
    expect(result).toMatchObject({ status: "disabled", reason: expect.stringContaining("pathScoped") });
  });

  it("serializes restore against UFTK writers through the P6A workspace barrier", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    const id = created.checkpoint!.id;
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-dirty\n", "utf8");

    const { acquireWorkspaceRestoreBarrier } = await import("./file-lock-manager.js");
    const barrier = await acquireWorkspaceRestoreBarrier(repo, { owner: "test-holder" });
    let settled = false;
    const pending = transaction({ safetySnapshotEnabled: true })
      .restoreCheckpoint(id, { paths: ["src"] })
      .then((result) => {
        settled = true;
        return result;
      });

    // While the barrier is held elsewhere, the restore cannot proceed.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(settled).toBe(false);
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-dirty\n");

    await barrier.release();
    const result = await pending;
    expect(result.status).toBe("restored");
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-base\n");
  });

  it("restores out-of-scope paths not at all, even under the transaction", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-dirty\n", "utf8");
    await fs.writeFile(path.join(repo, "keep.txt"), "keep-dirty\n", "utf8");
    await fs.writeFile(path.join(repo, "extra.txt"), "extra\n", "utf8");

    const result = await transaction({ safetySnapshotEnabled: true }).restoreCheckpoint(
      created.checkpoint!.id,
      { paths: ["src"] },
    );
    expect(result.status).toBe("restored");
    expect(await fs.readFile(path.join(repo, "keep.txt"), "utf8")).toBe("keep-dirty\n");
    expect(await fs.readFile(path.join(repo, "extra.txt"), "utf8")).toBe("extra\n");
  });
});

describe("apply-phase failure handling", () => {
  /**
   * Prepare a restore, then break the worktree so that `apply` fails *after* it
   * has already written files. `checkout-index -f` force-removes a blocking
   * directory, so the injection point is the removal sweep instead: turning an
   * extraneous file into a non-empty directory makes `fs.rm` fail once the
   * checkout has already landed.
   */
  async function preparedWithFailingRemoval(): Promise<{
    txn: GitCheckpointTransactionService;
    prepared: Extract<
      Awaited<ReturnType<GitCheckpointTransactionService["prepare"]>>,
      { status: "prepared" }
    >["prepared"];
  }> {
    const created = await service.createCheckpoint({ paths: ["src"] });
    const id = created.checkpoint!.id;
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-precious\n", "utf8");
    await fs.writeFile(path.join(repo, "src", "extra.txt"), "extra-precious\n", "utf8");

    const txn = transaction({ safetySnapshotEnabled: true });
    const outcome = await txn.prepare(id, { paths: ["src"] });
    expect(outcome.status).toBe("prepared");
    if (outcome.status !== "prepared") throw new Error("prepare failed");
    expect(outcome.prepared.plan.removePaths).toContain("src/extra.txt");

    await fs.rm(path.join(repo, "src", "extra.txt"));
    await fs.mkdir(path.join(repo, "src", "extra.txt"), { recursive: true });
    await fs.writeFile(path.join(repo, "src", "extra.txt", "inner.txt"), "inner", "utf8");
    return { txn, prepared: outcome.prepared };
  }

  it("rolls back from the safety snapshot when apply fails mid-flight", async () => {
    const { txn, prepared } = await preparedWithFailingRemoval();
    const result = await txn.applyAndSettle(prepared);

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("rolled back from safety snapshot");
    expect(result.safetyRef).toBeTruthy();
    // The pre-restore content is back, not the checkpoint content.
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-precious\n");
    expect(await fs.readFile(path.join(repo, "src", "extra.txt"), "utf8")).toBe(
      "extra-precious\n",
    );
  });

  it("returns recovery_required with recoverable refs when the rollback cannot complete", async () => {
    const { txn, prepared } = await preparedWithFailingRemoval();
    // Break the state dir so both apply and the safety rollback fail: the temp
    // index directory can no longer be created.
    const tmpDir = path.join(state, "tmp");
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.writeFile(tmpDir, "not-a-directory", "utf8");

    const result = await txn.applyAndSettle(prepared);
    expect(result.status).toBe("recovery_required");
    expect(result.error?.code).toBe("E_GIT_CHECKPOINT_RECOVERY_REQUIRED");
    expect(result.reason).toContain("safety rollback incomplete");

    // Both safety surfaces still hold the user's pre-restore content.
    expect(result.safetyRef).toBeTruthy();
    expect(await git(["show", `${result.safetyRef}:src/a.txt`], repo)).toBe("a-precious\n");
    expect(result.recoveryRef).toBeTruthy();
    expect(
      await fs.readFile(path.join(result.recoveryRef!, "src", "a.txt"), "utf8"),
    ).toBe("a-precious\n");
    expect(
      await fs.readFile(path.join(result.recoveryRef!, "src", "extra.txt"), "utf8"),
    ).toBe("extra-precious\n");
  });

  it("recovers the pre-restore state from the safety ref after recovery_required", async () => {
    const { txn, prepared } = await preparedWithFailingRemoval();
    const tmpDir = path.join(state, "tmp");
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.writeFile(tmpDir, "not-a-directory", "utf8");
    const failure = await txn.applyAndSettle(prepared);
    expect(failure.status).toBe("recovery_required");

    // Operator recovery path: repair the state dir, then restore the safety
    // checkpoint through the normal API.
    await fs.rm(tmpDir, { force: true });
    await fs.rm(path.join(repo, "src", "extra.txt"), { recursive: true, force: true });
    const recovered = await service.restoreCheckpoint(failure.safetyRef!, { paths: ["src"] });
    expect(recovered.status).toBe("restored");
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-precious\n");
    expect(await fs.readFile(path.join(repo, "src", "extra.txt"), "utf8")).toBe(
      "extra-precious\n",
    );
  });

  it("releases the restore barrier even when apply fails", async () => {
    const { txn, prepared } = await preparedWithFailingRemoval();
    const failed = await txn.applyAndSettle(prepared);
    expect(failed.status).toBe("failed");

    // A failed restore must not leave the workspace barrier held.
    const { acquireWorkspaceRestoreBarrier } = await import("./file-lock-manager.js");
    const barrier = await acquireWorkspaceRestoreBarrier(repo, {
      owner: "post-failure-probe",
      timeoutMs: 2_000,
    });
    await barrier.release();
  });

  it("holds the restore barrier for the whole prepare-to-settle window", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    const id = created.checkpoint!.id;
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-dirty\n", "utf8");

    const txn = transaction({ safetySnapshotEnabled: true });
    const prepared = await txn.prepare(id, { paths: ["src"] });
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;

    // While a restore is prepared but not yet applied, another barrier holder
    // must not be able to slip in.
    const { acquireWorkspaceRestoreBarrier } = await import("./file-lock-manager.js");
    await expect(
      acquireWorkspaceRestoreBarrier(repo, { owner: "intruder", timeoutMs: 150 }),
    ).rejects.toMatchObject({ code: "E_LOCK_TIMEOUT" });

    const result = await txn.applyAndSettle(prepared.prepared);
    expect(result.status).toBe("restored");
    // Released after settle.
    const barrier = await acquireWorkspaceRestoreBarrier(repo, {
      owner: "after-settle",
      timeoutMs: 2_000,
    });
    await barrier.release();
  });
});
