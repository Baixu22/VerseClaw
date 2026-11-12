import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freezeOrchestrationWorktreeCandidate, mergeOrchestrationWorktrees } from "../../openclaw_runtime/src/agents/orchestration-worktree-merge";
import { createWorktreeService } from "../../openclaw_runtime/src/agents/worktree-service";
import { applyWorktreeFiles, captureWorktreeFiles } from "../../openclaw_runtime/src/agents/worktree-merge-files";
import { journaledGitApply } from "../../openclaw_runtime/src/plugin-sdk/journaled-git-apply";
import { __resetWriteJournals, undoLastWrites } from "../../openclaw_runtime/src/agents/tools/write-journal-core";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "clawx-worktree-merge-"));
  roots.push(root);
  return root;
}

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "ignore", windowsHide: true });
}

afterEach(() => {
  __resetWriteJournals();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("orchestration worktree merge evidence", () => {
  it("merges the first overlapping worktree and records the conflict for the second", async () => {
    const root = makeRoot();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "base", "utf8");
    const service = createWorktreeService(root);
    const first = service.create("wt-a", { writeSet: ["src/a.ts"], seedFiles: ["src/a.ts"] });
    const second = service.create("wt-b", { writeSet: ["src/a.ts"], seedFiles: ["src/a.ts"] });
    writeFileSync(join(first.root, "src", "a.ts"), "from-a", "utf8");
    writeFileSync(join(second.root, "src", "a.ts"), "from-b", "utf8");

    const results = await mergeOrchestrationWorktrees({
      baseRoot: root,
      workers: [
        { taskNodeId: "node-a", worktreeId: "wt-a", worktreeGeneration: first.generation, declaredWriteSet: ["src/a.ts"] },
        { taskNodeId: "node-b", worktreeId: "wt-b", worktreeGeneration: second.generation, declaredWriteSet: ["src/a.ts"] },
      ],
    });

    expect(results.map((result) => result.status)).toEqual(["merged", "conflict"]);
    expect(results[1]?.reason).toContain("overlap_with_wt-a");
    expect(readFileSync(join(root, "src", "a.ts"), "utf8")).toBe("from-a");
  });

  it("reports declared-vs-actual write-set drift from the git worktree status", async () => {
    const root = makeRoot();
    git(["init"], root);
    git(["config", "user.email", "agent@example.invalid"], root);
    git(["config", "user.name", "Agent"], root);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "base.ts"), "base", "utf8");
    git(["add", "."], root);
    git(["commit", "-m", "init"], root);

    const service = createWorktreeService(root, { backend: "git" });
    const worktree = service.create("wt-mismatch", { writeSet: ["src/declared.ts"] });
    mkdirSync(join(worktree.root, "src"), { recursive: true });
    writeFileSync(join(worktree.root, "src", "actual.ts"), "actual", "utf8");

    const results = await mergeOrchestrationWorktrees({
      baseRoot: root,
      workers: [
        {
          taskNodeId: "node-mismatch",
          worktreeId: "wt-mismatch",
          worktreeGeneration: worktree.generation,
          declaredWriteSet: ["src/declared.ts"],
        },
      ],
    });

    expect(results[0]?.changedFilesSource).toBe("worktree-snapshot");
    expect(results[0]?.changedFiles).toContain("src/actual.ts");
    expect(results[0]?.writeSetMismatch).toEqual(["src/actual.ts", "src/declared.ts"]);
    expect(results[0]?.reason).toContain("writeSet_mismatch:src/actual.ts,src/declared.ts");
    expect(() => service.cleanup("wt-mismatch")).toThrow(/worktree_cleanup_user_content_present/);
    rmSync(join(worktree.root, "src", "actual.ts"), { force: true });
    service.cleanup("wt-mismatch");
  });
});
it('rejects late merge, freeze and cleanup requests after the same id is recreated', async () => {
  const root = makeRoot();
  const service = createWorktreeService(root);
  const old = service.create('same');
  service.cleanup(old.id);
  const current = service.create('same');
  writeFileSync(join(current.root, 'retained.txt'), 'new work');
  const workers = [{ taskNodeId: 'old-task', worktreeId: old.id, worktreeGeneration: old.generation }];
  await expect(mergeOrchestrationWorktrees({ baseRoot: root, workers })).rejects.toThrow(/stale_generation/);
  expect(() => freezeOrchestrationWorktreeCandidate({ baseRoot: root, workers })).toThrow(/stale_generation/);
  expect(() => service.cleanup(old.id, { expectedGeneration: old.generation })).toThrow(/stale_generation/);
  expect(readFileSync(join(current.root, 'retained.txt'), 'utf8')).toBe('new work');
});
describe("worktree long-session ownership", () => {
  const owner = {
    agentId: "agent-a",
    sessionKey: "agent:agent-a:long",
    expectedSessionId: "generation-1",
  } as const;

  it("cleans only explicit ephemeral worktrees for the exact generation", async () => {
    const root = makeRoot();
    const service = createWorktreeService(root);
    const kept = service.create("wt-keep", { owner: { ...owner, retention: "keep" } });
    const cleaned = service.create("wt-delete", { owner: { ...owner, retention: "delete" } });

    expect(service.listOwned(owner).map((record) => record.id).sort()).toEqual(["wt-delete", "wt-keep"]);
    expect(service.cleanupOwned(owner)).toMatchObject({
      attempted: 2,
      reclaimed: 1,
      kept: 1,
      failed: 0,
    });
    expect(existsSync(kept.root)).toBe(true);
    expect(existsSync(cleaned.root)).toBe(false);

    expect(service.cleanupOwned({ ...owner, expectedSessionId: "generation-2" })).toMatchObject({
      attempted: 0,
      reclaimed: 0,
      kept: 0,
    });
    expect(existsSync(kept.root)).toBe(true);
  });

  it("rejects a new owned worktree before filesystem creation when maxWorktrees is reached", () => {
    const previous = process.env.OPENCLAW_LONG_SESSION_MAX_WORKTREES;
    process.env.OPENCLAW_LONG_SESSION_MAX_WORKTREES = "1";
    try {
      const root = makeRoot();
      const service = createWorktreeService(root);
      service.create("wt-one", { owner: { ...owner, retention: "delete" } });
      expect(() => service.create("wt-two", { owner: { ...owner, retention: "delete" } }))
        .toThrow(/maxWorktrees:limit-exceeded/);
      expect(existsSync(join(root, ".openclaw", "worktrees", "wt-two"))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.OPENCLAW_LONG_SESSION_MAX_WORKTREES;
      else process.env.OPENCLAW_LONG_SESSION_MAX_WORKTREES = previous;
    }
  });
});

describe.each(['inprocess', 'git'] as const)('TF-0769 %s merge contents', (backend) => {
  function fixture() {
    const root = makeRoot();
    writeFileSync(join(root, 'a.txt'), 'baseline');
    if (backend === 'git') {
      git(['init'], root);
      git(['add', 'a.txt'], root);
      git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture'], root);
    }
    const service = createWorktreeService(root, { backend });
    const worker = service.create('worker', { writeSet: ['a.txt', 'b.txt'], seedFiles: ['a.txt'] });
    const merge = () => mergeOrchestrationWorktrees({
      baseRoot: root,
      workers: [{ taskNodeId: 'node', worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['a.txt', 'b.txt'] }],
    });
    return { root, worker, merge, service };
  }

  it('removes a file deleted by the worker before reporting merged', async () => {
    const { root, worker, merge } = fixture();
    unlinkSync(join(worker.root, 'a.txt'));
    const result = await merge();
    expect(result[0]?.status).toBe('merged');
    expect(existsSync(join(root, 'a.txt'))).toBe(false);
  });

  it('rejects a concurrent base edit and preserves its bytes', async () => {
    const { root, worker, merge } = fixture();
    writeFileSync(join(worker.root, 'a.txt'), 'worker edit');
    writeFileSync(join(root, 'a.txt'), 'concurrent owner edit');
    const result = await merge();
    expect(result[0]?.status).toBe('conflict');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('concurrent owner edit');
  });

  it('preserves both sides of a rename as deletion and addition', async () => {
    const { root, worker, merge } = fixture();
    writeFileSync(join(worker.root, 'b.txt'), readFileSync(join(worker.root, 'a.txt')));
    unlinkSync(join(worker.root, 'a.txt'));
    const result = await merge();
    expect(result[0]?.status).toBe('merged');
    expect(existsSync(join(root, 'a.txt'))).toBe(false);
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('baseline');
  });

  it('does not recreate a concurrently deleted target from a worker edit', async () => {
    const { root, worker, merge } = fixture();
    writeFileSync(join(worker.root, 'a.txt'), 'worker edit');
    unlinkSync(join(root, 'a.txt'));
    const result = await merge();
    expect(result[0]?.status).toBe('conflict');
    expect(existsSync(join(root, 'a.txt'))).toBe(false);
  });

  it('accepts an already-converged deletion without recreating it', async () => {
    const { root, worker, merge } = fixture();
    unlinkSync(join(worker.root, 'a.txt'));
    unlinkSync(join(root, 'a.txt'));
    const result = await merge();
    expect(result[0]?.status).toBe('merged');
    expect(existsSync(join(root, 'a.txt'))).toBe(false);
  });

  it('preserves arbitrary bytes and supplies matching hashes and undo through the existing journal', async () => {
    const { root, worker, merge } = fixture();
    const bytes = Buffer.from([0, 255, 13, 10, 128]);
    writeFileSync(join(worker.root, 'b.txt'), bytes);
    const result = await merge();
    expect(result[0]?.status).toBe('merged');
    expect(readFileSync(join(root, 'b.txt'))).toEqual(bytes);
    expect(result[0]?.hashes?.['b.txt']).toBe(createHash('sha256').update(bytes).digest('hex'));
    const sessionId = result[0]!.journalRef!.split(':').slice(1, -1).join(':');
    const undo = await undoLastWrites({ workspaceRoot: root, sessionId, steps: 1, workspaceOnly: true });
    expect(undo.errors).toEqual([]);
    expect(existsSync(join(root, 'b.txt'))).toBe(false);
  });

  it('repeated merges are idempotent and do not hide a later base edit', async () => {
    const { root, worker, merge } = fixture();
    writeFileSync(join(worker.root, 'a.txt'), 'worker');
    expect((await merge())[0]?.status).toBe('merged');
    const second = await merge();
    expect(second[0]?.status).toBe('merged');
    expect(second[0]?.journalRef).toBeUndefined();
    writeFileSync(join(root, 'a.txt'), 'later user edit');
    expect((await merge())[0]?.status).toBe('conflict');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('later user edit');
  });

  it('duplicate concurrent completion merges return the same successful result', async () => {
    const { root, worker, merge } = fixture();
    writeFileSync(join(worker.root, 'a.txt'), 'worker');
    const results = await Promise.all([merge(), merge()]);
    expect(results.map((rows) => rows[0]?.status)).toEqual(['merged', 'merged']);
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('worker');
  });

  it('retains user changes, including staged bytes and a stale Git base', async () => {
    const { root, worker, merge } = fixture();
    writeFileSync(join(worker.root, 'a.txt'), 'worker');
    writeFileSync(join(root, 'a.txt'), 'staged user bytes');
    if (backend === 'git') git(['add', 'a.txt'], root);
    writeFileSync(join(root, 'a.txt'), 'unstaged user bytes');
    expect((await merge())[0]?.status).toBe('conflict');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('unstaged user bytes');
    if (backend === 'git') {
      expect(execFileSync('git', ['show', ':a.txt'], { cwd: root, encoding: 'utf8', windowsHide: true })).toBe('staged user bytes');
      git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'concurrent commit'], root);
      expect((await merge())[0]?.reason).toContain('base_head_changed');
    }
  });

  it('rejects target drift after freezing the worker but before applying it', async () => {
    const { root, worker } = fixture();
    const baseline = { parent: captureWorktreeFiles(root), worker: captureWorktreeFiles(worker.root) };
    writeFileSync(join(worker.root, 'a.txt'), 'worker');
    let checks = 0;
    const outcome = await applyWorktreeFiles({ baseRoot: root, workerRoot: worker.root, sessionKey: 'race',
      baseline, files: ['a.txt'], assertCurrent() {
        if (++checks === 2) writeFileSync(join(root, 'a.txt'), 'concurrent after freeze');
      },
    });
    expect(outcome.success).toBe(false);
    expect(outcome.reason).toContain('base_changed_before_apply');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('concurrent after freeze');
  });

  it('does not lose unselected merge requests', async () => {
    const { worker, service } = fixture();
    writeFileSync(join(worker.root, 'a.txt'), 'worker');
    service.enqueueMerge({ worktreeId: worker.id, changedFiles: ['a.txt'] });
    service.enqueueMerge({ worktreeId: 'other', changedFiles: ['other.txt'] });
    await service.processMergeQueue(undefined, { worktreeIds: [worker.id] });
    expect(service.getMergeQueue().map((item) => item.worktreeId)).toEqual(['other']);
  });

  it('rejects a hardlinked source instead of reading or copying outside bytes', async () => {
    const { root, worker, merge } = fixture();
    const outside = makeRoot();
    writeFileSync(join(outside, 'private.txt'), 'outside private bytes');
    unlinkSync(join(worker.root, 'a.txt'));
    linkSync(join(outside, 'private.txt'), join(worker.root, 'a.txt'));
    expect((await merge())[0]?.status).toBe('conflict');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('baseline');
    expect(readFileSync(join(outside, 'private.txt'), 'utf8')).toBe('outside private bytes');
  });

  it('rejects a replaced destination parent directory without writing outside the workspace', async () => {
    const root = makeRoot(); const outside = makeRoot();
    mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/a.txt'), 'baseline');
    writeFileSync(join(outside, 'a.txt'), 'outside');
    if (backend === 'git') {
      git(['init'], root); git(['add', '.'], root);
      git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture'], root);
    }
    const service = createWorktreeService(root, { backend });
    const worker = service.create('directory-swap', { seedFiles: ['src/a.txt'] });
    writeFileSync(join(worker.root, 'src/a.txt'), 'worker');
    rmSync(join(root, 'src'), { recursive: true });
    symlinkSync(outside, join(root, 'src'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await mergeOrchestrationWorktrees({ baseRoot: root,
      workers: [{ taskNodeId: 'swap', worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['src/a.txt'] }] });
    expect(result[0]?.status).toBe('conflict');
    expect(readFileSync(join(outside, 'a.txt'), 'utf8')).toBe('outside');
  });
});

describe('TF-0769 existing journal rollback', () => {
  it.each([false, true])('handles a partial write without clobbering concurrent changes (%s)', async (concurrent) => {
    const root = makeRoot();
    const a = join(root, 'a.txt'); const b = join(root, 'b.txt');
    writeFileSync(a, 'original a'); writeFileSync(b, 'original b');
    const outcome = await journaledGitApply({ workspaceRoot: root, sessionKey: 'partial', paths: [a, b],
      expectedPostimages: new Map([[a, Buffer.from('worker a')], [b, Buffer.from('worker b')]]),
      validate: async () => {}, preflight: async () => ({ success: true }),
      apply: async () => {
        writeFileSync(a, 'worker a');
        if (concurrent) writeFileSync(a, 'external concurrent bytes');
        throw new Error('second-file write failed');
      },
    });
    expect(outcome.error).toContain('second-file write failed');
    expect(readFileSync(a, 'utf8')).toBe(concurrent ? 'external concurrent bytes' : 'original a');
    expect(readFileSync(b, 'utf8')).toBe('original b');
    expect(outcome.recoveryRequired).toBe(concurrent);
    if (concurrent) expect(outcome.journalRef).toBeTruthy();
  });
});
