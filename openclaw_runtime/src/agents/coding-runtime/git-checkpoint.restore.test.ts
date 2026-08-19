import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCheckpointService } from "./git-checkpoint.js";

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

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-git-restore-"));
  repo = path.join(root, "repo");
  state = path.join(root, "state");
  await fs.mkdir(repo, { recursive: true });
  await git(["init", "-q"], repo);
  await git(["config", "user.email", "test@example.invalid"], repo);
  await git(["config", "user.name", "UFTK Test"], repo);
  await git(["config", "core.autocrlf", "false"], repo);
  await fs.writeFile(path.join(repo, "a.txt"), "base-a\n", "utf8");
  await fs.writeFile(path.join(repo, "b.txt"), "base-b\n", "utf8");
  await git(["add", "."], repo);
  await git(["commit", "-qm", "initial"], repo);
  service = new GitCheckpointService({ workspaceRoot: repo, enabled: true, stateDir: state });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("concurrent git checkpoint restore", () => {
  it("serializes two concurrent restores and never leaves a mixed worktree", async () => {
    await fs.writeFile(path.join(repo, "a.txt"), "A\n", "utf8");
    await fs.writeFile(path.join(repo, "b.txt"), "A\n", "utf8");
    await git(["add", "."], repo);
    await git(["commit", "-qm", "state-A"], repo);
    const checkpointA = await service.createCheckpoint();
    expect(checkpointA.status).toBe("created");

    await fs.writeFile(path.join(repo, "a.txt"), "B\n", "utf8");
    await fs.writeFile(path.join(repo, "b.txt"), "B\n", "utf8");
    await fs.writeFile(path.join(repo, "c.txt"), "B\n", "utf8");
    const checkpointB = await service.createCheckpoint();
    expect(checkpointB.status).toBe("created");

    const results = await Promise.all([
      service.restoreCheckpoint(checkpointA.checkpoint!.id),
      service.restoreCheckpoint(checkpointB.checkpoint!.id),
    ]);
    expect(results.map((result) => result.status)).toEqual(["restored", "restored"]);

    const a = await fs.readFile(path.join(repo, "a.txt"), "utf8");
    const b = await fs.readFile(path.join(repo, "b.txt"), "utf8");
    const cExists = await fs
      .access(path.join(repo, "c.txt"))
      .then(() => true)
      .catch(() => false);
    const stateA = a === "A\n" && b === "A\n" && !cExists;
    const stateB = a === "B\n" && b === "B\n" && cExists;
    expect(stateA || stateB).toBe(true);
    expect(await git(["diff", "--name-only"], repo)).toBe("");
  });
});

describe("git checkpoint restore failures", () => {
  it("returns structured failure with diagnostic when a target path is blocked by a directory", async () => {
    await fs.writeFile(path.join(repo, "blocked.txt"), "base\n", "utf8");
    await git(["add", "."], repo);
    await git(["commit", "-qm", "blocked-base"], repo);
    const created = await service.createCheckpoint();
    expect(created.status).toBe("created");

    await fs.rm(path.join(repo, "blocked.txt"));
    await fs.mkdir(path.join(repo, "blocked.txt"), { recursive: true });
    await fs.writeFile(path.join(repo, "blocked.txt", "inner.txt"), "keep-me\n", "utf8");

    const warnings: string[] = [];
    const warningService = new GitCheckpointService({
      workspaceRoot: repo,
      enabled: true,
      stateDir: state,
      warn: (message) => warnings.push(message),
    });
    const restored = await warningService.restoreCheckpoint(created.checkpoint!.id);
    expect(restored.status).toBe("conflict");
    expect(restored.error).toMatchObject({ code: "E_GIT_CHECKPOINT_CONFLICT" });
    expect(restored.diagnostic?.beforeTracked).toContain("blocked.txt");
    expect(restored.diagnostic?.targetPaths).toContain("blocked.txt");
    expect(warnings.some((message) => message.includes("restore"))).toBe(true);

    // Nothing is silently lost: the blocking user content is still present and diagnosable.
    expect(await fs.readFile(path.join(repo, "blocked.txt", "inner.txt"), "utf8")).toBe("keep-me\n");
  });
});
