/**
 * Branch coverage for the root memory file locator (TF-0118 AC-2).
 *
 * This module decides which on-disk file seeds agent context and which paths a
 * workspace memory scan must skip. Both decisions are silent when wrong: a
 * case-folded match would let `memory.md` masquerade as the canonical
 * `MEMORY.md`, and a drifted repair-directory constant would stop skipping the
 * repair tree so migration scratch files would be scanned back in as memory.
 * These tests pin the exact-match contract, the symlink refusal, and the
 * agreement between the two places the repair directory is spelled out.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Unprivileged Windows cannot create symlinks (EPERM). Probe once so the
 * symlink case reports as skipped rather than silently returning early — a test
 * that no-ops looks like coverage without being coverage.
 */
const CAN_SYMLINK = (() => {
  const probe = mkdtempSync(path.join(tmpdir(), "symlink-probe-"));
  try {
    writeFileSync(path.join(probe, "target"), "x");
    symlinkSync(path.join(probe, "target"), path.join(probe, "link"), "file");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();
import {
  CANONICAL_ROOT_MEMORY_FILENAME,
  exactWorkspaceEntryExists,
  LEGACY_ROOT_MEMORY_FILENAME,
  resolveCanonicalRootMemoryFile,
  resolveCanonicalRootMemoryPath,
  resolveLegacyRootMemoryPath,
  resolveRootMemoryRepairDir,
  shouldSkipRootMemoryAuxiliaryPath,
} from "./root-memory-files.js";

describe("root memory files", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), "root-memory-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  describe("path resolvers", () => {
    it("joins the canonical and legacy names onto the workspace", () => {
      expect(resolveCanonicalRootMemoryPath(workspace)).toBe(
        path.join(workspace, "MEMORY.md"),
      );
      expect(resolveLegacyRootMemoryPath(workspace)).toBe(
        path.join(workspace, "memory.md"),
      );
    });

    it("keeps the repair directory constant and the resolver in agreement", () => {
      // resolveRootMemoryRepairDir spells the segments out separately while
      // shouldSkipRootMemoryAuxiliaryPath compares against a single joined
      // string constant. If those two ever drift, the repair tree silently
      // stops being skipped, so pin them against each other here.
      const resolved = resolveRootMemoryRepairDir(workspace);
      expect(resolved).toBe(path.join(workspace, ".openclaw-repair", "root-memory"));
      expect(
        shouldSkipRootMemoryAuxiliaryPath({ workspaceDir: workspace, absPath: resolved }),
      ).toBe(true);
    });
  });

  describe("exactWorkspaceEntryExists", () => {
    it("finds an entry by exact name", async () => {
      writeFileSync(path.join(workspace, CANONICAL_ROOT_MEMORY_FILENAME), "# hi");
      await expect(
        exactWorkspaceEntryExists(workspace, CANONICAL_ROOT_MEMORY_FILENAME),
      ).resolves.toBe(true);
    });

    it("does not case-fold: a lowercase file is not the canonical entry", async () => {
      // The whole point of reading the directory listing instead of calling
      // stat() is that Windows and macOS would resolve either spelling.
      writeFileSync(path.join(workspace, LEGACY_ROOT_MEMORY_FILENAME), "# legacy");
      await expect(
        exactWorkspaceEntryExists(workspace, CANONICAL_ROOT_MEMORY_FILENAME),
      ).resolves.toBe(false);
      await expect(
        exactWorkspaceEntryExists(workspace, LEGACY_ROOT_MEMORY_FILENAME),
      ).resolves.toBe(true);
    });

    it("returns false instead of throwing when the directory is missing", async () => {
      await expect(
        exactWorkspaceEntryExists(path.join(workspace, "nope"), "MEMORY.md"),
      ).resolves.toBe(false);
    });
  });

  describe("resolveCanonicalRootMemoryFile", () => {
    it("returns the path for a real regular file", async () => {
      const file = path.join(workspace, CANONICAL_ROOT_MEMORY_FILENAME);
      writeFileSync(file, "# memory");
      await expect(resolveCanonicalRootMemoryFile(workspace)).resolves.toBe(file);
    });

    it("returns null when nothing matches", async () => {
      await expect(resolveCanonicalRootMemoryFile(workspace)).resolves.toBeNull();
    });

    it("returns null when the canonical name is a directory", async () => {
      mkdirSync(path.join(workspace, CANONICAL_ROOT_MEMORY_FILENAME));
      await expect(resolveCanonicalRootMemoryFile(workspace)).resolves.toBeNull();
    });

    it("returns null when the workspace does not exist", async () => {
      await expect(
        resolveCanonicalRootMemoryFile(path.join(workspace, "missing")),
      ).resolves.toBeNull();
    });

    it.skipIf(!CAN_SYMLINK)("refuses a symlink pointing at a real file", async () => {
      const target = path.join(workspace, "actual.md");
      writeFileSync(target, "# target");
      symlinkSync(target, path.join(workspace, CANONICAL_ROOT_MEMORY_FILENAME), "file");
      await expect(resolveCanonicalRootMemoryFile(workspace)).resolves.toBeNull();
    });
  });

  describe("shouldSkipRootMemoryAuxiliaryPath", () => {
    it("skips the legacy root memory file", () => {
      expect(
        shouldSkipRootMemoryAuxiliaryPath({
          workspaceDir: workspace,
          absPath: resolveLegacyRootMemoryPath(workspace),
        }),
      ).toBe(true);
    });

    it("skips files nested under the repair directory", () => {
      expect(
        shouldSkipRootMemoryAuxiliaryPath({
          workspaceDir: workspace,
          absPath: path.join(workspace, ".openclaw-repair", "root-memory", "backup.md"),
        }),
      ).toBe(true);
    });

    it("does not skip the canonical file or ordinary memory files", () => {
      expect(
        shouldSkipRootMemoryAuxiliaryPath({
          workspaceDir: workspace,
          absPath: resolveCanonicalRootMemoryPath(workspace),
        }),
      ).toBe(false);
      expect(
        shouldSkipRootMemoryAuxiliaryPath({
          workspaceDir: workspace,
          absPath: path.join(workspace, "docs", "notes.md"),
        }),
      ).toBe(false);
    });

    it("does not skip paths outside the workspace", () => {
      expect(
        shouldSkipRootMemoryAuxiliaryPath({
          workspaceDir: path.join(workspace, "inner"),
          absPath: path.join(workspace, LEGACY_ROOT_MEMORY_FILENAME),
        }),
      ).toBe(false);
    });

    it("does not skip a sibling directory that merely shares the repair prefix", () => {
      expect(
        shouldSkipRootMemoryAuxiliaryPath({
          workspaceDir: workspace,
          absPath: path.join(workspace, ".openclaw-repair", "root-memory-old", "x.md"),
        }),
      ).toBe(false);
    });
  });
});
