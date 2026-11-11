import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codingObservability } from "../context-engine/coding-observability.js";
import { resolveWorktreeBackend } from "../context-engine/coding-runtime-flags.js";
import {
  __resetWorktreeRegistry,
  createWorktreeService,
  listWorktreeDirs,
  PRODUCTION_GIT_WORKTREE_HARDENED,
  normalizeWorktreeRelPath,
  writeWorktreeFile,
} from "./worktree-service.js";
import { buildChildHandoffPack } from "../context-engine/handlers/task-loop-handler.js";
import { parseHandoffPack } from "../context-engine/block-store.js";
import { createOrchestratorPlan } from "./orchestrator.js";
import { normalizeIsolationMode } from "./orchestration-protocol.js";
import { BUILT_IN_ROLE_CONTRACTS } from "./role-contract.js";

function initGitRepo(root: string): void {
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "test"], { cwd: root, stdio: "ignore" });
  writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" });
}

describe("worktree-service (C4 interface)", () => {
  let root: string;
  beforeEach(() => {
    __resetWorktreeRegistry();
    codingObservability.reset();
    root = mkdtempSync(path.join(tmpdir(), "wt-"));
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  });
  afterEach(() => {
    __resetWorktreeRegistry();
    codingObservability.reset();
    rmSync(root, { recursive: true, force: true });
  });

  it("create seeds files and cleanup removes tree (inprocess default)", () => {
    const svc = createWorktreeService(root);
    expect(svc.backend).toBe("inprocess");
    const rec = svc.create("w1", { seedFiles: ["src/a.ts"], writeSet: ["src/a.ts"] });
    expect(rec.backend).toBe("inprocess");
    expect(rec.root.replace(/\\/g, "/")).toContain(".openclaw/worktrees/w1");
    expect(readFileSync(path.join(rec.root, "src", "a.ts"), "utf8")).toContain("a = 1");
    svc.cleanup("w1");
    expect(svc.list().find((r) => r.id === "w1")?.status).toBe("cleaned");
    expect(listWorktreeDirs(root).includes("w1")).toBe(false);
  });

  it.each([".", "..", "", "CON", "NUL.txt", "COM1", "trail.", " lead"])("rejects reserved worktree id %j before touching control files", (id) => {
    mkdirSync(path.join(root, ".openclaw"));
    const marker = path.join(root, ".openclaw", "state.txt");
    writeFileSync(marker, "must-survive");
    expect(() => createWorktreeService(root).create(id)).toThrow(/worktree.*id/i);
    expect(readFileSync(marker, "utf8")).toBe("must-survive");
  });

  it("does not delete an existing directory on repeated or unowned create", () => {
    const svc = createWorktreeService(root);
    const first = svc.create("owned");
    const marker = path.join(first.root, "uncommitted.txt");
    writeFileSync(marker, "preserve");
    expect(() => svc.create("owned")).toThrow(/exists|conflict/);
    __resetWorktreeRegistry();
    expect(() => createWorktreeService(root).create("owned")).toThrow(/exists|conflict/);
    expect(readFileSync(marker, "utf8")).toBe("preserve");
  });

  it("keeps normalization and truncated-prefix ids distinct", () => {
    const svc = createWorktreeService(root);
    const ids = ["scope:a", "scope?a", "x".repeat(70) + "a", "x".repeat(70) + "b"];
    const records = ids.map((id) => svc.create(id));
    expect(new Set(records.map((r) => r.root)).size).toBe(4);
    expect(ids.map((id) => svc.pathFor(id))).toEqual(records.map((r) => r.root));
    expect(records.every((r) => existsSync(r.root))).toBe(true);
  });

  it("refuses a replaced managed root or cleanup target", () => {
    const external = mkdtempSync(path.join(tmpdir(), "worktree-external-"));
    try {
      const marker = path.join(external, "keep.txt");
      writeFileSync(marker, "external");
      const svc = createWorktreeService(root);
      const rec = svc.create("worker");
      renameSync(rec.root, rec.root + "-original");
      symlinkSync(external, rec.root, process.platform === "win32" ? "junction" : "dir");
      expect(() => svc.cleanup(rec.id)).toThrow();
      expect(readFileSync(marker, "utf8")).toBe("external");
      rmSync(path.join(root, ".openclaw/worktrees"), { recursive: true, force: true });
      symlinkSync(external, path.join(root, ".openclaw/worktrees"), process.platform === "win32" ? "junction" : "dir");
      expect(() => svc.create("other")).toThrow();
      expect(existsSync(path.join(external, "other"))).toBe(false);
      expect(readFileSync(marker, "utf8")).toBe("external");
    } finally { rmSync(external, { recursive: true, force: true }); }
  });

  it("does not steal a live aged lock or execute after lock timeout", () => {
    const dir = path.join(root, ".openclaw/worktrees");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, ".merge.lock");
    const contents = `${process.pid}\n${Date.now() - 60000}\n`;
    writeFileSync(file, contents);
    expect(() => createWorktreeService(root).create("locked")).toThrow("worktree_legacy_lock_unavailable");
    expect(existsSync(path.join(dir, "locked"))).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(contents);
  }, 15000);

  it("preserves untracked content in an inprocess worktree and a replacement directory", () => {
    const svc = createWorktreeService(root);
    const rec = svc.create("extra");
    writeFileSync(path.join(rec.root, "user.txt"), "keep");
    expect(() => svc.cleanup(rec.id)).toThrow(/user_content/);
    renameSync(rec.root, rec.root + "-old");
    mkdirSync(rec.root);
    expect(() => svc.cleanup(rec.id)).toThrow(/worktree_replaced/);
    expect(readFileSync(path.join(rec.root + "-old", "user.txt"), "utf8")).toBe("keep");
  });

  it("preserves a worker commit that has not been integrated", () => {
    initGitRepo(root);
    const svc = createWorktreeService(root, { backend: "git" });
    const rec = svc.create("committed", { writeSet: ["src/a.ts"] });
    writeFileSync(path.join(rec.root, "src/a.ts"), "worker change");
    execFileSync("git", ["add", "src/a.ts"], { cwd: rec.root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "worker"], { cwd: rec.root, stdio: "ignore" });
    expect(() => svc.cleanup(rec.id)).toThrow(/unreferenced_commit/);
    expect(readFileSync(path.join(rec.root, "src/a.ts"), "utf8")).toBe("worker change");
  });

  it("merge queue serializes and detects overlapping conflicts (2-worker same file)", async () => {
    const svc = createWorktreeService(root);
    const w1 = svc.create("w1", { seedFiles: ["src/a.ts"] });
    const w2 = svc.create("w2", { seedFiles: ["src/a.ts"] });
    writeFileSync(path.join(w1.root, "src", "a.ts"), "export const a = 2;\n");
    writeFileSync(path.join(w2.root, "src", "a.ts"), "export const a = 3;\n");
    // both workers complete in isolation
    expect(existsSync(path.join(w1.root, "src", "a.ts"))).toBe(true);
    expect(existsSync(path.join(w2.root, "src", "a.ts"))).toBe(true);
    svc.enqueueMerge({ worktreeId: "w1", changedFiles: ["src/a.ts"] });
    svc.enqueueMerge({ worktreeId: "w2", changedFiles: ["src/a.ts"] });
    const results = await svc.processMergeQueue();
    expect(results[0]?.status).toBe("merged");
    expect(results[1]?.status).toBe("conflict");
    expect(readFileSync(path.join(root, "src", "a.ts"), "utf8")).toContain("a = 2");
    expect(codingObservability.rates().mergeReworkRate).toBeGreaterThan(0);
  });

  it("conflict policy can return work to worker", async () => {
    const svc = createWorktreeService(root, { conflictPolicy: "return_worker" });
    const w1 = svc.create("w1", { seedFiles: ["src/a.ts"] });
    const w2 = svc.create("w2", { seedFiles: ["src/a.ts"] });
    writeFileSync(path.join(w1.root, "src", "a.ts"), "export const a = 2;\n");
    writeFileSync(path.join(w2.root, "src", "a.ts"), "export const a = 3;\n");
    svc.enqueueMerge({ worktreeId: "w1", changedFiles: ["src/a.ts"] });
    svc.enqueueMerge({ worktreeId: "w2", changedFiles: ["src/a.ts"] });
    const results = await svc.processMergeQueue();
    expect(results[0]?.status).toBe("merged");
    expect(results[1]?.status).toBe("rework");
    expect(results[1]?.reason).toMatch(/^return_worker:/);
  });

  it("merge missing worktree fails cleanly", async () => {
    const svc = createWorktreeService(root);
    svc.enqueueMerge({ worktreeId: "ghost", changedFiles: ["src/a.ts"] });
    const results = await svc.processMergeQueue();
    expect(results[0]?.status).toBe("conflict");
    expect(results[0]?.reason).toBe("missing_worktree");
  });

  it("git backend creates isolated worktree when available (opt-in, not production default)", async () => {
    initGitRepo(root);
    const svc = createWorktreeService(root, { backend: "git" });
    expect(svc.backend).toBe("git");
    const rec = svc.create("g1", { seedFiles: ["src/a.ts"], writeSet: ["src/a.ts"] });
    expect(rec.backend).toBe("git");
    expect(existsSync(rec.root)).toBe(true);
    writeFileSync(path.join(rec.root, "src", "a.ts"), "export const a = 9;\n");
    svc.enqueueMerge({ worktreeId: "g1", changedFiles: ["src/a.ts"] });
    const results = await svc.processMergeQueue();
    expect(results[0]?.status).toBe("merged");
    expect(readFileSync(path.join(root, "src", "a.ts"), "utf8")).toContain("a = 9");
    svc.cleanup("g1");
    expect(svc.list().find((r) => r.id === "g1")?.status).toBe("cleaned");
    expect(listWorktreeDirs(root).includes("g1")).toBe(false);
  });

  it("git backend falls back to inprocess when not a git repo", () => {
    const svc = createWorktreeService(root, { backend: "git" });
    expect(svc.backend).toBe("inprocess");
  });

  it("does not create a directory simulation when Git checkout creation fails", () => {
    initGitRepo(root);
    writeFileSync(path.join(root, ".git", "worktrees"), "block registry creation");
    const svc = createWorktreeService(root, { backend: "git" });
    expect(svc.backend).toBe("git");
    expect(() => svc.create("failed-checkout")).toThrow();
    expect(svc.inventory()).toMatchObject([{ availability: "incomplete", record: {
      backend: "git", status: "creating", registration: { phase: "allocated" },
    } }]);
    expect(existsSync(path.join(root, ".openclaw", "worktrees", "failed-checkout", ".git"))).toBe(false);
  });

  it("resolveWorktreeBackend defaults to inprocess", () => {
    expect(resolveWorktreeBackend()).toBe("inprocess");
    expect(resolveWorktreeBackend(undefined, { backend: "git" })).toBe("git");
  });
});

