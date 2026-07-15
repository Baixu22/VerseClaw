import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codingObservability } from "../context-engine/coding-observability.js";
import {
  __resetWorktreeRegistry,
  createWorktreeService,
  listWorktreeDirs,
} from "./worktree-service.js";

function initGitRepo(root: string): void {
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "test"], { cwd: root, stdio: "ignore" });
  writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" });
}

describe("worktree-service (C4 + C4-H)", () => {
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
    expect(readFileSync(path.join(rec.root, "src", "a.ts"), "utf8")).toContain("a = 1");
    svc.cleanup("w1");
    expect(svc.list().find((r) => r.id === "w1")?.status).toBe("cleaned");
    expect(listWorktreeDirs(root).includes("w1")).toBe(false);
  });

  it("merge queue detects overlapping conflicts", () => {
    const svc = createWorktreeService(root);
    const w1 = svc.create("w1", { seedFiles: ["src/a.ts"] });
    const w2 = svc.create("w2", { seedFiles: ["src/a.ts"] });
    writeFileSync(path.join(w1.root, "src", "a.ts"), "export const a = 2;\n");
    writeFileSync(path.join(w2.root, "src", "a.ts"), "export const a = 3;\n");
    svc.enqueueMerge({ worktreeId: "w1", changedFiles: ["src/a.ts"] });
    svc.enqueueMerge({ worktreeId: "w2", changedFiles: ["src/a.ts"] });
    const results = svc.processMergeQueue();
    expect(results[0]?.status).toBe("merged");
    expect(results[1]?.status).toBe("conflict");
    expect(codingObservability.rates().mergeReworkRate).toBeGreaterThan(0);
  });

  it("C4-H: git backend creates isolated worktree and cleans without orphans", () => {
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
    // no orphan tree directory
    expect(listWorktreeDirs(root).includes("g1")).toBe(false);
  });

  it("C4-H: multi-worker same-file conflict under git backend", () => {
    initGitRepo(root);
    const svc = createWorktreeService(root, { backend: "git" });
    const w1 = svc.create("gw1", { seedFiles: ["src/a.ts"] });
    const w2 = svc.create("gw2", { seedFiles: ["src/a.ts"] });
    writeFileSync(path.join(w1.root, "src", "a.ts"), "export const a = 2;\n");
    writeFileSync(path.join(w2.root, "src", "a.ts"), "export const a = 3;\n");
    svc.enqueueMerge({ worktreeId: "gw1", changedFiles: ["src/a.ts"] });
    svc.enqueueMerge({ worktreeId: "gw2", changedFiles: ["src/a.ts"] });
    const results = svc.processMergeQueue();
    expect(results[0]?.status).toBe("merged");
    expect(results[1]?.status).toBe("conflict");
    svc.cleanup("gw1");
    svc.cleanup("gw2");
    expect(listWorktreeDirs(root).filter((d) => d.startsWith("gw")).length).toBe(0);
  });

  it("C4-H: git backend falls back to inprocess when not a git repo", () => {
    const svc = createWorktreeService(root, { backend: "git" });
    expect(svc.backend).toBe("inprocess");
  });
});