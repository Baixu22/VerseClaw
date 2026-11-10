---
title: backup-restore / openclaw_runtime/src/infra/backup-create.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-09T23:01:31.258Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: openclaw_runtime/src/infra/backup-create.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
// Creates retained runtime backup archives for migration safety.
import { randomUUID } from "node:crypto";
import { constants as fsConstants, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { listAgentWorkspaceDirs } from "../agents/workspace-dirs.js";
import {
  readConfigFileSnapshot,
  resolveConfigPath,
  resolveOAuthDir,
  resolveStateDir,
} from "../config/config.js";
import { createLazyRuntimeModule } from "../shared/lazy-runtime.js";
import { resolveUserPath } from "../utils.js";
import { isVolatileBackupPath } from "./backup-volatile-filter.js";
import { writeJson } from "./json-files.js";
import { requireNodeSqlite } from "./node-sqlite.js";
import { isPathInside } from "./path-guards.js";

const loadTarRuntime = createLazyRuntimeModule(() => import("tar"));
const SQLITE_DATABASE_SUFFIXES = [".sqlite", ".sqlite3"] as const;
const SQLITE_SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;

type BackupAssetKind = "state" | "config" | "credentials" | "workspace";

type BackupAsset = {
  kind: BackupAssetKind;
  sourcePath: string;
};

type SqliteSnapshot = {
  sourcePath: string;
  archiveSourcePath: string;
};

export type BackupCreateOptions = {
  output?: string;
  includeWorkspace?: boolean;
};

export type BackupCreateResult = {
  createdAt: string;
  archivePath: string;
  includeWorkspace: boolean;
};

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function isPathWithin(child: string, parent: string): boolean {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  return resolvedChild === resolvedParent || isPathInside(resolvedParent, resolvedChild);
}

async function canonicalizeForContainment(targetPath: string): Promise<string> {
  const resolved = path.resolve(targetPath);
  const missingParts: string[] = [];
  let probe = resolved;
  while (true) {
    try {
      const realPath = await fs.realpath(probe);
      return path.join(realPath, ...missingParts.toReversed());
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) {
        return resolved;
      }
      missingParts.push(path.basename(probe));
      probe = parent;
    }
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function collectBackupAssets(includeWorkspace: boolean): Promise<BackupAsset[]> {
  const stateDir = resolveStateDir();
  const configPath = resolveConfigPath();
  const oauthDir = resolveOAuthDir();
  const configSnapshot = includeWorkspace ? await readConfigFileSnapshot() : undefined;
  if (configSnapshot?.exists && !configSnapshot.valid) {
    throw new Error(
      `Config invalid at ${configSnapshot.path}; custom workspaces cannot be backed up safely.`,
    );
  }
  const workspaceDirs =
    includeWorkspace && configSnapshot?.valid ? listAgentWorkspaceDirs(configSnapshot.config) : [];
  const candidates: BackupAsset[] = [
    { kind: "state", sourcePath: stateDir },
    { kind: "config", sourcePath: configPath },
    { kind: "credentials", sourcePath: oauthDir },
    ...workspaceDirs.map((sourcePath) => ({ kind: "workspace" as const, sourcePath })),
  ];
  const assets: BackupAsset[] = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate.sourcePath);
    if (!(await pathExists(resolved))) {
      continue;
    }
    const canonical = await fs.realpath(resolved);
    if (assets.some((asset) => isPathWithin(canonical, asset.sourcePath))) {
      continue;
    }
    assets.push({ kind: candidate.kind, sourcePath: canonical });
  }
  if (assets.length === 0) {
    throw new Error("No local OpenClaw state was found to back up.");
  }
  return assets;
}

function formatArchiveTimestamp(now: Date): string {
  return now.toISOString().replaceAll(":", "-");
}

function archiveBasename(now: Date): string {
  return `${formatArchiveTimestamp(now)}-openclaw-backup.tar.gz`;
}

