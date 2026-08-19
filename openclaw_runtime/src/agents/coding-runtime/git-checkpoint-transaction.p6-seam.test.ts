/**
 * P6 combined acceptance probe: the P6A <-> P6B seam.
 *
 * P6A's own suites verify the scheduler with synthetic keys. P6B's own suites
 * verify the barrier with `acquireWorkspaceRestoreBarrier` on *both* sides --
 * workspace-scope versus workspace-scope. Neither exercises the claim that
 * actually matters when A and B run together, and that
 * `git-checkpoint-transaction.ts` states in a comment as its reason for taking
 * no per-path locks:
 *
 *   "The P6A workspace barrier is a workspace-scoped writer lock: it already
 *    excludes every UFTK read/write lock under the root."
 *
 * If that were false, a restore would take no per-path locks AND fail to
 * exclude per-path writers -- a real UFTK write could land in the middle of an
 * apply. So this file drives a real two-phase restore and a real
 * `acquireCodingRuntimeFileLocks` against each other, in both directions.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodingRuntimeError } from "./coding-runtime-error.js";
import {
  acquireCodingRuntimeFileLocks,
  resetCodingRuntimeFileLocksForTest,
} from "./file-lock-manager.js";
import { GitCheckpointService } from "./git-checkpoint.js";
import { GitCheckpointTransactionService } from "./git-checkpoint-transaction.js";
import { drainSessionWriteLockStateForTest } from "../session-write-lock.js";

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
let service: GitCheckpointService;
let inScope: string;
let outOfScope: string;

/** Short barrier budget so the "restore waits" direction fails fast instead of hanging. */
const BARRIER_TIMEOUT_MS = 400;
/** Short writer budget so the excluded-writer direction is a bounded failure. */
const WRITER_TIMEOUT_MS = 250;

function transaction(): GitCheckpointTransactionService {
  return new GitCheckpointTransactionService({ service, safetySnapshotEnabled: true });
}

async function expectLockTimeout(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(CodingRuntimeError);
  await promise.then(
    () => {
      throw new Error("expected a lock timeout, but the lock was granted");
    },
    (caught: unknown) => {
      expect((caught as CodingRuntimeError).code).toBe("E_LOCK_TIMEOUT");
    },
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-p6-seam-"));
  repo = path.join(root, "repo");
  state = path.join(root, "state");
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await git(["init", "-q"], repo);
  await git(["config", "user.email", "test@example.invalid"], repo);
  await git(["config", "user.name", "UFTK Test"], repo);
  await git(["config", "core.autocrlf", "false"], repo);
  inScope = path.join(repo, "src", "a.txt");
  outOfScope = path.join(repo, "keep.txt");
  await fs.writeFile(inScope, "a-base\n", "utf8");
  await fs.writeFile(outOfScope, "keep-base\n", "utf8");
  await git(["add", "."], repo);
  await git(["commit", "-qm", "initial"], repo);
  resetCodingRuntimeFileLocksForTest();
  service = new GitCheckpointService({
    workspaceRoot: repo,
    enabled: true,
    pathScopedEnabled: true,
    concurrencyV2Enabled: true,
    stateDir: state,
    restoreLockTimeoutMs: BARRIER_TIMEOUT_MS,
    warn: () => {},
  });
});

afterEach(async () => {
  resetCodingRuntimeFileLocksForTest();
  await drainSessionWriteLockStateForTest().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
});

