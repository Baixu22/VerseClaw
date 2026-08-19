import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decodeCheckpointMetadata,
  encodeCheckpointMessage,
  GIT_CHECKPOINT_REF_PREFIX,
  GitCheckpointService,
  normalizeCheckpointScope,
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

async function initRepo(repo: string): Promise<void> {
  await fs.mkdir(repo, { recursive: true });
  await git(["init", "-q"], repo);
  await git(["config", "user.email", "test@example.invalid"], repo);
  await git(["config", "user.name", "UFTK Test"], repo);
  await git(["config", "core.autocrlf", "false"], repo);
}

let root: string;
let repo: string;
let state: string;
let warnings: string[];
let service: GitCheckpointService;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-git-scoped-"));
  repo = path.join(root, "repo");
  state = path.join(root, "state");
  warnings = [];
  await initRepo(repo);
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await fs.mkdir(path.join(repo, "other"), { recursive: true });
  await fs.writeFile(path.join(repo, "src", "a.txt"), "a-base\n", "utf8");
  await fs.writeFile(path.join(repo, "src", "b.txt"), "b-base\n", "utf8");
  await fs.writeFile(path.join(repo, "other", "c.txt"), "c-base\n", "utf8");
  await git(["add", "."], repo);
  await git(["commit", "-qm", "initial"], repo);
  service = new GitCheckpointService({
    workspaceRoot: repo,
    enabled: true,
    pathScopedEnabled: true,
    stateDir: state,
    warn: (message) => warnings.push(message),
  });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("path-scoped checkpoint create", () => {
  it("writes a scope-only tree to a private ref and leaves index/worktree unchanged", async () => {
    const beforeStatus = await git(["status", "--porcelain=v1"], repo);
    const created = await service.createCheckpoint({ paths: ["src"], label: "scoped one" });
    expect(created.status).toBe("created");
    expect(created.indexWorktreeUnchanged).toBe(true);
    expect(await git(["status", "--porcelain=v1"], repo)).toBe(beforeStatus);

    expect(created.checkpoint?.scope).toEqual({ kind: "paths", paths: ["src"] });
    expect(created.checkpoint?.label).toBe("scoped one");
    await expect(
      git(["show-ref", "--verify", `${GIT_CHECKPOINT_REF_PREFIX}/${created.checkpoint!.id}`], repo),
    ).resolves.toContain(created.checkpoint!.id);

    // The tree contains only the scope, which is what keeps scoped restore cheap.
    const treePaths = (await git(["ls-tree", "-r", "--name-only", created.checkpoint!.id], repo))
      .split(/\r?\n/)
      .filter(Boolean);
    expect(treePaths).toEqual(["src/a.txt", "src/b.txt"]);
  });

  it("round-trips scope and label through checkpoint metadata", async () => {
    const created = await service.createCheckpoint({ paths: ["src/a.txt"], label: "  spaced\nlabel  " });
    expect(created.status).toBe("created");
    const listed = await service.listCheckpoints();
    expect(listed.status).toBe("ok");
    const record = listed.checkpoints.find((item) => item.id === created.checkpoint?.id);
    expect(record?.scope).toEqual({ kind: "paths", paths: ["src/a.txt"] });
    expect(record?.label).toBe("spaced label");
    expect(record?.parent).toMatch(/^[0-9a-f]{40}$/);
  });

  it("treats a P5 whole-tree checkpoint as full scope", async () => {
    const created = await service.createCheckpoint();
    expect(created.checkpoint?.scope).toEqual({ kind: "full", paths: [] });
    const listed = await service.listCheckpoints();
    const record = listed.checkpoints.find((item) => item.id === created.checkpoint?.id);
    expect(record?.scope?.kind).toBe("full");
    expect(record?.label).toBeUndefined();
  });

  it("returns structured disabled for scoped APIs when the pathScoped flag is off", async () => {
    const flagOff = new GitCheckpointService({
      workspaceRoot: repo,
      enabled: true,
      stateDir: state,
      warn: (message) => warnings.push(message),
    });
    await expect(flagOff.createCheckpoint({ paths: ["src"] })).resolves.toMatchObject({
      status: "disabled",
      reason: expect.stringContaining("pathScoped"),
    });
    await expect(flagOff.restoreCheckpoint("abc", { paths: ["src"] })).resolves.toMatchObject({
      status: "disabled",
      reason: expect.stringContaining("pathScoped"),
    });
    // Whole-tree P5 behavior is unaffected by the P6B flag.
    await expect(flagOff.createCheckpoint()).resolves.toMatchObject({ status: "created" });
  });

  it("rejects scopes that escape the workspace or target internal paths", async () => {
    await expect(service.createCheckpoint({ paths: ["../outside"] })).resolves.toMatchObject({
      status: "failed",
      reason: expect.stringContaining("escapes the workspace"),
    });
    await expect(service.createCheckpoint({ paths: [".git"] })).resolves.toMatchObject({
      status: "failed",
      reason: expect.stringContaining(".git"),
    });
    await expect(service.createCheckpoint({ paths: ["."] })).resolves.toMatchObject({
      status: "failed",
      reason: expect.stringContaining("workspace root"),
    });
  });
});

