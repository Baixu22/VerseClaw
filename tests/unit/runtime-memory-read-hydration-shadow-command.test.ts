import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  buildRuntimeMemoryEpisodeFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
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
      reason: "read_shadow_disabled",
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
      reason: "database_path_required",
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
      reason: "database_missing",
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
      reason: "table_missing",
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

  it("prints sanitized bounded JSON and text for explicit existing runtime memory databases", () => {
    const dbPath = createTempDbPath();
    const firstEpisode = buildEpisode("phase23_episode_first", 70);
    const secondEpisode = buildEpisode("phase23_episode_second", 80);
    const sourceEpisodeRefs = [sourceEpisodeRef(firstEpisode)];
    let persistedAt = 90;
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      now: () => persistedAt++,
    });

    expect(persistence.appendEpisode(firstEpisode)).toMatchObject({
      status: "persisted",
      stored: true,
    });
    expect(persistence.appendEpisode(secondEpisode)).toMatchObject({
      status: "persisted",
      stored: true,
    });
    expect(persistence.appendFact(buildRuntimeMemoryTemporalFactFixture({
      factId: "phase23_fact",
      taskId: "task_memory_hydration_command",
      subject: "HydrationShadowCommand",
      predicate: "reads",
      objectSummary: "Sanitized command fact projection only.",
      valid_at: 70,
      reference_time: 70,
      sourceEpisodeRefs,
      metadata: {
        safe: "kept",
        env: "process.env SECRET traceparent",
      },
    }))).toMatchObject({ status: "persisted", stored: true });
    expect(persistence.appendFact(buildRuntimeMemoryTemporalFactCandidateFixture({
      factId: "phase23_candidate",
      taskId: "task_memory_hydration_command",
      subject: "HydrationShadowCommand",
      predicate: "keeps",
      objectSummary: "Candidate projection remains non-authoritative.",
      verificationStatus: "candidate",
      sourceEpisodeRefs,
    }))).toMatchObject({ status: "persisted", stored: true });

    const writeDb = new DatabaseSync(dbPath);
    try {
      writeDb.prepare(
        "UPDATE runtime_memory_episodes SET metadata_json = ?, record_json = ? WHERE episode_id = ?",
      ).run(
        JSON.stringify({
          safe: "kept",
          prompt: "raw prompt",
          tool: "tool args secret trace marker",
        }),
        JSON.stringify({
          raw: "raw task text self-check subagent template stdout stderr env secret trace RuntimeMemoryProvider provider runtime authority",
        }),
        firstEpisode.episodeId,
      );
      writeDb.prepare(
        "UPDATE runtime_memory_facts SET metadata_json = ?, record_json = ? WHERE fact_id = ?",
      ).run(
        JSON.stringify({
          safe: "kept",
          authorization: "secret bearer token",
        }),
        JSON.stringify({
          raw: "raw fact record candidates provider runtime authority",
        }),
        "phase23_fact",
      );
    } finally {
      writeDb.close();
    }

    const before = inspectPersistenceTables(dbPath);
    const jsonResult = runHydrationUtility([
      "--persist",
      "--read-shadow",
      "--database",
      dbPath,
      "--limit",
      "1",
      "--max-facts",
      "1",
      "--json",
    ]);
    const textResult = runHydrationUtility([
      "--persist",
      "--read-shadow",
      "--database",
      dbPath,
      "--limit",
      "1",
      "--max-facts",
      "1",
    ]);
    const after = inspectPersistenceTables(dbPath);

    expect(jsonResult.status).toBe(0);
    expect(textResult.status).toBe(0);
    expect(after).toEqual(before);

    const parsed = JSON.parse(jsonResult.stdout);
    expect(parsed).toMatchObject({
      status: "loaded",
      episodes: [
        {
          episodeId: "phase23_episode_first",
          taskId: "task_memory_hydration_command",
          kind: "verifier_summary",
          boundedSummary: "Sanitized hydration command evidence for phase23_episode_first.",
          metadata: {
            safe: "kept",
            prompt: "[redacted]",
            tool: "[redacted]",
          },
        },
      ],
      facts: [
        {
          factId: "phase23_fact",
          recordKind: "fact",
          taskId: "task_memory_hydration_command",
          subject: "HydrationShadowCommand",
          predicate: "reads",
          objectSummary: "Sanitized command fact projection only.",
          metadata: {
            safe: "kept",
          },
        },
      ],
      stats: {
        episodeCount: 2,
        factCount: 2,
        episodesReturned: 1,
        factsReturned: 1,
        episodeLimit: 1,
        factLimit: 1,
        truncated: true,
      },
      authority: {
        diagnosticsOnly: true,
        readonly: true,
        noPromptInjection: true,
        noProviderOrdering: true,
        noRuntimeAuthority: true,
        noDurableFactAuthority: true,
      },
    });
    expect(textResult.stdout).toContain(
      "Runtime Memory readonly read-hydration shadow: loaded",
    );
    expect(textResult.stdout).toContain("phase23_episode_first");
    expect(textResult.stdout).toContain("phase23_fact");

    for (const output of [jsonResult.stdout, textResult.stdout]) {
      expect(output).not.toContain("record_json");
      expect(output).not.toContain("raw task text");
      expect(output).not.toContain("raw fact record");
      expect(output).not.toContain("self-check");
      expect(output).not.toContain("subagent");
      expect(output).not.toContain("template");
      expect(output).not.toContain("stdout");
      expect(output).not.toContain("stderr");
      expect(output).not.toContain("process.env");
      expect(output).not.toContain("SECRET");
      expect(output).not.toContain("traceparent");
      expect(output).not.toContain("tool args");
      expect(output).not.toContain("secret bearer token");
      expect(output).not.toContain("RuntimeMemoryProvider");
      expect(output).not.toContain("provider runtime authority");
      expect(output).not.toContain("runtimeAuthority");
    }
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
      reason: "read_shadow_disabled",
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

function sourceEpisodeRef(
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

function inspectPersistenceTables(dbPath: string): Record<string, unknown> {
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
