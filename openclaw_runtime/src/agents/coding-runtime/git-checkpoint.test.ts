import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GIT_CHECKPOINT_REF_PREFIX,
  GitCheckpointService,
} from "./git-checkpoint.js";

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
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-git-checkpoint-"));
  repo = path.join(root, "repo");
  state = path.join(root, "state");
  await fs.mkdir(repo, { recursive: true });
  await git(["init", "-q"], repo);
  await git(["config", "user.email", "test@example.invalid"], repo);
  await git(["config", "user.name", "UFTK Test"], repo);
  await git(["config", "core.autocrlf", "false"], repo);
  await fs.writeFile(path.join(repo, "base.txt"), "base\n", "utf8");
  await git(["add", "."], repo);
  await git(["commit", "-qm", "initial"], repo);
  service = new GitCheckpointService({ workspaceRoot: repo, enabled: true, stateDir: state });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("GitCheckpointService create", () => {
  it("creates a private-ref checkpoint and leaves index/worktree unchanged", async () => {
    const beforeStatus = await git(["status", "--porcelain=v1"], repo);
    const result = await service.createCheckpoint();
    expect(result.status).toBe("created");
    expect(result.checkpoint?.id).toMatch(/^[0-9a-f]{40}$/);
    expect(result.indexWorktreeUnchanged).toBe(true);
    expect(await git(["status", "--porcelain=v1"], repo)).toBe(beforeStatus);

    await expect(
      git(["show-ref", "--verify", `${GIT_CHECKPOINT_REF_PREFIX}/${result.checkpoint!.id}`], repo),
    ).resolves.toContain(result.checkpoint!.id);

    const list = await service.listCheckpoints();
    expect(list.status).toBe("ok");
    expect(list.checkpoints).toHaveLength(1);
    expect(list.checkpoints[0]?.id).toBe(result.checkpoint?.id);
    expect(list.checkpoints[0]?.workspaceRoot).toBe(repo);
  });

  it("is disabled by default and does not create refs", async () => {
    const disabled = new GitCheckpointService({ workspaceRoot: repo, stateDir: state });
    await expect(disabled.createCheckpoint()).resolves.toMatchObject({ status: "disabled" });
    await expect(disabled.listCheckpoints()).resolves.toMatchObject({ status: "disabled", checkpoints: [] });
    await expect(disabled.restoreCheckpoint("abc")).resolves.toMatchObject({ status: "disabled" });
    expect(await git(["for-each-ref", GIT_CHECKPOINT_REF_PREFIX], repo)).toBe("");
  });
});

describe("GitCheckpointService restore", () => {
  it("restores modified, deleted, and newly-added files to the checkpoint", async () => {
    await fs.writeFile(path.join(repo, "mod.txt"), "before\n", "utf8");
    await fs.writeFile(path.join(repo, "del.txt"), "delete-me\n", "utf8");
    await fs.mkdir(path.join(repo, "nested"), { recursive: true });
    await fs.writeFile(path.join(repo, "nested", "inner.txt"), "inner\n", "utf8");
    await git(["add", "."], repo);
    await git(["commit", "-qm", "checkpoint-base"], repo);
    const created = await service.createCheckpoint();
    expect(created.status).toBe("created");

    await fs.writeFile(path.join(repo, "mod.txt"), "after\n", "utf8");
    await fs.rm(path.join(repo, "del.txt"));
    await fs.writeFile(path.join(repo, "added.txt"), "added\n", "utf8");
    await fs.writeFile(path.join(repo, "nested", "inner.txt"), "changed\n", "utf8");

    const restored = await service.restoreCheckpoint(created.checkpoint!.id);
    expect(restored.status).toBe("restored");
    expect(await fs.readFile(path.join(repo, "mod.txt"), "utf8")).toBe("before\n");
    expect(await fs.readFile(path.join(repo, "del.txt"), "utf8")).toBe("delete-me\n");
    await expect(fs.access(path.join(repo, "added.txt"))).rejects.toThrow();
    expect(await fs.readFile(path.join(repo, "nested", "inner.txt"), "utf8")).toBe("inner\n");
    expect(await git(["status", "--porcelain=v1"], repo)).toBe("");
  });

  it("returns structured not_found for unknown checkpoint ids", async () => {
    const restored = await service.restoreCheckpoint("0000000000000000000000000000000000000000");
    expect(restored.status).toBe("not_found");
    expect(restored.error).toMatchObject({ code: "E_GIT_CHECKPOINT_NOT_FOUND" });
  });

  it("returns explicit unsupported for non-git workspaces", async () => {
    const nonGit = path.join(root, "not-a-repo");
    await fs.mkdir(nonGit, { recursive: true });
    const nonGitService = new GitCheckpointService({ workspaceRoot: nonGit, enabled: true, stateDir: state });
    await expect(nonGitService.createCheckpoint()).resolves.toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("not a git"),
    });
    await expect(nonGitService.restoreCheckpoint("abc")).resolves.toMatchObject({
      status: "unsupported",
    });
    await expect(nonGitService.listCheckpoints()).resolves.toMatchObject({
      status: "unsupported",
      checkpoints: [],
    });
  });

  it("warns and returns unsupported for nested .git/submodule markers", async () => {
    const nested = path.join(repo, "nested-repo");
    await fs.mkdir(nested, { recursive: true });
    await git(["init", "-q"], nested);
    const warnings: string[] = [];
    const nestedService = new GitCheckpointService({
      workspaceRoot: repo,
      enabled: true,
      stateDir: state,
      warn: (message) => warnings.push(message),
    });
    await expect(nestedService.createCheckpoint()).resolves.toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("nested .git"),
    });
    await expect(nestedService.restoreCheckpoint("abc")).resolves.toMatchObject({
      status: "unsupported",
    });
    expect(warnings.some((message) => message.includes("nested .git"))).toBe(true);
  });
});