describe("path-scoped checkpoint restore", () => {
  it("restores only in-scope paths and leaves out-of-scope status byte-identical", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    expect(created.status).toBe("created");

    // In-scope churn: modify, delete, add, and a nested addition.
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-dirty\n", "utf8");
    await fs.rm(path.join(repo, "src", "b.txt"));
    await fs.writeFile(path.join(repo, "src", "new.txt"), "new\n", "utf8");
    await fs.mkdir(path.join(repo, "src", "deep"), { recursive: true });
    await fs.writeFile(path.join(repo, "src", "deep", "nested.txt"), "nested\n", "utf8");
    // Out-of-scope churn that must survive untouched.
    await fs.writeFile(path.join(repo, "other", "c.txt"), "c-dirty\n", "utf8");
    await fs.writeFile(path.join(repo, "other", "untracked.txt"), "keep-me\n", "utf8");

    const outOfScopeBefore = (await git(["status", "--porcelain=v1"], repo))
      .split(/\r?\n/)
      .filter((line) => line.includes("other/"))
      .sort();

    const restored = await service.restoreCheckpoint(created.checkpoint!.id, { paths: ["src"] });
    expect(restored.status).toBe("restored");
    expect(restored.diagnostic?.scope).toEqual({ kind: "paths", paths: ["src"] });

    // In-scope reverted.
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-base\n");
    expect(await fs.readFile(path.join(repo, "src", "b.txt"), "utf8")).toBe("b-base\n");
    await expect(fs.access(path.join(repo, "src", "new.txt"))).rejects.toThrow();
    await expect(fs.access(path.join(repo, "src", "deep", "nested.txt"))).rejects.toThrow();

    // Out-of-scope untouched, both content and git status.
    expect(await fs.readFile(path.join(repo, "other", "c.txt"), "utf8")).toBe("c-dirty\n");
    expect(await fs.readFile(path.join(repo, "other", "untracked.txt"), "utf8")).toBe("keep-me\n");
    const outOfScopeAfter = (await git(["status", "--porcelain=v1"], repo))
      .split(/\r?\n/)
      .filter((line) => line.includes("other/"))
      .sort();
    expect(outOfScopeAfter).toEqual(outOfScopeBefore);
  });

  it("uses the checkpoint's recorded scope when no paths are requested", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-dirty\n", "utf8");
    await fs.writeFile(path.join(repo, "other", "untracked.txt"), "keep-me\n", "utf8");

    // A scoped checkpoint restored with no options must NOT widen into a
    // whole-tree restore, which would delete everything outside its tree.
    const restored = await service.restoreCheckpoint(created.checkpoint!.id);
    expect(restored.status).toBe("restored");
    expect(restored.diagnostic?.scope).toEqual({ kind: "paths", paths: ["src"] });
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-base\n");
    expect(await fs.readFile(path.join(repo, "other", "c.txt"), "utf8")).toBe("c-base\n");
    expect(await fs.readFile(path.join(repo, "other", "untracked.txt"), "utf8")).toBe("keep-me\n");
  });

  it("keeps the real index consistent for in-scope paths only", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-dirty\n", "utf8");
    await git(["add", "src/a.txt"], repo);
    await fs.writeFile(path.join(repo, "other", "c.txt"), "c-dirty\n", "utf8");
    await git(["add", "other/c.txt"], repo);

    const restored = await service.restoreCheckpoint(created.checkpoint!.id, { paths: ["src"] });
    expect(restored.status).toBe("restored");

    // src is back to the checkpoint in both worktree and index; other keeps its
    // staged change.
    const status = await git(["status", "--porcelain=v1"], repo);
    expect(status).not.toContain("src/a.txt");
    expect(status).toContain("other/c.txt");
  });

  it("restores a narrower scope than the checkpoint tree", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-dirty\n", "utf8");
    await fs.writeFile(path.join(repo, "src", "b.txt"), "b-dirty\n", "utf8");

    const restored = await service.restoreCheckpoint(created.checkpoint!.id, {
      paths: ["src/a.txt"],
    });
    expect(restored.status).toBe("restored");
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-base\n");
    expect(await fs.readFile(path.join(repo, "src", "b.txt"), "utf8")).toBe("b-dirty\n");
  });

  it("refuses a requested scope the checkpoint never covered instead of deleting it", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "other", "untracked.txt"), "keep-me\n", "utf8");

    // `other/` is absent from this checkpoint's tree. Restoring it would treat
    // every file there as "not in the checkpoint" and delete it.
    const result = await service.restoreCheckpoint(created.checkpoint!.id, { paths: ["other"] });
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("not covered by checkpoint");
    expect(result.reason).toContain("other");
    // Nothing was deleted.
    expect(await fs.readFile(path.join(repo, "other", "c.txt"), "utf8")).toBe("c-base\n");
    expect(await fs.readFile(path.join(repo, "other", "untracked.txt"), "utf8")).toBe("keep-me\n");
    expect(warnings.some((message) => message.includes("not covered by checkpoint"))).toBe(true);
  });

  it("allows any scope against a whole-tree checkpoint", async () => {
    const created = await service.createCheckpoint();
    await fs.writeFile(path.join(repo, "other", "c.txt"), "c-dirty\n", "utf8");
    const result = await service.restoreCheckpoint(created.checkpoint!.id, { paths: ["other"] });
    expect(result.status).toBe("restored");
    expect(await fs.readFile(path.join(repo, "other", "c.txt"), "utf8")).toBe("c-base\n");
  });
});

