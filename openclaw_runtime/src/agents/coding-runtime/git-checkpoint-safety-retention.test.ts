/**
 * P7 carry-over A: a pre-restore safety ref must survive any retention policy.
 *
 * P6B wrote safety refs into the same namespace as ordinary checkpoints, so
 * `retainCheckpoints` / `pruneCheckpoints` treated them as prunable. P7's
 * auto-checkpoint creates checkpoints in bulk and reuses that retention, which
 * turns "the safety ref might get reaped" into "it will". These tests pin the
 * separation: retention enumerates only the checkpoint namespace, the deletion
 * site asserts the namespace, and safety refs are reclaimable only through an
 * explicitly named call.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GIT_CHECKPOINT_REF_PREFIX,
  GIT_CHECKPOINT_SAFETY_REF_PREFIX,
  GitCheckpointService,
} from "./git-checkpoint.js";
import { GitCheckpointLifecycleService } from "./git-checkpoint-lifecycle.js";
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
let lifecycle: GitCheckpointLifecycleService;

function transaction(): GitCheckpointTransactionService {
  return new GitCheckpointTransactionService({ service, safetySnapshotEnabled: true });
}

/** Dirty `src/a.txt`, restore it under safety, and hand back the safety ref. */
async function restoreWithSafety(): Promise<{ safetyRef: string; checkpointId: string }> {
  const created = await service.createCheckpoint({ paths: ["src"], label: "restore-target" });
  expect(created.status).toBe("created");
  await fs.writeFile(path.join(repo, "src", "a.txt"), "a-precious\n", "utf8");
  const restored = await transaction().restoreCheckpoint(created.checkpoint!.id, {
    paths: ["src"],
  });
  expect(restored.status).toBe("restored");
  expect(restored.safetyRef).toBeTruthy();
  return { safetyRef: restored.safetyRef!, checkpointId: created.checkpoint!.id };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-safety-retention-"));
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
  lifecycle = new GitCheckpointLifecycleService({ service, lifecycleEnabled: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("safety ref namespace", () => {
  it("writes safety refs outside the checkpoint namespace", async () => {
    const { safetyRef } = await restoreWithSafety();
    expect(safetyRef.startsWith(`${GIT_CHECKPOINT_SAFETY_REF_PREFIX}/`)).toBe(true);
    expect(safetyRef.startsWith(`${GIT_CHECKPOINT_REF_PREFIX}/`)).toBe(false);
    // The namespaces are disjoint in git's own view, not just by string shape.
    expect(await git(["for-each-ref", GIT_CHECKPOINT_REF_PREFIX], repo)).not.toContain(safetyRef);
    expect(await git(["for-each-ref", GIT_CHECKPOINT_SAFETY_REF_PREFIX], repo)).toContain(
      safetyRef,
    );
  });

  it("keeps safety refs out of listCheckpoints and visible in listSafetyCheckpoints", async () => {
    const { safetyRef, checkpointId } = await restoreWithSafety();
    const safetyId = safetyRef.slice(safetyRef.lastIndexOf("/") + 1);

    const listed = await lifecycle.listCheckpoints();
    expect(listed.status).toBe("ok");
    expect(listed.checkpoints.map((item) => item.id)).toEqual([checkpointId]);

    const safety = await lifecycle.listSafetyCheckpoints();
    expect(safety.status).toBe("ok");
    expect(safety.checkpoints.map((item) => item.id)).toEqual([safetyId]);
    expect(safety.checkpoints[0]?.label).toContain("uftk-safety-snapshot");
  });
});

describe("retention cannot reap a safety ref", () => {
  it("prunes every prunable checkpoint while leaving the safety ref readable", async () => {
    // Bulk checkpoints, standing in for what auto-checkpoint produces per turn.
    const bulk: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const created = await service.createCheckpoint({
        paths: ["src"],
        label: `auto-turn-${index}`,
      });
      expect(created.status).toBe("created");
      bulk.push(created.checkpoint!.id);
    }
    const { safetyRef } = await restoreWithSafety();
    const safetyId = safetyRef.slice(safetyRef.lastIndexOf("/") + 1);

    const pruned = await lifecycle.pruneCheckpoints();
    expect(pruned.status).toBe("ok");
    // Aggressive: everything but the newest checkpoint goes.
    expect(pruned.pruned.length).toBeGreaterThanOrEqual(bulk.length);
    expect(pruned.pruned).not.toContain(safetyId);
    expect(pruned.kept).not.toContain(safetyId);

    // The safety ref still resolves and still holds the pre-restore bytes.
    expect(await git(["show", `${safetyRef}:src/a.txt`], repo)).toBe("a-precious\n");
  });

  it("survives an age-based policy that would sweep everything", async () => {
    const { safetyRef } = await restoreWithSafety();
    const result = await lifecycle.retainCheckpoints({ maxAgeMs: 0, maxCount: 0 });
    expect(result.status).toBe("ok");
    expect(await git(["show", `${safetyRef}:src/a.txt`], repo)).toBe("a-precious\n");
  });

  it("keeps safety content reachable across an explicit garbage collection", async () => {
    const { safetyRef } = await restoreWithSafety();
    await lifecycle.pruneCheckpoints();
    const collected = await lifecycle.collectGarbage();
    expect(collected.status).toBe("ok");
    // Objects reachable from the safety ref are not unreachable, so prune cannot
    // discard them.
    expect(await git(["show", `${safetyRef}:src/a.txt`], repo)).toBe("a-precious\n");
  });
});

describe("recovery_required plus aggressive retention", () => {
  it("still reads the pre-restore content out of the safety ref", async () => {
    // Bulk checkpoints first, so retention has plenty to chew on.
    for (let index = 0; index < 8; index += 1) {
      await service.createCheckpoint({ paths: ["src"], label: `auto-turn-${index}` });
    }

    const created = await service.createCheckpoint({ paths: ["src"], label: "pre-failure" });
    const id = created.checkpoint!.id;
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-precious\n", "utf8");
    await fs.writeFile(path.join(repo, "src", "extra.txt"), "extra-precious\n", "utf8");

    const txn = transaction();
    const outcome = await txn.prepare(id, { paths: ["src"] });
    expect(outcome.status).toBe("prepared");
    if (outcome.status !== "prepared") throw new Error("prepare failed");

    // Make the removal sweep fail after checkout has already written files, and
    // break the state dir so the safety rollback cannot complete either.
    await fs.rm(path.join(repo, "src", "extra.txt"));
    await fs.mkdir(path.join(repo, "src", "extra.txt"), { recursive: true });
    await fs.writeFile(path.join(repo, "src", "extra.txt", "inner.txt"), "inner", "utf8");
    const tmpDir = path.join(state, "tmp");
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.writeFile(tmpDir, "not-a-directory", "utf8");

    const failure = await txn.applyAndSettle(outcome.prepared);
    expect(failure.status).toBe("recovery_required");
    expect(failure.safetyRef).toBeTruthy();

    // Now run retention as aggressively as any policy can.
    const pruned = await lifecycle.pruneCheckpoints();
    expect(pruned.status).toBe("ok");
    expect(pruned.pruned.length).toBeGreaterThan(0);

    // The user's pre-restore content is still there, in both safety surfaces.
    expect(await git(["show", `${failure.safetyRef}:src/a.txt`], repo)).toBe("a-precious\n");
    expect(await git(["show", `${failure.safetyRef}:src/extra.txt`], repo)).toBe(
      "extra-precious\n",
    );
    expect(
      await fs.readFile(path.join(failure.recoveryRef!, "src", "a.txt"), "utf8"),
    ).toBe("a-precious\n");
  });
});

describe("explicit safety reclamation", () => {
  it("is the only path that deletes a safety ref, and protects the newest", async () => {
    const first = await restoreWithSafety();
    await fs.writeFile(path.join(repo, "src", "a.txt"), "second-precious\n", "utf8");
    const secondCheckpoint = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "third-precious\n", "utf8");
    const second = await transaction().restoreCheckpoint(secondCheckpoint.checkpoint!.id, {
      paths: ["src"],
    });
    expect(second.status).toBe("restored");

    const before = await lifecycle.listSafetyCheckpoints();
    expect(before.checkpoints).toHaveLength(2);

    // An empty policy is a no-op: reclamation must be asked for explicitly.
    const noop = await lifecycle.retainSafetyCheckpoints();
    expect(noop).toMatchObject({ status: "ok", pruned: [] });
    expect((await lifecycle.listSafetyCheckpoints()).checkpoints).toHaveLength(2);

    const reclaimed = await lifecycle.retainSafetyCheckpoints({ maxCount: 0 });
    expect(reclaimed.status).toBe("ok");
    expect(reclaimed.pruned).toHaveLength(1);
    // Newest safety ref is protected: the most recent restore stays recoverable.
    expect(reclaimed.kept).toHaveLength(1);

    const after = await lifecycle.listSafetyCheckpoints();
    expect(after.checkpoints).toHaveLength(1);
    expect(after.checkpoints[0]?.id).toBe(reclaimed.kept[0]);
    // The older one is the one that went.
    expect(reclaimed.pruned[0]).toBe(first.safetyRef.slice(first.safetyRef.lastIndexOf("/") + 1));
  });

  it("reports structured disabled when the lifecycle flag is off", async () => {
    const { safetyRef } = await restoreWithSafety();
    const off = new GitCheckpointLifecycleService({ service, lifecycleEnabled: false });
    await expect(off.listSafetyCheckpoints()).resolves.toMatchObject({ status: "disabled" });
    await expect(off.retainSafetyCheckpoints({ maxCount: 0 })).resolves.toMatchObject({
      status: "disabled",
      pruned: [],
    });
    expect(await git(["for-each-ref", GIT_CHECKPOINT_SAFETY_REF_PREFIX], repo)).toContain(
      safetyRef,
    );
  });
});
