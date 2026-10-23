import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(() => service.cleanup("wt-mismatch")).toThrow(/worktree_cleanup_user_content_present/);
    rmSync(join(worktree.root, "src", "actual.ts"), { force: true });
    service.cleanup("wt-mismatch");
  });
});