describe("git layout policy", () => {
  it("supports a main-repository linked worktree via --git-common-dir", async () => {
    await git(["branch", "-q", "wt-branch"], repo);
    const worktree = path.join(root, "linked-wt");
    await git(["worktree", "add", "-q", worktree, "wt-branch"], repo);
    // A linked worktree's .git is a file, which P5 rejected outright.
    expect((await fs.stat(path.join(worktree, ".git"))).isFile()).toBe(true);

    const worktreeService = new GitCheckpointService({
      workspaceRoot: worktree,
      enabled: true,
      pathScopedEnabled: true,
      stateDir: state,
      warn: (message) => warnings.push(message),
    });
    const created = await worktreeService.createCheckpoint();
    expect(created.status).toBe("created");
    expect(created.indexWorktreeUnchanged).toBe(true);

    await fs.writeFile(path.join(worktree, "src", "a.txt"), "wt-dirty\n", "utf8");
    const restored = await worktreeService.restoreCheckpoint(created.checkpoint!.id);
    expect(restored.status).toBe("restored");
    expect(await fs.readFile(path.join(worktree, "src", "a.txt"), "utf8")).toBe("a-base\n");
  });

  it("returns explicit unsupported plus a warning for a submodule-style .git link", async () => {
    const separateGitDir = path.join(root, "parent", ".git", "modules", "sub");
    const submoduleWorktree = path.join(root, "parent", "sub");
    await fs.mkdir(path.dirname(separateGitDir), { recursive: true });
    await fs.mkdir(submoduleWorktree, { recursive: true });
    await git(["init", "-q", `--separate-git-dir=${separateGitDir}`, submoduleWorktree], root);
    expect((await fs.stat(path.join(submoduleWorktree, ".git"))).isFile()).toBe(true);

    const submoduleService = new GitCheckpointService({
      workspaceRoot: submoduleWorktree,
      enabled: true,
      pathScopedEnabled: true,
      stateDir: state,
      warn: (message) => warnings.push(message),
    });
    await expect(submoduleService.createCheckpoint()).resolves.toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("submodule"),
    });
    await expect(submoduleService.restoreCheckpoint("abc")).resolves.toMatchObject({
      status: "unsupported",
    });
    expect(warnings.some((message) => message.includes("submodule"))).toBe(true);
  });

  it("explicitly skips an out-of-scope nested repo but refuses one inside scope", async () => {
    const nested = path.join(repo, "other", "nested-repo");
    await initRepo(nested);

    // Out of scope: allowed, reported as skipped, and warned about.
    const created = await service.createCheckpoint({ paths: ["src"] });
    expect(created.status).toBe("created");
    expect(created.skippedNestedRepos?.some((item) => item.includes("nested-repo"))).toBe(true);
    expect(warnings.some((message) => message.includes("explicitly skips"))).toBe(true);

    // Inside scope: explicitly unsupported, never half-supported.
    await expect(service.createCheckpoint({ paths: ["other"] })).resolves.toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("nested .git"),
    });
    // No explicit scope means the P5 whole-tree rule applies.
    await expect(service.createCheckpoint()).resolves.toMatchObject({ status: "unsupported" });
  });
});

