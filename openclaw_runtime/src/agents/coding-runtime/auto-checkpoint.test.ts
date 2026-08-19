/**
 * P7: automatic turn / long-task checkpoints.
 *
 * Two carry-over acceptance items land here:
 *
 * - **Carry-over A end-to-end**: bulk auto checkpoints + aggressive retention +
 *   a `recovery_required` restore, after which the safety ref must still read
 *   out the pre-restore content. This is the shape that made carry-over A a
 *   must-fix: auto checkpoint is what makes retention aggressive in the first
 *   place.
 * - **Carry-over C**: auto checkpoint, the restore barrier and UFTK writers
 *   running concurrently with no starvation, no bypass and no deadlock. It
 *   depends on the hierarchical writer-barrier fix from P6A's acceptance.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codingObservability } from "../../context-engine/coding-observability.js";
import {
  acquireCodingRuntimeFileLocks,
  acquireWorkspaceRestoreBarrier,
  resetCodingRuntimeFileLocksForTest,
  setCodingLockConcurrencyV2Enabled,
} from "./file-lock-manager.js";
import { withFileMutationQueue } from "../sessions/tools/file-mutation-queue.js";
import { GitCheckpointService } from "./git-checkpoint.js";
import { GitCheckpointLifecycleService } from "./git-checkpoint-lifecycle.js";
import { GitCheckpointTransactionService } from "./git-checkpoint-transaction.js";
import {
  AutoCheckpointService,
  buildAutoCheckpointLabel,
  withWorkspaceQuiesce,
} from "./auto-checkpoint.js";

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

function autoService(
  options: {
    autoCheckpointEnabled?: boolean;
    retention?: Parameters<GitCheckpointLifecycleService["retainCheckpoints"]>[0];
    minIntervalMs?: number;
    now?: () => number;
    withLifecycle?: boolean;
  } = {},
): AutoCheckpointService {
  return new AutoCheckpointService({
    service,
    ...(options.withLifecycle === false ? {} : { lifecycle }),
    autoCheckpointEnabled: options.autoCheckpointEnabled ?? true,
    ...(options.retention ? { retention: options.retention } : {}),
    ...(options.minIntervalMs !== undefined ? { minIntervalMs: options.minIntervalMs } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-auto-ckpt-"));
  repo = path.join(root, "repo");
  state = path.join(root, "state");
  warnings = [];
  resetCodingRuntimeFileLocksForTest();
  setCodingLockConcurrencyV2Enabled(true);
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await git(["init", "-q"], repo);
  await git(["config", "user.email", "test@example.invalid"], repo);
  await git(["config", "user.name", "UFTK Test"], repo);
  await git(["config", "core.autocrlf", "false"], repo);
  await fs.writeFile(path.join(repo, "src", "a.txt"), "a-base\n", "utf8");
  await fs.writeFile(path.join(repo, "src", "b.txt"), "b-base\n", "utf8");
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
  setCodingLockConcurrencyV2Enabled(false);
  resetCodingRuntimeFileLocksForTest();
  await fs.rm(root, { recursive: true, force: true });
});

describe("label binds the requestId", () => {
  it("builds a label naming the trigger and the request", () => {
    expect(buildAutoCheckpointLabel({ trigger: "turn", requestId: "req-42" })).toBe(
      "uftk-auto-turn req-42",
    );
    expect(
      buildAutoCheckpointLabel({ trigger: "long-task", requestId: "req-7", detail: "build" }),
    ).toBe("uftk-auto-long-task req-7 build");
    // Control characters cannot leak into a commit trailer.
    expect(
      buildAutoCheckpointLabel({ trigger: "turn", requestId: "req\n8\ttab" }),
    ).toBe("uftk-auto-turn req 8 tab");
  });

  it("records the label in the checkpoint metadata and lists it back", async () => {
    const created = await autoService().checkpointForTurn({ requestId: "req-42" });
    expect(created.status).toBe("created");
    expect(created.label).toBe("uftk-auto-turn req-42");

    const listed = await lifecycle.listCheckpoints();
    expect(listed.checkpoints[0]?.label).toBe("uftk-auto-turn req-42");
    expect(listed.checkpoints[0]?.id).toBe(created.checkpointId);
  });

  it("labels a long-task checkpoint distinctly from a turn checkpoint", async () => {
    const auto = autoService();
    const turn = await auto.checkpointForTurn({ requestId: "req-1" });
    const task = await auto.checkpointForLongTask({ requestId: "req-1", detail: "typecheck" });
    expect(turn.status).toBe("created");
    expect(task.status).toBe("created");
    expect(task.label).toBe("uftk-auto-long-task req-1 typecheck");
    expect(task.checkpointId).not.toBe(turn.checkpointId);
  });
});

describe("flag gating and skips", () => {
  it("is off by default and does nothing", async () => {
    const off = new AutoCheckpointService({ service, lifecycle });
    const result = await off.checkpointForTurn({ requestId: "req-1" });
    expect(result).toMatchObject({ status: "disabled", trigger: "turn" });
    expect(result.reason).toContain("autoCheckpoint");
    expect(await git(["for-each-ref", "refs/openclaw"], repo)).toBe("");
  });

  it("refuses to run unlabelled when path scoping is off", async () => {
    const scopedOff = new GitCheckpointService({
      workspaceRoot: repo,
      enabled: true,
      stateDir: state,
      warn: (message) => warnings.push(message),
    });
    const result = await new AutoCheckpointService({
      service: scopedOff,
      autoCheckpointEnabled: true,
    }).checkpointForTurn({ requestId: "req-1" });
    expect(result.status).toBe("disabled");
    expect(result.reason).toContain("pathScoped");
  });

  it("creates at most one checkpoint per request and trigger", async () => {
    const auto = autoService();
    const first = await auto.checkpointForTurn({ requestId: "req-1" });
    const second = await auto.checkpointForTurn({ requestId: "req-1" });
    expect(first.status).toBe("created");
    expect(second.status).toBe("skipped");
    expect(second.checkpointId).toBe(first.checkpointId);
    expect((await lifecycle.listCheckpoints()).checkpoints).toHaveLength(1);
  });

  it("honours the minimum interval between automatic checkpoints", async () => {
    let clock = 1_000;
    const auto = autoService({ minIntervalMs: 5_000, now: () => clock });
    expect((await auto.checkpointForTurn({ requestId: "req-1" })).status).toBe("created");
    clock += 1_000;
    const throttled = await auto.checkpointForTurn({ requestId: "req-2" });
    expect(throttled.status).toBe("skipped");
    expect(throttled.reason).toContain("interval");
    clock += 5_000;
    expect((await auto.checkpointForTurn({ requestId: "req-3" })).status).toBe("created");
  });

  it("returns a structured result instead of throwing when creation cannot succeed", async () => {
    const notARepo = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-auto-nonrepo-"));
    try {
      const outside = new GitCheckpointService({
        workspaceRoot: notARepo,
        enabled: true,
        pathScopedEnabled: true,
        stateDir: state,
        warn: (message) => warnings.push(message),
      });
      const result = await new AutoCheckpointService({
        service: outside,
        autoCheckpointEnabled: true,
      }).checkpointForTurn({ requestId: "req-1" });
      expect(result.status).toBe("unsupported");
      expect(result.reason).toContain("not a git work tree");
    } finally {
      await fs.rm(notARepo, { recursive: true, force: true });
    }
  });
});

describe("retention reuses the P6B lifecycle", () => {
  it("prunes older automatic checkpoints but never the one just created", async () => {
    const auto = autoService({ retention: { maxCount: 2 } });
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const result = await auto.checkpointForTurn({ requestId: `req-${index}` });
      expect(result.status).toBe("created");
      ids.push(result.checkpointId!);
      // The checkpoint just created always survives its own retention pass.
      expect(result.retention?.pruned ?? []).not.toContain(result.checkpointId);
    }

    const remaining = (await lifecycle.listCheckpoints()).checkpoints.map((item) => item.id);
    expect(remaining.length).toBeLessThanOrEqual(2);
    expect(remaining).toContain(ids.at(-1));
  });

  it("skips retention entirely when no policy is configured", async () => {
    const auto = autoService();
    for (let index = 0; index < 4; index += 1) {
      const result = await auto.checkpointForTurn({ requestId: `req-${index}` });
      expect(result.retention).toBeUndefined();
    }
    expect((await lifecycle.listCheckpoints()).checkpoints).toHaveLength(4);
  });

  it("keeps the newest of a same-second burst, not an arbitrary one", async () => {
    // git's `creatordate` is second-resolution, so a burst of auto checkpoints
    // all carry the same date and cannot be ordered by it. Retention's "the
    // newest is always protected" rule is only as strong as that ordering, so
    // without sub-second precision `maxCount` can delete the checkpoint just
    // created and keep an older one.
    const auto = autoService();
    const ids: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const result = await auto.checkpointForTurn({ requestId: `burst-${index}` });
      expect(result.status).toBe("created");
      ids.push(result.checkpointId!);
    }

    const listed = await lifecycle.listCheckpoints();
    expect(listed.status).toBe("ok");
    // Newest-first order matches creation order reversed, despite identical
    // second-resolution git dates.
    expect(listed.checkpoints.map((item) => item.id)).toEqual([...ids].reverse());

    // And retention keeps the genuinely newest one.
    const retained = await lifecycle.retainCheckpoints({ maxCount: 1 });
    expect(retained.status).toBe("ok");
    expect(retained.kept).toEqual([ids.at(-1)]);
    expect(retained.pruned).toEqual(ids.slice(0, -1).reverse());
  });

  it("forgets pruned ids so a skip never hands back a dead checkpoint", async () => {
    const auto = autoService({ retention: { maxCount: 1 } });
    const first = await auto.checkpointForTurn({ requestId: "req-1" });
    await auto.checkpointForTurn({ requestId: "req-2" });
    // req-1's checkpoint is gone; asking again must create a new one, not point
    // at a ref that no longer resolves.
    expect(auto.createdCheckpointIds()).not.toContain(first.checkpointId);
    const again = await auto.checkpointForTurn({ requestId: "req-1" });
    expect(again.status).toBe("created");
    expect(again.checkpointId).not.toBe(first.checkpointId);
  });
});

describe("carry-over A: retention under auto-checkpoint pressure", () => {
  it("keeps the safety ref readable after bulk checkpoints, aggressive retention and recovery_required", async () => {
    // 1. Bulk automatic checkpoints with an aggressive retention policy.
    const auto = autoService({ retention: { maxCount: 1 } });
    for (let index = 0; index < 10; index += 1) {
      const result = await auto.checkpointForTurn({ requestId: `turn-${index}` });
      expect(result.status).toBe("created");
    }

    // 2. A restore target, then a restore that fails mid-apply.
    const target = await service.createCheckpoint({ paths: ["src"], label: "pre-failure" });
    expect(target.status).toBe("created");
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-precious\n", "utf8");
    await fs.writeFile(path.join(repo, "src", "extra.txt"), "extra-precious\n", "utf8");

    const txn = new GitCheckpointTransactionService({ service, safetySnapshotEnabled: true });
    const outcome = await txn.prepare(target.checkpoint!.id, { paths: ["src"] });
    expect(outcome.status).toBe("prepared");
    if (outcome.status !== "prepared") throw new Error("prepare failed");

    await fs.rm(path.join(repo, "src", "extra.txt"));
    await fs.mkdir(path.join(repo, "src", "extra.txt"), { recursive: true });
    await fs.writeFile(path.join(repo, "src", "extra.txt", "inner.txt"), "inner", "utf8");
    const tmpDir = path.join(state, "tmp");
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.writeFile(tmpDir, "not-a-directory", "utf8");

    const failure = await txn.applyAndSettle(outcome.prepared);
    expect(failure.status).toBe("recovery_required");
    expect(failure.safetyRef).toBeTruthy();
    await fs.rm(tmpDir, { force: true });

    // 3. Keep the auto-checkpoint pressure going, with retention as aggressive
    //    as a policy can be.
    for (let index = 10; index < 16; index += 1) {
      await auto.checkpointForTurn({ requestId: `turn-${index}` });
    }
    const swept = await lifecycle.retainCheckpoints({ maxCount: 0, maxAgeMs: 0 });
    expect(swept.status).toBe("ok");

    // 4. The user's pre-restore content is still reachable from both surfaces.
    expect(await git(["show", `${failure.safetyRef}:src/a.txt`], repo)).toBe("a-precious\n");
    expect(await git(["show", `${failure.safetyRef}:src/extra.txt`], repo)).toBe(
      "extra-precious\n",
    );
    expect(await fs.readFile(path.join(failure.recoveryRef!, "src", "a.txt"), "utf8")).toBe(
      "a-precious\n",
    );
    // And the safety ref was never a retention candidate.
    expect(swept.pruned).not.toContain(
      failure.safetyRef!.slice(failure.safetyRef!.lastIndexOf("/") + 1),
    );
  });
});

describe("carry-over C: auto checkpoint x restore barrier x UFTK writers", () => {
  it("creates checkpoints without taking a write lock, so writers never block it", async () => {
    const auto = autoService();
    const target = path.join(repo, "src", "a.txt");
    // A UFTK writer holds the file write lock for the duration.
    const held = await acquireCodingRuntimeFileLocks([target], {
      mode: "write",
      owner: "uftk-writer",
    });
    try {
      // The lock really is exclusive, so the test is not vacuous.
      await expect(
        acquireCodingRuntimeFileLocks([target], {
          mode: "write",
          owner: "intruder",
          timeoutMs: 150,
        }),
      ).rejects.toMatchObject({ code: "E_LOCK_TIMEOUT" });

      // Checkpoint creation still completes while that write lock is held: it
      // does not mutate the index or worktree, so it takes no write lock.
      const created = await auto.checkpointForTurn({ requestId: "req-during-write" });
      expect(created.status).toBe("created");
      expect(created.checkpointId).toBeTruthy();
    } finally {
      await held.release();
    }
  });

  it("quiesced checkpointing waits for a restore barrier instead of reading a half-applied tree", async () => {
    const auto = autoService();
    const barrier = await acquireWorkspaceRestoreBarrier(repo, { owner: "restore-holder" });
    let settled = false;
    const pending = withWorkspaceQuiesce(repo, { owner: "auto-checkpoint", timeoutMs: 10_000 }, () =>
      auto.checkpointForTurn({ requestId: "req-quiesced" }),
    ).then((result) => {
      settled = true;
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(settled).toBe(false);

    await barrier.release();
    const result = await pending;
    expect(result.status).toBe("created");
  });

  it("does not starve a restore behind a stream of auto checkpoints", async () => {
    // The P6A defect this depends on: a queued workspace writer barrier being
    // bypassed by later-arriving readers. A steady stream of quiesced auto
    // checkpoints (workspace read leases) must not keep a restore waiting
    // forever.
    const auto = autoService();
    let stop = false;
    const readerLoop = (async () => {
      let index = 0;
      while (!stop && index < 40) {
        await withWorkspaceQuiesce(repo, { owner: `auto-${index}`, timeoutMs: 10_000 }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
        index += 1;
      }
      return index;
    })();

    await new Promise((resolve) => setTimeout(resolve, 20));
    const barrier = await acquireWorkspaceRestoreBarrier(repo, {
      owner: "restore-under-reader-stream",
      timeoutMs: 5_000,
    });
    // The barrier was granted despite the reader stream: no starvation.
    await barrier.release();
    stop = true;
    await readerLoop;

    const created = await auto.checkpointForTurn({ requestId: "req-after-barrier" });
    expect(created.status).toBe("created");
  });

  it("settles all three concurrently with no deadlock and records lock contention", async () => {
    const before = codingObservability.snapshot();
    const auto = autoService({ retention: { maxCount: 3 } });

    const results = await Promise.all([
      // Auto checkpoints, quiesced against restores.
      (async () => {
        const created: string[] = [];
        for (let index = 0; index < 4; index += 1) {
          const result = await withWorkspaceQuiesce(
            repo,
            { owner: `auto-${index}`, timeoutMs: 15_000 },
            () => auto.checkpointForTurn({ requestId: `concurrent-${index}` }),
          );
          if (result.checkpointId) created.push(result.checkpointId);
        }
        return created;
      })(),
      // A restore holding the workspace barrier.
      (async () => {
        const target = await service.createCheckpoint({ paths: ["src"], label: "restore-target" });
        await fs.writeFile(path.join(repo, "src", "b.txt"), "b-dirty\n", "utf8");
        const txn = new GitCheckpointTransactionService({ service, safetySnapshotEnabled: true });
        return await txn.restoreCheckpoint(target.checkpoint!.id, { paths: ["src/b.txt"] });
      })(),
      // UFTK writers on individual files.
      (async () => {
        const done: string[] = [];
        for (const name of ["a.txt", "b.txt"]) {
          await withFileMutationQueue(path.join(repo, "src", name), async () => {
            await new Promise((resolve) => setTimeout(resolve, 15));
            done.push(name);
          });
        }
        return done;
      })(),
    ]);

    const [checkpoints, restore, writes] = results;
    // Everything settled: no deadlock, no timeout.
    expect(Array.isArray(checkpoints)).toBe(true);
    expect(["restored", "conflict"]).toContain((restore as { status: string }).status);
    expect(writes).toEqual(["a.txt", "b.txt"]);

    const after = codingObservability.snapshot();
    // Lock observability moved: the three parties genuinely contended.
    expect(after.lockContention).toBeGreaterThan(before.lockContention);
    expect(after.lockWaitMs).toBeGreaterThanOrEqual(before.lockWaitMs);
    expect(after.lockTimeout).toBe(before.lockTimeout);
  });
});

describe("journal boundary", () => {
  it("does not import the write journal or FTS rollback", async () => {
    const source = await fs.readFile(path.join(import.meta.dirname, "auto-checkpoint.ts"), "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!);
    expect(imports.some((spec) => spec.includes("write-journal"))).toBe(false);
    expect(imports.some((spec) => spec.includes("file-transaction-service"))).toBe(false);
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toContain("reset --hard");
    expect(codeOnly).not.toContain("clean -f");
  });
});