describe("a prepared restore excludes real per-path UFTK locks", () => {
  it("blocks a file-scope writer until settle, then lets it through", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    expect(created.status).toBe("created");
    await fs.writeFile(inScope, "a-dirty\n", "utf8");

    const prepared = await transaction().prepare(created.checkpoint!.id, { paths: ["src"] });
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;

    // The load-bearing assertion: the barrier alone excludes a per-path writer.
    // The restore deliberately takes no per-path locks, so if this passed, an
    // apply and a UFTK write could interleave on the same file.
    await expectLockTimeout(
      acquireCodingRuntimeFileLocks([inScope], {
        mode: "write",
        owner: "seam-writer",
        timeoutMs: WRITER_TIMEOUT_MS,
      }),
    );

    const settled = await transaction().applyAndSettle(prepared.prepared);
    expect(settled.status).toBe("restored");
    expect(await fs.readFile(inScope, "utf8")).toBe("a-base\n");

    // Settle released the barrier, so the same writer now succeeds.
    const handle = await acquireCodingRuntimeFileLocks([inScope], {
      mode: "write",
      owner: "seam-writer",
      timeoutMs: WRITER_TIMEOUT_MS,
    });
    await handle.release();
  });

  it("blocks a reader too, because the barrier is a writer lock", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(inScope, "a-dirty\n", "utf8");
    const prepared = await transaction().prepare(created.checkpoint!.id, { paths: ["src"] });
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;

    // A shared read during an apply would observe a half-restored tree.
    await expectLockTimeout(
      acquireCodingRuntimeFileLocks([inScope], {
        mode: "read",
        owner: "seam-reader",
        timeoutMs: WRITER_TIMEOUT_MS,
      }),
    );

    await prepared.prepared.release();
  });

  it("excludes paths outside the restore scope, because the barrier is workspace-wide", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(inScope, "a-dirty\n", "utf8");
    const prepared = await transaction().prepare(created.checkpoint!.id, { paths: ["src"] });
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;

    // `keep.txt` is outside the restore scope and the restore will not touch it,
    // yet the barrier still excludes it. Pinning this keeps a future change from
    // narrowing the barrier to the scope on the assumption that it already is:
    // the exclusion is broader than the mutation, and that is the safe direction.
    await expectLockTimeout(
      acquireCodingRuntimeFileLocks([outOfScope], {
        mode: "write",
        owner: "seam-writer-out-of-scope",
        timeoutMs: WRITER_TIMEOUT_MS,
      }),
    );

    await prepared.prepared.release();
    expect(await fs.readFile(outOfScope, "utf8")).toBe("keep-base\n");
  });
});

describe("a restore waits for in-flight per-path writers instead of cutting in", () => {
  it("fails the prepare with a bounded lock error while a file writer holds", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(inScope, "a-dirty\n", "utf8");

    const writer = await acquireCodingRuntimeFileLocks([inScope], {
      mode: "write",
      owner: "in-flight-writer",
      timeoutMs: 5_000,
    });

    // The restore must not proceed while a UFTK write is in flight. With a short
    // barrier budget that surfaces as a bounded structured rejection rather than
    // an unbounded wait -- and critically, with the dirty file untouched.
    const rejected = await transaction().prepare(created.checkpoint!.id, { paths: ["src"] });
    expect(rejected.status).toBe("rejected");
    if (rejected.status === "rejected") {
      expect(rejected.result.status).toBe("failed");
      expect(rejected.result.reason ?? "").toMatch(/lock|timeout/i);
    }
    expect(await fs.readFile(inScope, "utf8")).toBe("a-dirty\n");

    // After the writer drains, the same restore succeeds.
    await writer.release();
    const settled = await transaction().restoreCheckpoint(created.checkpoint!.id, {
      paths: ["src"],
    });
    expect(settled.status).toBe("restored");
    expect(await fs.readFile(inScope, "utf8")).toBe("a-base\n");
  });

  it("leaves no barrier behind when the prepare is rejected on a lock", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    const writer = await acquireCodingRuntimeFileLocks([inScope], {
      mode: "write",
      owner: "in-flight-writer",
      timeoutMs: 5_000,
    });
    const rejected = await transaction().prepare(created.checkpoint!.id, { paths: ["src"] });
    expect(rejected.status).toBe("rejected");
    await writer.release();

    // A rejected prepare that leaked the barrier would deadlock every later
    // writer in the process, so prove the workspace is usable again.
    const handle = await acquireCodingRuntimeFileLocks([outOfScope], {
      mode: "write",
      owner: "post-rejection-writer",
      timeoutMs: WRITER_TIMEOUT_MS,
    });
    await handle.release();
  });
});