describe("scope helpers", () => {
  it("normalizes, dedupes, sorts, and collapses nested scope entries", () => {
    const scope = normalizeCheckpointScope(repo, [
      "src/b.txt",
      "src",
      "src/a.txt",
      path.join(repo, "other"),
      "other/",
    ]);
    expect(scope).toEqual({ kind: "paths", paths: ["other", "src"] });
  });

  it("encodes and decodes metadata trailers losslessly", () => {
    const message = encodeCheckpointMessage({
      createdAt: "2026-08-18T00:00:00.000Z",
      scope: { kind: "paths", paths: ["src/a.txt", "src/b.txt"] },
      label: "my label",
    });
    expect(decodeCheckpointMetadata(message)).toEqual({
      version: 2,
      scope: { kind: "paths", paths: ["src/a.txt", "src/b.txt"] },
      label: "my label",
      // Millisecond stamp from the subject line: git's creatordate is only
      // second-resolution, so this is what makes "newest" well-defined.
      createdAtMs: Date.parse("2026-08-18T00:00:00.000Z"),
    });
    // A P5 message with no trailers decodes to full scope. Its subject carries
    // the same millisecond stamp, so P5 checkpoints order precisely too.
    expect(decodeCheckpointMetadata("OpenClaw UFTK git checkpoint 2026-08-17T00:00:00.000Z\n")).toEqual({
      version: 1,
      scope: { kind: "full", paths: [] },
      createdAtMs: Date.parse("2026-08-17T00:00:00.000Z"),
    });
    // A message with no parseable stamp leaves ordering to git's creatordate.
    expect(decodeCheckpointMetadata("no stamp here\n")).toEqual({
      version: 1,
      scope: { kind: "full", paths: [] },
    });
  });
});

describe("forbidden git operations", () => {
  const CHECKPOINT_MODULES = [
    "git-checkpoint.ts",
    "git-checkpoint-safety.ts",
    "git-checkpoint-transaction.ts",
    "git-checkpoint-lifecycle.ts",
    // P7 modules are held to the same rule: a new checkpoint-adjacent module must
    // not become the one place a forbidden primitive slips back in.
    "git-checkpoint-recovery-advice.ts",
    "exec-side-effect-undo.ts",
    "checkpoint-worktree-bridge.ts",
    "auto-checkpoint.ts",
  ];

  /** Strip comments so the guards assert on real code, not prose about the rule. */
  function codeOnly(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  async function readModuleCode(file: string): Promise<string> {
    return codeOnly(await fs.readFile(path.join(import.meta.dirname, file), "utf8"));
  }

  it("never uses git reset --hard or git clean -f in the checkpoint implementation", async () => {
    for (const file of CHECKPOINT_MODULES) {
      const code = await readModuleCode(file);
      expect(code.match(/"reset"/g) ?? [], `${file} must not invoke git reset`).toEqual([]);
      expect(code.match(/"clean"/g) ?? [], `${file} must not invoke git clean`).toEqual([]);
      expect(code, `${file} must not pass --hard`).not.toContain("--hard");
      expect(code, `${file} must not force-clean`).not.toContain("clean -f");
    }
  });

  it("does not import write-journal or FTS rollback from the checkpoint modules", async () => {
    for (const file of CHECKPOINT_MODULES) {
      const code = await readModuleCode(file);
      const imports = code.match(/from\s+"[^"]+"/g) ?? [];
      for (const specifier of imports) {
        expect(specifier, `${file} must stay separate from the journal path`).not.toContain(
          "write-journal",
        );
        expect(specifier, `${file} must not depend on FTS rollback`).not.toContain(
          "file-transaction-service",
        );
      }
    }
  });
});
