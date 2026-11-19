import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  buildRuntimeMemoryEpisodeFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture as _buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture as _buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryEpisodeRecord,
  type RuntimeMemorySourceEpisodeRef,
} from "../../openclaw_runtime/src/runtime-core";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const tempDirs: string[] = [];
let runtimeBuilt = false;

beforeAll(() => {
  execFileSync(
    process.execPath,
    [
      "scripts/build-openclaw-runtime.mjs",
      "--memory-read-hydration-shadow-only",
    ],
    {
      cwd: repoRoot(),
      stdio: "pipe",
    },
  );
  runtimeBuilt = true;
}, 120_000);

afterAll(() => {
  runtimeBuilt = false;
});

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime memory readonly read hydration shadow command proof", () => {
  it("documents readonly default-off explicit command boundaries in help output", () => {
    const result = runHydrationUtility(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Readonly read-hydration shadow is default-off");
    expect(result.stdout).toContain("explicit --persist flag");
    expect(result.stdout).toContain("explicit --read-shadow flag");
    expect(result.stdout).toContain("explicit --database");
    expect(result.stdout).toContain("diagnostics-only");
    expect(result.stdout).toContain("does not provide durable fact authority");
    expect(result.stdout).toContain("runtime authority");
    expect(result.stdout).toContain("Gateway");
    expect(result.stdout).toContain("Electron");
    expect(result.stdout).toContain("TaskLoop");
    expect(result.stdout).toContain("--memory-read-hydration-shadow-only");
  });

  it("does not open or create sqlite unless persist, read-shadow, and database are explicit", () => {
    expect(runtimeBuilt).toBe(true);
    const missingDbPath = path.join(createTempDir(), "missing.sqlite");

    const noPersist = runHydrationUtility([
      "--read-shadow",
      "--database",
      missingDbPath,
      "--json",
    ]);
    expect(noPersist.status).toBe(0);
    expect(JSON.parse(noPersist.stdout)).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
      facts: [],
    });
    expect(existsSync(missingDbPath)).toBe(false);

    const noReadShadow = runHydrationUtility([
      "--persist",
      "--database",
      missingDbPath,
      "--json",
    ]);
    expect(noReadShadow.status).toBe(0);
    expect(JSON.parse(noReadShadow.stdout)).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
      facts: [],
    });
    expect(existsSync(missingDbPath)).toBe(false);

    const noDatabase = runHydrationUtility([
      "--persist",
      "--read-shadow",
      "--json",
    ]);
    expect(noDatabase.status).toBe(0);
    expect(JSON.parse(noDatabase.stdout)).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
      facts: [],
    });
    expect(existsSync(missingDbPath)).toBe(false);

    const missingDatabase = runHydrationUtility([
      "--persist",
      "--read-shadow",
      "--database",
      missingDbPath,
      "--json",
    ]);
    expect(missingDatabase.status).toBe(0);
    expect(JSON.parse(missingDatabase.stdout)).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
      facts: [],
    });
    expect(existsSync(missingDbPath)).toBe(false);
  });

  it("does not create runtime memory tables in unrelated existing databases", () => {
    const dbPath = createTempDbPath();
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("CREATE TABLE unrelated_state (id TEXT PRIMARY KEY);");
    } finally {
      db.close();
    }

    const result = runHydrationUtility([
      "--persist",
      "--read-shadow",
      "--database",
      dbPath,
      "--json",
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
      facts: [],
    });

    const readonlyDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      expect(tableExists(readonlyDb, "runtime_memory_episodes")).toBe(false);
      expect(tableExists(readonlyDb, "runtime_memory_facts")).toBe(false);
      expect(tableExists(readonlyDb, "runtime_memory_meta")).toBe(false);
      expect(tableExists(readonlyDb, "unrelated_state")).toBe(true);
    } finally {
      readonlyDb.close();
    }
  });
  it("prints a retired diagnostic and never leaks data when persistence is asked for", () => {
    const dbPath = createTempDbPath();
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      now: () => 90,
    });
    expect(persistence.appendEpisode(buildEpisode("phase23_episode_first", 70))).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
    });

    const result = runHydrationUtility([
      "--persist",
      "--read-shadow",
      "--database",
      dbPath,
      "--json",
    ]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({ status: "skipped", episodes: [], facts: [] });
    // Nothing sensitive may appear in the retired output.
    expect(result.stdout).not.toContain("traceparent");
    expect(result.stdout).not.toContain("process.env SECRET");
  });

  it("exposes a package script that is only a pass-through to the hydration utility", () => {
    const script = packageScript("runtime:memory:hydrate-shadow");

    expect(script).toBe(
      "node openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs",
    );
    expect(script).not.toContain("--persist");
    expect(script).not.toContain("--read-shadow");
    expect(script).not.toContain("--database");
    expect(script).not.toMatch(
      /electron|gateway|server|listener|daemon|createServer|listen\(/iu,
    );
  });

  it("keeps package lifecycle scripts from invoking the hydration command or flags", () => {
    const scripts = packageScripts();
    for (const name of ["predev", "dev", "build", "package", "release"]) {
      const script = scripts[name];
      expect(script, `missing package script ${name}`).toEqual(expect.any(String));
      expect(script).not.toContain("runtime:memory:hydrate-shadow");
      expect(script).not.toContain("inspect-runtime-memory-hydration-shadow.mjs");
      expect(script).not.toContain("memory-read-hydration-shadow");
      expect(script).not.toContain("--memory-read-hydration-shadow-only");
      expect(script).not.toMatch(/--persist|--read-shadow|--database|--db/iu);
    }
  });

  it("keeps package script invocation no-open and no-create until all explicit flags are provided", () => {
    const missingDbPath = path.join(createTempDir(), "missing.sqlite");

    const disabled = runPackageHydrationUtility([
      "--read-shadow",
      "--database",
      missingDbPath,
      "--json",
    ]);
    expect(disabled.status).toBe(0);
    expect(JSON.parse(disabled.stdout)).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
      facts: [],
    });
    expect(existsSync(missingDbPath)).toBe(false);

    const noReadShadow = runPackageHydrationUtility([
      "--persist",
      "--database",
      missingDbPath,
      "--json",
    ]);
    expect(noReadShadow.status).toBe(0);
    expect(JSON.parse(noReadShadow.stdout)).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
      facts: [],
    });
    expect(existsSync(missingDbPath)).toBe(false);
  });

  it("reports invalid arguments without opening or creating sqlite", () => {
    const dbPath = path.join(createTempDir(), "missing.sqlite");
    const result = runHydrationUtility([
      "--persist",
      "--read-shadow",
      "--database",
      dbPath,
      "--limit",
      "0",
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--limit must be a positive integer");
    expect(existsSync(dbPath)).toBe(false);
  });
});