async function resolveOutputPath(output: string | undefined, now: Date): Promise<string> {
  const basename = archiveBasename(now);
  const rawOutput = output?.trim();
  if (!rawOutput) {
    return path.resolve(process.cwd(), basename);
  }
  const resolved = resolveUserPath(rawOutput);
  if (rawOutput.endsWith("/") || rawOutput.endsWith("\\")) {
    return path.join(resolved, basename);
  }
  try {
    if ((await fs.stat(resolved)).isDirectory()) {
      return path.join(resolved, basename);
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
  return resolved;
}

async function assertOutputIsSafe(
  outputPath: string,
  assets: readonly BackupAsset[],
): Promise<void> {
  if (await pathExists(outputPath)) {
    throw new Error(`Refusing to overwrite existing backup archive: ${outputPath}`);
  }
  const canonicalOutput = await canonicalizeForContainment(outputPath);
  const overlappingAsset = assets.find((asset) => isPathWithin(canonicalOutput, asset.sourcePath));
  if (overlappingAsset) {
    throw new Error(
      `Backup output must not be written inside a source path: ${outputPath} is inside ${overlappingAsset.sourcePath}`,
    );
  }
}

function encodeSourcePath(sourcePath: string): string {
  const normalized = sourcePath.replaceAll("\\", "/");
  const windowsPath = normalized.match(/^([A-Za-z]):\/(.*)$/u);
  if (windowsPath) {
    return path.posix.join("windows", windowsPath[1]?.toUpperCase() ?? "UNKNOWN", windowsPath[2]);
  }
  if (normalized.startsWith("/")) {
    return path.posix.join("posix", normalized.slice(1));
  }
  return path.posix.join("relative", normalized);
}

function archiveEntryPath(archiveRoot: string, sourcePath: string): string {
  return path.posix.join(archiveRoot, "payload", encodeSourcePath(sourcePath));
}

function isRuntimeSqliteDatabasePath(entryPath: string): boolean {
  const filename = path.basename(entryPath).toLowerCase();
  return SQLITE_DATABASE_SUFFIXES.some((suffix) => filename.endsWith(suffix));
}

function isRuntimeSqlitePath(entryPath: string): boolean {
  const filename = path.basename(entryPath).toLowerCase();
  const sidecarSuffix = SQLITE_SIDECAR_SUFFIXES.find((suffix) => filename.endsWith(suffix));
  const databaseFilename = sidecarSuffix ? filename.slice(0, -sidecarSuffix.length) : filename;
  return SQLITE_DATABASE_SUFFIXES.some((suffix) => databaseFilename.endsWith(suffix));
}

async function listSqliteFiles(stateDir: string): Promise<string[]> {
  const sqliteFiles: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") {
          await visit(entryPath);
        }
      } else if (entry.isFile() && isRuntimeSqliteDatabasePath(entry.name)) {
        sqliteFiles.push(path.resolve(entryPath));
      }
    }
  }
  await visit(stateDir);
  return sqliteFiles.toSorted((left, right) => left.localeCompare(right));
}

async function createSqliteSnapshots(params: {
  stateDir: string;
  tempDir: string;
}): Promise<SqliteSnapshot[]> {
  const sqlite = requireNodeSqlite();
  const databasePaths = await listSqliteFiles(params.stateDir);
  const snapshots: SqliteSnapshot[] = [];
  for (const [index, archiveSourcePath] of databasePaths.entries()) {
    const source = new sqlite.DatabaseSync(archiveSourcePath, { readOnly: true });
    const sourcePath = path.join(params.tempDir, `sqlite-snapshot-${index}.sqlite`);
    try {
      source.exec("PRAGMA busy_timeout = 30000;");
      source.prepare("VACUUM INTO ?").run(sourcePath);
    } finally {
      source.close();
    }
    await fs.chmod(sourcePath, 0o600);
    snapshots.push({ sourcePath, archiveSourcePath });
  }
  return snapshots;
}

function isSqliteSourcePath(entryPath: string, stateDir: string): boolean {
  const resolved = path.resolve(entryPath);
  if (!isPathWithin(resolved, stateDir)) {
    return false;
  }
  return isRuntimeSqlitePath(resolved);
}

