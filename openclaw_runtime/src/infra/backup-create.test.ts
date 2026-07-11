import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { requireNodeSqlite } from "./node-sqlite.js";

const tempRoots: string[] = [];

afterEach(async () => {
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-backup-test-"));
  tempRoots.push(root);
  const homeDir = path.join(root, "home");
  const stateDir = path.join(root, "state");
  const workspaceDir = path.join(root, "workspace");
  const outputDir = path.join(root, "backups");
  await Promise.all([
    fs.mkdir(homeDir, { recursive: true }),
    fs.mkdir(stateDir, { recursive: true }),
    fs.mkdir(workspaceDir, { recursive: true }),
    fs.mkdir(outputDir, { recursive: true }),
  ]);
  await fs.writeFile(
    path.join(stateDir, "openclaw.json"),
    JSON.stringify({ agents: { defaults: { workspace: workspaceDir } } }),
  );
  await fs.writeFile(path.join(stateDir, "durable.txt"), "durable");
  await fs.writeFile(path.join(workspaceDir, "workspace.txt"), "workspace");
  process.env.OPENCLAW_HOME = homeDir;
  process.env.OPENCLAW_STATE_DIR = stateDir;
  process.env.OPENCLAW_CONFIG_PATH = path.join(stateDir, "openclaw.json");
  return { root, stateDir, workspaceDir, outputDir };
}

async function loadCreateBackupArchive() {
  const runtime = await import("openclaw/plugin-sdk/runtime");
  expect(runtime.createBackupArchive).toBeTypeOf("function");
  return runtime.createBackupArchive;
}

async function listArchiveEntries(archivePath: string): Promise<string[]> {
  const entries: string[] = [];
  await tar.t({
    file: archivePath,
    onentry: (entry) => entries.push(entry.path.replaceAll("\\", "/")),
  });
  return entries;
}

async function extractArchive(archivePath: string, root: string): Promise<string> {
  const extractDir = path.join(root, "extract");
  await fs.mkdir(extractDir, { recursive: true });
  await tar.x({ file: archivePath, cwd: extractDir });
  return extractDir;
}

describe("createBackupArchive", () => {
  it("creates a real tar.gz archive and returns actual metadata", async () => {
    const fixture = await createFixture();
    const createBackupArchive = await loadCreateBackupArchive();

    const result = await createBackupArchive({
      output: fixture.outputDir,
      includeWorkspace: false,
    });

    expect(result.createdAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(result.createdAt))).toBe(false);
    expect(result.archivePath).toMatch(/\.tar\.gz$/u);
    expect(result.includeWorkspace).toBe(false);
    await expect(fs.stat(result.archivePath)).resolves.toMatchObject({ size: expect.any(Number) });
    expect((await fs.stat(result.archivePath)).size).toBeGreaterThan(0);
    expect(await listArchiveEntries(result.archivePath)).toContainEqual(
      expect.stringMatching(/\/durable\.txt$/u),
    );
  });

  it("excludes workspaces when includeWorkspace is false", async () => {
    const fixture = await createFixture();
    const createBackupArchive = await loadCreateBackupArchive();

    const result = await createBackupArchive({
      output: fixture.outputDir,
      includeWorkspace: false,
    });

    expect(await listArchiveEntries(result.archivePath)).not.toContainEqual(
      expect.stringMatching(/\/workspace\.txt$/u),
    );
  });

  it("includes configured workspaces when requested", async () => {
    const fixture = await createFixture();
    const createBackupArchive = await loadCreateBackupArchive();

    const result = await createBackupArchive({
      output: fixture.outputDir,
      includeWorkspace: true,
    });

    expect(result.includeWorkspace).toBe(true);
    expect(await listArchiveEntries(result.archivePath)).toContainEqual(
      expect.stringMatching(/\/workspace\.txt$/u),
    );
  });

  it("refuses to overwrite an existing output file", async () => {
    const fixture = await createFixture();
    const output = path.join(fixture.outputDir, "existing.tar.gz");
    await fs.writeFile(output, "keep");
    const createBackupArchive = await loadCreateBackupArchive();

    await expect(createBackupArchive({ output, includeWorkspace: false })).rejects.toThrow(
      "Refusing to overwrite",
    );
    await expect(fs.readFile(output, "utf8")).resolves.toBe("keep");
  });

  it("refuses an output path inside an archived source", async () => {
    const fixture = await createFixture();
    const createBackupArchive = await loadCreateBackupArchive();

    await expect(
      createBackupArchive({
        output: path.join(fixture.stateDir, "unsafe.tar.gz"),
        includeWorkspace: false,
      }),
    ).rejects.toThrow("must not be written inside a source path");
  });

  it("filters volatile runtime files from the archive", async () => {
    const fixture = await createFixture();
    await fs.mkdir(path.join(fixture.stateDir, "logs"), { recursive: true });
    await fs.writeFile(path.join(fixture.stateDir, "logs", "gateway.log"), "volatile");
    await fs.writeFile(path.join(fixture.stateDir, "gateway.pid"), "123");
    const createBackupArchive = await loadCreateBackupArchive();

    const result = await createBackupArchive({
      output: fixture.outputDir,
      includeWorkspace: false,
    });
    const entries = await listArchiveEntries(result.archivePath);

    expect(entries).not.toContainEqual(expect.stringMatching(/\/gateway\.log$/u));
    expect(entries).not.toContainEqual(expect.stringMatching(/\/gateway\.pid$/u));
    expect(entries).toContainEqual(expect.stringMatching(/\/durable\.txt$/u));
  });

  it("captures live WAL-backed SQLite state as a consistent database", async () => {
    const fixture = await createFixture();
    const sqliteDir = path.join(fixture.stateDir, "state");
    const sqlitePath = path.join(sqliteDir, "openclaw.sqlite");
    await fs.mkdir(sqliteDir, { recursive: true });
    const sqlite = requireNodeSqlite();
    const liveDb = new sqlite.DatabaseSync(sqlitePath);
    liveDb.exec("PRAGMA journal_mode = WAL;");
    liveDb.exec("CREATE TABLE retained_state (value TEXT NOT NULL);");
    liveDb.prepare("INSERT INTO retained_state (value) VALUES (?)").run("from-wal");
    const createBackupArchive = await loadCreateBackupArchive();

    try {
      const result = await createBackupArchive({
        output: fixture.outputDir,
        includeWorkspace: false,
      });
      const extractDir = await extractArchive(result.archivePath, fixture.root);
      const entries = await listArchiveEntries(result.archivePath);
      const sqliteEntry = entries.find((entry) => entry.endsWith("/state/openclaw.sqlite"));
      expect(sqliteEntry).toBeDefined();
      const snapshot = new sqlite.DatabaseSync(path.join(extractDir, sqliteEntry ?? ""));
      try {
        expect(snapshot.prepare("SELECT value FROM retained_state").get()).toEqual({
          value: "from-wal",
        });
      } finally {
        snapshot.close();
      }
      expect(entries.some((entry) => /openclaw\.sqlite-(?:wal|shm)$/u.test(entry))).toBe(false);
    } finally {
      liveDb.close();
    }
  });

  it("captures a WAL-backed Matrix crypto .sqlite3 database under its original name", async () => {
    const fixture = await createFixture();
    const cryptoDir = path.join(fixture.stateDir, "matrix", "crypto");
    const sqlitePath = path.join(cryptoDir, "matrix-sdk-crypto.sqlite3");
    await fs.mkdir(cryptoDir, { recursive: true });
    const sqlite = requireNodeSqlite();
    const liveDb = new sqlite.DatabaseSync(sqlitePath);
    liveDb.exec("PRAGMA journal_mode = WAL;");
    liveDb.exec("PRAGMA wal_autocheckpoint = 0;");
    liveDb.exec("CREATE TABLE crypto_state (value TEXT NOT NULL);");
    liveDb.prepare("INSERT INTO crypto_state (value) VALUES (?)").run("latest-from-wal");
    const createBackupArchive = await loadCreateBackupArchive();

    try {
      const result = await createBackupArchive({
        output: fixture.outputDir,
        includeWorkspace: false,
      });
      const extractDir = await extractArchive(result.archivePath, fixture.root);
      const entries = await listArchiveEntries(result.archivePath);
      const sqliteEntry = entries.find((entry) =>
        entry.endsWith("/matrix/crypto/matrix-sdk-crypto.sqlite3"),
      );
      expect(sqliteEntry).toBeDefined();
      const snapshot = new sqlite.DatabaseSync(path.join(extractDir, sqliteEntry ?? ""));
      try {
        expect(snapshot.prepare("SELECT value FROM crypto_state").get()).toEqual({
          value: "latest-from-wal",
        });
      } finally {
        snapshot.close();
      }
      expect(
        entries.some((entry) => /matrix-sdk-crypto\.sqlite3-(?:wal|shm|journal)$/u.test(entry)),
      ).toBe(false);
    } finally {
      liveDb.close();
    }
  });

  it("cleans staged files when SQLite snapshotting fails", async () => {
    const fixture = await createFixture();
    await fs.writeFile(path.join(fixture.stateDir, "broken.sqlite"), "not sqlite");
    const createBackupArchive = await loadCreateBackupArchive();

    await expect(
      createBackupArchive({ output: fixture.outputDir, includeWorkspace: false }),
    ).rejects.toThrow();

    expect(await fs.readdir(fixture.outputDir)).toEqual([]);
  });

  it("is available through the Matrix default dynamic import path", async () => {
    const fixture = await createFixture();
    const { maybeCreateMatrixMigrationSnapshot } =
      await import("../../extensions/matrix/src/migration-snapshot-backup.js");

    const result = await maybeCreateMatrixMigrationSnapshot({
      trigger: "test",
      outputDir: fixture.outputDir,
      env: process.env,
    });

    expect(result.created).toBe(true);
    await expect(fs.stat(result.archivePath)).resolves.toBeDefined();
  });
});
