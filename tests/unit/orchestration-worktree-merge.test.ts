import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mergeOrchestrationWorktrees } from "../../openclaw_runtime/src/agents/orchestration-worktree-merge";
import { createWorktreeService } from "../../openclaw_runtime/src/agents/worktree-service";

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
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("orchestration worktree merge evidence", () => {
  it("merges the first overlapping worktree and records the conflict for the second", () => {
    const root = makeRoot();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "base", "utf8");
    const service = createWorktreeService(root);
    const first = service.create("wt-a", { writeSet: ["src/a.ts"], seedFiles: ["src/a.ts"] });
    const second = service.create("wt-b", { writeSet: ["src/a.ts"], seedFiles: ["src/a.ts"] });
    writeFileSync(join(first.root, "src", "a.ts"), "from-a", "utf8");
    writeFileSync(join(second.root, "src", "a.ts"), "from-b", "utf8");

    const results = mergeOrchestrationWorktrees({
      baseRoot: root,
      workers: [
        { taskNodeId: "node-a", worktreeId: "wt-a", declaredWriteSet: ["src/a.ts"] },
        { taskNodeId: "node-b", worktreeId: "wt-b", declaredWriteSet: ["src/a.ts"] },
      ],
    });

    expect(results.map((result) => result.status)).toEqual(["merged", "conflict"]);
    expect(results[1]?.reason).toContain("overlap_with_wt-a");
    expect(readFileSync(join(root, "src", "a.ts"), "utf8")).toBe("from-a");
  });

  it("reports declared-vs-actual write-set drift from the git worktree status", () => {
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

    const results = mergeOrchestrationWorktrees({
      baseRoot: root,
      workers: [
        {
          taskNodeId: "node-mismatch",
          worktreeId: "wt-mismatch",
          declaredWriteSet: ["src/declared.ts"],
        },
      ],
    });

    expect(results[0]?.changedFilesSource).toBe("git-status");
    expect(results[0]?.changedFiles).toContain("src/actual.ts");
    expect(results[0]?.writeSetMismatch).toEqual(["src/actual.ts", "src/declared.ts"]);
    expect(results[0]?.reason).toContain("writeSet_mismatch:src/actual.ts,src/declared.ts");
    service.cleanup("wt-mismatch");
  });
});
describe("worktree long-session ownership", () => {
  const owner = {
    agentId: "agent-a",
    sessionKey: "agent:agent-a:long",
    expectedSessionId: "generation-1",
  } as const;

  it("cleans only explicit ephemeral worktrees for the exact generation", () => {
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