describe("C4 isolation request + HandoffPack coordinates", () => {
  it("normalizeIsolationMode defaults to shared", () => {
    expect(normalizeIsolationMode(undefined)).toBe("shared");
    expect(() => normalizeIsolationMode(null)).toThrow(/unsupported isolation/);
    expect(normalizeIsolationMode("shared")).toBe("shared");
    expect(normalizeIsolationMode("worktree")).toBe("worktree");
    expect(() => normalizeIsolationMode("patch-flow")).toThrow(/unsupported isolation/);
  });

  it("orchestrator plan isolation defaults shared and accepts worktree", () => {
    const shared = createOrchestratorPlan({
      task: "implement feature",
      roles: BUILT_IN_ROLE_CONTRACTS,
      workers: [{ roleName: "implementer", task: "edit", writeSet: ["src/a.ts"] }],
    });
    expect(shared.isolation).toBe("shared");

    const wt = createOrchestratorPlan({
      task: "heavy concurrent edit",
      isolation: "worktree",
      roles: BUILT_IN_ROLE_CONTRACTS,
      workers: [
        { roleName: "implementer", task: "edit a", writeSet: ["src/a.ts"], worktreeId: "wt-a" },
        { roleName: "implementer", task: "edit b", writeSet: ["src/b.ts"], worktreeId: "wt-b" },
      ],
    });
    expect(wt.isolation).toBe("worktree");
    const nodes = wt.taskGraph.nodes.filter((n) => n.roleName === "implementer");
    expect(nodes.some((n) => n.worktreeId === "wt-a")).toBe(true);
  });

  it("HandoffPack carries writeSet/worktreeId/isolation and parse round-trips", () => {
    const pack = buildChildHandoffPack({
      objective: "edit files",
      currentPhase: "running",
      recentActions: [{ tool: "read", result_summary: "ok", significance: "high" }],
      parentSessionId: "agent:parent:main",
      writeSet: ["src/a.ts"],
      worktreeId: "w1",
      isolation: "worktree",
    });
    expect(pack.isolation).toBe("worktree");
    expect(pack.writeSet).toEqual(["src/a.ts"]);
    expect(pack.worktreeId).toBe("w1");
    const parsed = parseHandoffPack(JSON.stringify(pack));
    expect(parsed?.isolation).toBe("worktree");
    expect(parsed?.writeSet).toEqual(["src/a.ts"]);
    expect(parsed?.worktreeId).toBe("w1");
  });

  it("empty writeSet handoff remains compatible (omit field)", () => {
    const pack = buildChildHandoffPack({
      objective: "review only",
      currentPhase: "running",
      recentActions: [],
      parentSessionId: "agent:parent:main",
    });
    expect(pack.writeSet).toBeUndefined();
    expect(pack.isolation).toBeUndefined();
    const parsed = parseHandoffPack(JSON.stringify(pack));
    expect(parsed).toBeDefined();
    expect(parsed?.writeSet).toBeUndefined();
    expect(normalizeIsolationMode(parsed?.isolation)).toBe("shared");
  });
});

