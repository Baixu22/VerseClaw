import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  PRODUCTION_PNPM_HARDLINK_INSTALL,
  installWorktreeDependencies,
  seedFakeNodeModules,
} from "./worktree-pnpm-install.js";
import { __resetWorktreeRegistry, createWorktreeService } from "./worktree-service.js";

describe("worktree-pnpm-install (C4-P)", () => {
  let root: string;
  afterEach(() => {
    __resetWorktreeRegistry();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("capability flag is true and none strategy is default no-op", () => {
    expect(PRODUCTION_PNPM_HARDLINK_INSTALL).toBe(true);
    root = mkdtempSync(path.join(tmpdir(), "c4p-none-"));
    const r = installWorktreeDependencies({
      worktreeRoot: path.join(root, "wt"),
      baseRoot: root,
      strategy: "none",
    });
    expect(r.ok).toBe(true);
    expect(r.pnpmRan).toBe(false);
    expect(r.hardlinksCreated).toBe(0);
  });

  it("hardlink-modules reuses base node_modules files", () => {
    root = mkdtempSync(path.join(tmpdir(), "c4p-hl-"));
    seedFakeNodeModules(root, {
      "pkg/package.json": '{"name":"pkg"}',
      "pkg/index.js": "export default 1;\n",
    });
    const wt = path.join(root, "wt");
    const r = installWorktreeDependencies({
      worktreeRoot: wt,
      baseRoot: root,
      strategy: "hardlink-modules",
    });
    expect(r.ok).toBe(true);
    expect(r.hardlinksCreated + r.filesCopied).toBeGreaterThanOrEqual(2);
    expect(readFileSync(path.join(wt, "node_modules", "pkg", "index.js"), "utf8")).toContain("export");
    // On same volume hardlink should share inode when hardlinksCreated > 0
    if (r.hardlinksCreated > 0) {
      const a = statSync(path.join(root, "node_modules", "pkg", "index.js"));
      const b = statSync(path.join(wt, "node_modules", "pkg", "index.js"));
      expect(a.ino).toBe(b.ino);
    }
  });

  it("pnpm-install uses injected runner and does not default on create", () => {
    root = mkdtempSync(path.join(tmpdir(), "c4p-pnpm-"));
    const calls: string[][] = [];
    const r = installWorktreeDependencies({
      worktreeRoot: path.join(root, "wt"),
      baseRoot: root,
      strategy: "pnpm-install",
      execPnpm: (args, cwd) => {
        calls.push([...args, cwd]);
      },
    });
    expect(r.ok).toBe(true);
    expect(r.pnpmRan).toBe(true);
    expect(calls[0]?.[0]).toBe("install");
    expect(calls[0]?.includes("--prefer-offline")).toBe(true);

    const svc = createWorktreeService(root);
    const rec = svc.create("w-no-install", { seedFiles: [] });
    expect((rec as { install?: unknown }).install).toBeUndefined();
    expect(existsSync(path.join(rec.root, "node_modules"))).toBe(false);
  });

  it("create with installStrategy=hardlink-modules returns install result", () => {
    root = mkdtempSync(path.join(tmpdir(), "c4p-create-"));
    seedFakeNodeModules(root, { "x/a.js": "1" });
    const svc = createWorktreeService(root);
    const rec = svc.create("w-hl", { installStrategy: "hardlink-modules" });
    expect(rec.install?.ok).toBe(true);
    expect(rec.install?.strategy).toBe("hardlink-modules");
    expect(existsSync(path.join(rec.root, "node_modules", "x", "a.js"))).toBe(true);
  });
});