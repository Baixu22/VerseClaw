// Managed-npm plugin-install rollback snapshots: capture package.json /
// package-lock.json / node_modules before a managed npm mutation and restore
// them if the install fails. Split out of install.ts; behavior unchanged.
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const rollbackSnapshotCopyMode = fsConstants.COPYFILE_FICLONE;

export type ManagedNpmInstallRollbackLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type ManagedNpmPluginInstallRollbackSnapshot = {
  packageJson?: string;
  packageLockJson?: string;
  nodeModulesBackupDir?: string;
  tempDir: string;
};

export async function removeEmptyDirectoryIfPresent(dir: string) {
  try {
    await fs.rmdir(dir);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      throw error;
    }
  }
}

export async function readRollbackFileIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function writeOrRemoveRollbackFile(filePath: string, contents: string | undefined) {
  if (contents === undefined) {
    await fs.rm(filePath, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
}

export async function createManagedNpmPluginInstallRollbackSnapshot(params: {
  npmRoot: string;
}): Promise<ManagedNpmPluginInstallRollbackSnapshot> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-npm-plugin-rollback-"));
  let nodeModulesBackupDir: string | undefined;
  const nodeModulesDir = path.join(params.npmRoot, "node_modules");
  try {
    await fs.stat(nodeModulesDir);
    nodeModulesBackupDir = path.join(tempDir, "node_modules");
    await fs.cp(nodeModulesDir, nodeModulesBackupDir, {
      recursive: true,
      force: true,
      filter: (sourcePath) =>
        shouldCopyManagedNpmRollbackSnapshotEntry({
          nodeModulesDir,
          sourcePath,
        }),
      mode: rollbackSnapshotCopyMode,
      verbatimSymlinks: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await fs.rm(tempDir, { recursive: true, force: true });
      throw error;
    }
  }

  try {
    return {
      packageJson: await readRollbackFileIfPresent(path.join(params.npmRoot, "package.json")),
      packageLockJson: await readRollbackFileIfPresent(
        path.join(params.npmRoot, "package-lock.json"),
      ),
      ...(nodeModulesBackupDir ? { nodeModulesBackupDir } : {}),
      tempDir,
    };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export async function shouldCopyManagedNpmRollbackSnapshotEntry(params: {
  nodeModulesDir: string;
  sourcePath: string | URL;
}): Promise<boolean> {
  if (typeof params.sourcePath !== "string") {
    return true;
  }

  const relativeParts = path.relative(params.nodeModulesDir, params.sourcePath).split(path.sep);
  const isPluginLocalOpenClawPeer =
    (relativeParts.length === 3 &&
      relativeParts[1] === "node_modules" &&
      relativeParts[2] === "openclaw") ||
    (relativeParts.length === 4 &&
      relativeParts[0]?.startsWith("@") &&
      relativeParts[2] === "node_modules" &&
      relativeParts[3] === "openclaw");
  if (!isPluginLocalOpenClawPeer) {
    return true;
  }

  try {
    return !(await fs.lstat(params.sourcePath)).isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function restoreManagedNpmPluginInstallRollbackSnapshot(params: {
  npmRoot: string;
  snapshot: ManagedNpmPluginInstallRollbackSnapshot;
}) {
  const nodeModulesDir = path.join(params.npmRoot, "node_modules");
  await fs.rm(nodeModulesDir, { recursive: true, force: true });
  if (params.snapshot.nodeModulesBackupDir) {
    await fs.mkdir(params.npmRoot, { recursive: true });
    await fs.cp(params.snapshot.nodeModulesBackupDir, nodeModulesDir, {
      recursive: true,
      force: true,
      mode: rollbackSnapshotCopyMode,
      verbatimSymlinks: true,
    });
  }
  await writeOrRemoveRollbackFile(
    path.join(params.npmRoot, "package.json"),
    params.snapshot.packageJson,
  );
  await writeOrRemoveRollbackFile(
    path.join(params.npmRoot, "package-lock.json"),
    params.snapshot.packageLockJson,
  );
}

export async function cleanupManagedNpmPluginInstallRollbackSnapshot(params: {
  snapshot: ManagedNpmPluginInstallRollbackSnapshot | undefined;
  logger: ManagedNpmInstallRollbackLogger;
}) {
  if (!params.snapshot) {
    return;
  }
  try {
    await fs.rm(params.snapshot.tempDir, { recursive: true, force: true });
  } catch (error) {
    params.logger.warn?.(
      `Failed to remove temporary managed npm rollback snapshot ${params.snapshot.tempDir}: ${String(error)}`,
    );
  }
}