describe("worktree-service C4-H hardening", () => {
  let root: string;
  beforeEach(() => {
    __resetWorktreeRegistry();
    codingObservability.reset();
    root = mkdtempSync(path.join(tmpdir(), "wt-h-"));
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  });
  afterEach(() => {
    __resetWorktreeRegistry();
    codingObservability.reset();
    rmSync(root, { recursive: true, force: true });
  });

  it("exports PRODUCTION_GIT_WORKTREE_HARDENED without flipping defaults", () => {
    expect(PRODUCTION_GIT_WORKTREE_HARDENED).toBe(true);
    expect(resolveWorktreeBackend()).toBe("inprocess");
    expect(normalizeIsolationMode(undefined)).toBe("shared");
  });

  it("normalizes Windows separators and rejects traversal", () => {
    expect(normalizeWorktreeRelPath("src\\a.ts")).toBe("src/a.ts");
    expect(() => normalizeWorktreeRelPath("../secret")).toThrow(/unsafe_worktree_rel_path/);
  });

  it("writeWorktreeFile accepts backslash rel paths", () => {
    const svc = createWorktreeService(root);
    const rec = svc.create("w1", { seedFiles: ["src/a.ts"] });
    writeWorktreeFile(rec.root, "src\\nested\\b.ts", "export const b = 1;\n");
    expect(readFileSync(path.join(rec.root, "src", "nested", "b.ts"), "utf8")).toContain("b = 1");
  });

  it("git backend concurrent create/merge/cleanup stays isolated (C4-H)", async () => {
    initGitRepo(root);
    const svc = createWorktreeService(root, { backend: "git" });
    expect(svc.backend).toBe("git");
    const w1 = svc.create("g-a", { seedFiles: ["src/a.ts"], writeSet: ["src/a.ts"] });
    const w2 = svc.create("g-b", { seedFiles: ["src/a.ts"], writeSet: ["src/a.ts"] });
    expect(w1.backend).toBe("git");
    expect(w2.backend).toBe("git");
    writeFileSync(path.join(w1.root, "src", "a.ts"), "export const a = 2;\n");
    writeFileSync(path.join(w2.root, "src", "a.ts"), "export const a = 3;\n");
    svc.enqueueMerge({ worktreeId: "g-a", changedFiles: ["src\\a.ts"] });
    svc.enqueueMerge({ worktreeId: "g-b", changedFiles: ["src/a.ts"] });
    const results = await svc.processMergeQueue();
    expect(results[0]?.status).toBe("merged");
    expect(results[1]?.status).toBe("conflict");
    svc.cleanup("g-a");
    svc.cleanup("g-b");
    expect(listWorktreeDirs(root).includes("g-a")).toBe(false);
    expect(listWorktreeDirs(root).includes("g-b")).toBe(false);
  });

  it("hardened git env disables repository hooks (C4-H parity with Codex info.rs)", () => {
    // Same env set injected by worktree-service git()/isGitRepo (and
    // electron git-api execBinary): GIT_OPTIONAL_LOCKS=0,
    // GIT_TERMINAL_PROMPT=0, core.hooksPath=NUL|/dev/null. A repository
    // post-commit hook must NOT run under this env, while the control run
    // (plain env) proves the hook itself fires.
    initGitRepo(root);
    mkdirSync(path.join(root, ".git", "hooks"), { recursive: true });
    const marker = path.join(root, "hook-marker");
    const hookPath = path.join(root, ".git", "hooks", "post-commit");
    writeFileSync(
      hookPath,
      `#!/bin/sh\necho HOOK_TRIGGERED >> "${marker.replace(/\\/g, "/")}"\n`,
    );
    try {
      execFileSync("chmod", ["+x", hookPath], { stdio: "ignore" });
    } catch {
      // Windows: executable bit is not meaningful; git for windows still
      // executes hooks via sh when core.hooksPath is active.
    }

    // Control: plain env → hook fires.
    writeFileSync(path.join(root, "f.txt"), "v1\n", "utf8");
    execFileSync("git", ["add", "f.txt"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "control"], { cwd: root, stdio: "ignore" });
    expect(existsSync(marker)).toBe(true);
    rmSync(marker, { force: true });

    // Hardened env (same as production wrapper) → hook must not fire.
    const hardenedEnv = {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: process.platform === "win32" ? "NUL" : "/dev/null",
    };
    writeFileSync(path.join(root, "f.txt"), "v2\n", "utf8");
    execFileSync("git", ["add", "f.txt"], { cwd: root, stdio: "ignore", env: hardenedEnv });
    execFileSync("git", ["commit", "-m", "hardened"], { cwd: root, stdio: "ignore", env: hardenedEnv });
    expect(existsSync(marker)).toBe(false);
  });
});