export async function writeArchiveStreamToFile(params: {
  archivePath: string;
  archiveStream: AsyncIterable<Uint8Array> | NodeJS.ReadableStream;
}): Promise<void> {
  await pipeline(
    params.archiveStream,
    createWriteStream(params.archivePath, { flags: "wx", mode: 0o600 }),
  );
}

async function publishArchive(tempArchivePath: string, outputPath: string): Promise<void> {
  try {
    await fs.link(tempArchivePath, outputPath);
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw new Error(`Refusing to overwrite existing backup archive: ${outputPath}`, {
        cause: error,
      });
    }
    if (!["ENOTSUP", "EOPNOTSUPP", "EPERM"].includes(errorCode(error) ?? "")) {
      throw error;
    }
    await fs.copyFile(tempArchivePath, outputPath, fsConstants.COPYFILE_EXCL);
  }
  await fs.rm(tempArchivePath, { force: true });
}

export const testApi = { writeArchiveStreamToFile };

export async function createBackupArchive(
  options: BackupCreateOptions = {},
): Promise<BackupCreateResult> {
  const now = new Date();
  const createdAt = now.toISOString();
  const includeWorkspace = options.includeWorkspace ?? true;
  const assets = await collectBackupAssets(includeWorkspace);
  const outputPath = await resolveOutputPath(options.output, now);
  await assertOutputIsSafe(outputPath, assets);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const archiveRoot = `${formatArchiveTimestamp(now)}-openclaw-backup`;
  const tempRoot = await canonicalizeForContainment(os.tmpdir());
  const usableTempRoot = assets.some((asset) => isPathWithin(tempRoot, asset.sourcePath))
    ? path.dirname(outputPath)
    : tempRoot;
  const tempDir = await fs.mkdtemp(path.join(usableTempRoot, "openclaw-backup-"));
  const tempArchivePath = `${outputPath}.${randomUUID()}.tmp`;
  try {
    const stateAsset = assets.find((asset) => asset.kind === "state");
    const sqliteSnapshots = stateAsset
      ? await createSqliteSnapshots({ stateDir: stateAsset.sourcePath, tempDir })
      : [];
    const manifestPath = path.join(tempDir, "manifest.json");
    await writeJson(
      manifestPath,
      {
        schemaVersion: 1,
        createdAt,
        includeWorkspace,
        assets,
      },
      { trailingNewline: true },
    );
    const remappedSources = new Map(
      sqliteSnapshots.map((snapshot) => [
        path.resolve(snapshot.sourcePath),
        snapshot.archiveSourcePath,
      ]),
    );
    const tar = await loadTarRuntime();
    await writeArchiveStreamToFile({
      archivePath: tempArchivePath,
      archiveStream: tar.c(
        {
          gzip: true,
          portable: true,
          preservePaths: true,
          filter: (entryPath) => {
            const resolved = path.resolve(entryPath);
            if (resolved === manifestPath || remappedSources.has(resolved)) {
              return true;
            }
            if (stateAsset && isSqliteSourcePath(resolved, stateAsset.sourcePath)) {
              return false;
            }
            return !isVolatileBackupPath(entryPath, {
              stateDirs: [stateAsset?.sourcePath ?? resolveStateDir()],
            });
          },
          onWriteEntry: (entry) => {
            const resolved = path.resolve(entry.path);
            if (resolved === manifestPath) {
              entry.path = path.posix.join(archiveRoot, "manifest.json");
              return;
            }
            entry.path = archiveEntryPath(archiveRoot, remappedSources.get(resolved) ?? resolved);
          },
        },
        [
          manifestPath,
          ...sqliteSnapshots.map((snapshot) => snapshot.sourcePath),
          ...assets.map((asset) => asset.sourcePath),
        ],
      ),
    });
    await publishArchive(tempArchivePath, outputPath);
  } finally {
    await fs.rm(tempArchivePath, { force: true }).catch(() => undefined);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
  return { createdAt, archivePath: outputPath, includeWorkspace };
}

~~~
