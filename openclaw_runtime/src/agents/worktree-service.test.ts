import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codingObservability } from "../context-engine/coding-observability.js";
import { resolveWorktreeBackend } from "../context-engine/coding-runtime-flags.js";
import {
  __resetWorktreeRegistry,
  createWorktreeService,
  listWorktreeDirs,
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

  it("merge queue serializes and detects overlapping conflicts (2-worker same file)", () => {
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
    const results = svc.processMergeQueue();
    expect(results[0]?.status).toBe("merged");
    expect(results[1]?.status).toBe("conflict");
    expect(readFileSync(path.join(root, "src", "a.ts"), "utf8")).toContain("a = 2");
    expect(codingObservability.rates().mergeReworkRate).toBeGreaterThan(0);
  });

  it("conflict policy can return work to worker", () => {
    const svc = createWorktreeService(root, { conflictPolicy: "return_worker" });
    const w1 = svc.create("w1", { seedFiles: ["src/a.ts"] });
    const w2 = svc.create("w2", { seedFiles: ["src/a.ts"] });
    writeFileSync(path.join(w1.root, "src", "a.ts"), "export const a = 2;\n");
    writeFileSync(path.join(w2.root, "src", "a.ts"), "export const a = 3;\n");
    svc.enqueueMerge({ worktreeId: "w1", changedFiles: ["src/a.ts"] });
    svc.enqueueMerge({ worktreeId: "w2", changedFiles: ["src/a.ts"] });
    const results = svc.processMergeQueue();
    expect(results[0]?.status).toBe("merged");
    expect(results[1]?.status).toBe("rework");
    expect(results[1]?.reason).toMatch(/^return_worker:/);
  });

  it("merge missing worktree fails cleanly", () => {
    const svc = createWorktreeService(root);
    svc.enqueueMerge({ worktreeId: "ghost", changedFiles: ["src/a.ts"] });
    const results = svc.processMergeQueue();
    expect(results[0]?.status).toBe("conflict");
    expect(results[0]?.reason).toBe("missing_worktree");
  });

  it("git backend creates isolated worktree when available (opt-in, not production default)", () => {
    initGitRepo(root);
    const svc = createWorktreeService(root, { backend: "git" });
    expect(svc.backend).toBe("git");
    const rec = svc.create("g1", { seedFiles: ["src/a.ts"], writeSet: ["src/a.ts"] });
    expect(rec.backend).toBe("git");
    expect(existsSync(rec.root)).toBe(true);
    writeFileSync(path.join(rec.root, "src", "a.ts"), "export const a = 9;\n");
    svc.enqueueMerge({ worktreeId: "g1", changedFiles: ["src/a.ts"] });
    const results = svc.processMergeQueue();
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

  it("resolveWorktreeBackend defaults to inprocess", () => {
    expect(resolveWorktreeBackend()).toBe("inprocess");
    expect(resolveWorktreeBackend(undefined, { backend: "git" })).toBe("git");
  });
});

describe("C4 isolation request + HandoffPack coordinates", () => {
  it("normalizeIsolationMode defaults to shared", () => {
    expect(normalizeIsolationMode(undefined)).toBe("shared");
    expect(normalizeIsolationMode(null)).toBe("shared");
    expect(normalizeIsolationMode("shared")).toBe("shared");
    expect(normalizeIsolationMode("worktree")).toBe("worktree");
    expect(normalizeIsolationMode("patch-flow")).toBe("shared");
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