function buildEpisode(
  episodeId: string,
  referenceTime: number,
): RuntimeMemoryEpisodeRecord {
  return buildRuntimeMemoryEpisodeFixture({
    episodeId,
    taskId: "task_memory_hydration_command",
    kind: "verifier_summary",
    reference_time: referenceTime,
    idempotencyKey: `task_memory_hydration_command:${episodeId}`,
    boundedSummary: `Sanitized hydration command evidence for ${episodeId}.`,
    sourceRefs: [
      {
        type: "file",
        ref: "src/runtime-core/memory-read-hydration-shadow.ts",
        file: "src/runtime-core/memory-read-hydration-shadow.ts",
      },
    ],
    evidenceRefs: [
      {
        type: "test",
        ref: "tests/unit/runtime-memory-read-hydration-shadow-command.test.ts",
      },
    ],
  });
}

function _sourceEpisodeRef(
  episode: RuntimeMemoryEpisodeRecord,
): RuntimeMemorySourceEpisodeRef {
  return {
    episodeId: episode.episodeId,
    taskId: episode.taskId,
    kind: episode.kind,
    idempotencyKey: episode.idempotencyKey,
    reference_time: episode.reference_time,
  };
}

function createTempDbPath(): string {
  return path.join(createTempDir(), "openclaw.sqlite");
}

function createTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runtime-memory-hydration-command-"));
  tempDirs.push(dir);
  return dir;
}

function repoRoot(): string {
  return process.cwd();
}

function runHydrationUtility(args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(
    process.execPath,
    [
      path.join(
        repoRoot(),
        "openclaw_runtime",
        "scripts",
        "inspect-runtime-memory-hydration-shadow.mjs",
      ),
      ...args,
    ],
    {
      cwd: repoRoot(),
      encoding: "utf8",
    },
  );
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function runPackageHydrationUtility(args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "--silent",
      "run",
      "runtime:memory:hydrate-shadow",
      "--",
      ...args,
    ],
    {
      cwd: repoRoot(),
      encoding: "utf8",
      env: {
        ...process.env,
        pnpm_config_verify_deps_before_run: "false",
      },
      shell: process.platform === "win32",
    },
  );
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function packageScript(name: string): string {
  const script = packageScripts()[name];
  if (!script) {
    throw new Error(`Missing package script: ${name}`);
  }
  return script;
}

function packageScripts(): Record<string, string> {
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot(), "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  return packageJson.scripts ?? {};
}

function sqlCount(db: DatabaseSync, tableName: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as
    | { count?: number | bigint }
    | undefined;
  return Number(row?.count ?? 0);
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { ok?: unknown } | undefined;
  return row?.ok === 1;
}

function _inspectPersistenceTables(dbPath: string): Record<string, unknown> {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return {
      meta: sqlCount(db, "runtime_memory_meta"),
      episodes: sqlCount(db, "runtime_memory_episodes"),
      idempotency: sqlCount(db, "runtime_memory_episode_idempotency_keys"),
      facts: sqlCount(db, "runtime_memory_facts"),
      invalidations: sqlCount(db, "runtime_memory_invalidations"),
    };
  } finally {
    db.close();
  }
}
