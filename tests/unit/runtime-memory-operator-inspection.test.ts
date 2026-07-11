import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  inspectRuntimeMemoryForOperator,
  type RuntimeMemoryEpisodeRecord,
} from "../../openclaw_runtime/src/runtime-core";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { buildRuntimeMemoryEpisodeFixture } from "../../openclaw_runtime/src/runtime-core/memory-context";

const tempDirs: string[] = [];
let runtimeBuilt = false;
let runtimeSandboxRoot: string | undefined;

beforeAll(() => {
  runtimeSandboxRoot = createRuntimeSandbox();
  execFileSync(
    process.execPath,
    [
      "scripts/build-openclaw-runtime.mjs",
      "--memory-operator-inspection-only",
    ],
    {
      cwd: runtimeSandboxRoot,
      stdio: "pipe",
    },
  );
  runtimeBuilt = true;
}, 120_000);

afterAll(() => {
  runtimeBuilt = false;
  if (runtimeSandboxRoot) {
    rmSync(runtimeSandboxRoot, { recursive: true, force: true });
    runtimeSandboxRoot = undefined;
  }
});

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime memory readonly operator inspection surface", () => {
  it("stays skipped without opening sqlite when persist is false or omitted", () => {
    let openCalls = 0;
    const openReadOnlyDatabase = () => {
      openCalls += 1;
      throw new Error("disabled operator inspection must not open sqlite");
    };

    expect(inspectRuntimeMemoryForOperator({
      config: { runtime: { memory: { persist: false } } },
      databasePath: path.join(createTempDir(), "missing.sqlite"),
      now: () => 10,
      openReadOnlyDatabase,
    })).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
      stats: {
        episodeCount: 0,
        returned: 0,
        limit: 256,
        truncated: false,
        inspectedAt: 10,
      },
    });

    expect(inspectRuntimeMemoryForOperator({
      config: {},
      databasePath: path.join(createTempDir(), "missing.sqlite"),
      openReadOnlyDatabase,
    })).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
    });
    expect(openCalls).toBe(0);
  });

  it("requires an explicit database path before opening sqlite", () => {
    let openCalls = 0;

    expect(inspectRuntimeMemoryForOperator({
      config: { runtime: { memory: { persist: true } } },
      now: () => 20,
      openReadOnlyDatabase: () => {
        openCalls += 1;
        throw new Error("missing path must not open sqlite");
      },
    })).toMatchObject({
      status: "skipped",
      reason: "database_path_required",
      episodes: [],
      stats: {
        episodeCount: 0,
        returned: 0,
        limit: 256,
        truncated: false,
        inspectedAt: 20,
      },
    });
    expect(openCalls).toBe(0);
  });

  it("does not create a missing database file", () => {
    const dbPath = path.join(createTempDir(), "missing.sqlite");

    expect(inspectRuntimeMemoryForOperator({
      config: { runtime: { memory: { persist: true } } },
      databasePath: dbPath,
    })).toMatchObject({
      status: "skipped",
      reason: "database_missing",
      episodes: [],
    });
    expect(existsSync(dbPath)).toBe(false);
  });

  it("does not create runtime memory tables in an existing unrelated database", () => {
    const dbPath = createTempDbPath();
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("CREATE TABLE unrelated_state (id TEXT PRIMARY KEY);");
    } finally {
      db.close();
    }

    expect(inspectRuntimeMemoryForOperator({
      config: { runtime: { memory: { persist: true } } },
      databasePath: dbPath,
    })).toMatchObject({
      status: "skipped",
      reason: "table_missing",
      episodes: [],
    });

    const readonlyDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      expect(tableExists(readonlyDb, "runtime_memory_episodes")).toBe(false);
      expect(tableExists(readonlyDb, "runtime_memory_meta")).toBe(false);
      expect(tableExists(readonlyDb, "unrelated_state")).toBe(true);
    } finally {
      readonlyDb.close();
    }
  });

  it("returns only sanitized episode summaries and leaves persistence tables unchanged", () => {
    const dbPath = createTempDbPath();
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      now: () => 30,
    });
    expect(persistence.appendEpisode(buildEpisode("phase17_episode", 30)))
      .toMatchObject({ status: "persisted", stored: true });

    const writeDb = new DatabaseSync(dbPath);
    try {
      writeDb.prepare(
        "UPDATE runtime_memory_episodes SET metadata_json = ?, record_json = ? WHERE episode_id = ?",
      ).run(
        JSON.stringify({
          safe: "kept",
          prompt: "prompt dump",
          env: "process.env SECRET traceparent",
        }),
        JSON.stringify({
          raw: "raw task text self-check toolOutput RuntimeMemoryProvider runtimeAuthority",
        }),
        "phase17_episode",
      );
    } finally {
      writeDb.close();
    }

    const before = inspectPersistenceTables(dbPath);
    const inspection = inspectRuntimeMemoryForOperator({
      config: { runtime: { memory: { persist: true } } },
      databasePath: dbPath,
      limit: 5,
      now: () => 40,
    });
    const after = inspectPersistenceTables(dbPath);

    expect(inspection).toMatchObject({
      status: "loaded",
      episodes: [
        {
          episodeId: "phase17_episode",
          taskId: "task_memory",
          kind: "verifier_summary",
          reference_time: 30,
          boundedSummary: "Sanitized bounded memory evidence for phase17_episode.",
          redactionStatus: "sanitized",
          metadata: {
            safe: "kept",
            prompt: "[redacted]",
            env: "[redacted]",
          },
          sourceRefs: [
            expect.objectContaining({
              type: "file",
              ref: "src/runtime-core/memory-operator-inspection.ts",
            }),
          ],
          evidenceRefs: [
            expect.objectContaining({
              type: "test",
              ref: "tests/unit/runtime-memory-operator-inspection.test.ts",
            }),
          ],
        },
      ],
      stats: {
        episodeCount: 1,
        returned: 1,
        limit: 5,
        truncated: false,
        inspectedAt: 40,
      },
      diagnostics: [],
    });
    expect(after).toEqual(before);

    const serialized = JSON.stringify(inspection);
    expect(serialized).not.toContain("record_json");
    expect(serialized).not.toContain("raw task text");
    expect(serialized).not.toContain("self-check");
    expect(serialized).not.toContain("toolOutput");
    expect(serialized).not.toContain("process.env");
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("traceparent");
    expect(serialized).not.toContain("RuntimeMemoryProvider");
    expect(serialized).not.toContain("runtimeAuthority");
    expect(serialized).not.toContain("candidate");
    expect(serialized).not.toContain("proposeFacts");
  });
});

describe("runtime memory readonly operator inspection utility", () => {
  it("documents the readonly explicit built-runtime boundary in help output", () => {
    const result = runInspectionUtility(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Readonly inspection is default-off");
    expect(result.stdout).toContain("explicit --persist flag");
    expect(result.stdout).toContain("explicit --database <path>");
    expect(result.stdout).toContain("do not open, create, migrate, or write");
    expect(result.stdout).toContain("does not affect runtime behavior");
    expect(result.stdout).toContain("does not provide durable fact authority");
    expect(result.stdout).toContain("runtime authority");
    expect(result.stdout).toContain("existing built OpenClaw runtime");
    expect(result.stdout).toContain("Gateway");
    expect(result.stdout).toContain("Electron");
    expect(result.stdout).toContain("TaskLoop");
  });

  it("returns skipped diagnostics without creating sqlite for disabled or missing inputs", () => {
    expect(runtimeBuilt).toBe(true);
    const missingDbPath = path.join(createTempDir(), "missing.sqlite");

    const disabled = runInspectionUtility([
      "--database",
      missingDbPath,
      "--json",
    ]);
    expect(disabled.status).toBe(0);
    expect(JSON.parse(disabled.stdout)).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
    });
    expect(existsSync(missingDbPath)).toBe(false);

    const missingPath = runInspectionUtility(["--persist", "--json"]);
    expect(missingPath.status).toBe(0);
    expect(JSON.parse(missingPath.stdout)).toMatchObject({
      status: "skipped",
      reason: "database_path_required",
      episodes: [],
    });

    const missingDb = runInspectionUtility([
      "--persist",
      "--database",
      missingDbPath,
      "--json",
    ]);
    expect(missingDb.status).toBe(0);
    expect(JSON.parse(missingDb.stdout)).toMatchObject({
      status: "skipped",
      reason: "database_missing",
      episodes: [],
    });
    expect(existsSync(missingDbPath)).toBe(false);
  });

  it("does not create runtime memory tables through the built utility", () => {
    const dbPath = createTempDbPath();
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("CREATE TABLE unrelated_state (id TEXT PRIMARY KEY);");
    } finally {
      db.close();
    }

    const result = runInspectionUtility([
      "--persist",
      "--database",
      dbPath,
      "--json",
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "skipped",
      reason: "table_missing",
      episodes: [],
    });

    const readonlyDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      expect(tableExists(readonlyDb, "runtime_memory_episodes")).toBe(false);
      expect(tableExists(readonlyDb, "runtime_memory_meta")).toBe(false);
      expect(tableExists(readonlyDb, "unrelated_state")).toBe(true);
    } finally {
      readonlyDb.close();
    }
  });

  it("prints sanitized JSON and text from an explicit existing built-runtime database", () => {
    const dbPath = createTempDbPath();
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      now: () => 50,
    });
    expect(persistence.appendEpisode(buildEpisode("phase18_episode", 50)))
      .toMatchObject({ status: "persisted", stored: true });

    const writeDb = new DatabaseSync(dbPath);
    try {
      writeDb.prepare(
        "UPDATE runtime_memory_episodes SET metadata_json = ?, record_json = ? WHERE episode_id = ?",
      ).run(
        JSON.stringify({
          safe: "kept",
          template: "subagent template",
          tool: "tool args secret trace marker",
        }),
        JSON.stringify({
          raw: "raw task text self-check stdout stderr env secret trace RuntimeMemoryProvider runtime authority facts candidates",
        }),
        "phase18_episode",
      );
    } finally {
      writeDb.close();
    }

    const before = inspectPersistenceTables(dbPath);
    const jsonResult = runInspectionUtility([
      "--persist",
      "--database",
      dbPath,
      "--limit",
      "5",
      "--json",
    ]);
    const textResult = runInspectionUtility([
      "--persist",
      "--database",
      dbPath,
      "--limit",
      "5",
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
          episodeId: "phase18_episode",
          taskId: "task_memory",
          kind: "verifier_summary",
          boundedSummary: "Sanitized bounded memory evidence for phase18_episode.",
          metadata: {
            safe: "kept",
            tool: "[redacted]",
          },
        },
      ],
      stats: {
        episodeCount: 1,
        returned: 1,
        limit: 5,
      },
    });
    expect(textResult.stdout).toContain("Runtime Memory readonly inspection: loaded");
    expect(textResult.stdout).toContain("phase18_episode");

    for (const output of [jsonResult.stdout, textResult.stdout]) {
      expect(output).not.toContain("record_json");
      expect(output).not.toContain("raw task text");
      expect(output).not.toContain("self-check");
      expect(output).not.toContain("subagent template");
      expect(output).not.toContain("tool args");
      expect(output).not.toContain("stdout");
      expect(output).not.toContain("stderr");
      expect(output).not.toContain("env secret");
      expect(output).not.toContain("trace marker");
      expect(output).not.toContain("RuntimeMemoryProvider");
      expect(output).not.toContain("runtime authority");
      expect(output).not.toContain("facts");
      expect(output).not.toContain("candidates");
    }
  });

  it("reports invalid arguments without opening or creating sqlite", () => {
    const dbPath = path.join(createTempDir(), "missing.sqlite");
    const result = runInspectionUtility([
      "--persist",
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

  it("exposes a package script that is only a pass-through to the inspector", () => {
    const script = packageScript("runtime:memory:inspect");

    expect(script).toBe(
      "node openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs",
    );
    expect(script).not.toContain("--persist");
    expect(script).not.toContain("--database");
    expect(script).not.toMatch(
      /electron|gateway|server|listener|daemon|createServer|listen\(/iu,
    );
  });

  it("keeps lifecycle and packaging scripts from invoking the inspector", () => {
    const scripts = packageScripts();
    const lifecycleScripts = [
      "predev",
      "dev",
      "build",
      "package",
      "release",
    ];

    for (const name of lifecycleScripts) {
      const script = scripts[name];
      expect(script, `missing package script ${name}`).toEqual(expect.any(String));
      expect(script).not.toContain("runtime:memory:inspect");
      expect(script).not.toContain("inspect-runtime-memory-episodes.mjs");
    }
  });

  it("keeps package/build script chains from passing inspector persistence or startup flags", () => {
    const scripts = packageScripts();
    const inspectedScripts = [
      "runtime:memory:inspect",
      "build:runtime",
      "predev",
      "build",
      "package",
      "release",
    ];

    for (const name of inspectedScripts) {
      const script = scripts[name];
      expect(script, `missing package script ${name}`).toEqual(expect.any(String));
      if (name !== "runtime:memory:inspect") {
        expect(script).not.toContain("inspect-runtime-memory-episodes.mjs");
      }
      expect(script).not.toMatch(
        /--persist|--database|--db|gateway|server|listener|daemon|createServer|listen\(/iu,
      );
    }
  });

  it("keeps the runtime build proof from executing the inspector utility", () => {
    const buildScript = readFileSync(
      path.join(repoRoot(), "scripts", "build-openclaw-runtime.mjs"),
      "utf8",
    );

    expect(buildScript).toContain("memory-operator-inspection");
    expect(buildScript).toContain("--memory-operator-inspection-only");
    expect(buildScript).not.toContain("inspect-runtime-memory-episodes.mjs");
    expect(buildScript).not.toContain("runtime:memory:inspect");
    expect(buildScript).not.toMatch(
      /--persist|--database|--db|createServer|listen\(|WebSocketServer|daemon/iu,
    );
  });

  it("runs the package script help without adding implicit persist or database flags", () => {
    const result = runPackageInspectionUtility(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("Unknown option");
    expect(result.stderr).not.toContain("Command failed");
    expect(result.stdout).toContain("Readonly inspection is default-off");
    expect(result.stdout).toContain("explicit --persist flag");
    expect(result.stdout).toContain("explicit --database <path>");
    expect(result.stdout).toContain("does not affect runtime behavior");
    expect(result.stdout).toContain("does not provide durable fact authority");
  });

  it("keeps package script invocation no-open and no-create until both explicit flags are provided", () => {
    const missingDbPath = path.join(createTempDir(), "missing.sqlite");

    const disabled = runPackageInspectionUtility([
      "--database",
      missingDbPath,
      "--json",
    ]);
    expect(disabled.status).toBe(0);
    expect(JSON.parse(disabled.stdout)).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
    });
    expect(existsSync(missingDbPath)).toBe(false);

    const missingPath = runPackageInspectionUtility(["--persist", "--json"]);
    expect(missingPath.status).toBe(0);
    expect(JSON.parse(missingPath.stdout)).toMatchObject({
      status: "skipped",
      reason: "database_path_required",
      episodes: [],
    });
    expect(existsSync(missingDbPath)).toBe(false);
  });

  it("returns sanitized package script output for explicit existing databases", () => {
    const dbPath = createTempDbPath();
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      now: () => 60,
    });
    expect(persistence.appendEpisode(buildEpisode("phase19_episode", 60)))
      .toMatchObject({ status: "persisted", stored: true });

    const writeDb = new DatabaseSync(dbPath);
    try {
      writeDb.prepare(
        "UPDATE runtime_memory_episodes SET metadata_json = ?, record_json = ? WHERE episode_id = ?",
      ).run(
        JSON.stringify({
          safe: "kept",
          authorization: "secret bearer token",
          traceparent: "trace marker",
        }),
        JSON.stringify({
          raw: "raw task text jsonl prompt payload checkpoint toolOutput provider runtime authority facts candidates",
        }),
        "phase19_episode",
      );
    } finally {
      writeDb.close();
    }

    const before = inspectPersistenceTables(dbPath);
    const jsonResult = runPackageInspectionUtility([
      "--persist",
      "--database",
      dbPath,
      "--limit",
      "5",
      "--json",
    ]);
    const textResult = runPackageInspectionUtility([
      "--persist",
      "--database",
      dbPath,
      "--limit",
      "5",
    ]);
    const after = inspectPersistenceTables(dbPath);

    expect(jsonResult.status).toBe(0);
    expect(textResult.status).toBe(0);
    expect(after).toEqual(before);

    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      status: "loaded",
      episodes: [
        {
          episodeId: "phase19_episode",
          taskId: "task_memory",
          boundedSummary: "Sanitized bounded memory evidence for phase19_episode.",
          metadata: {
            safe: "kept",
          },
        },
      ],
      stats: {
        episodeCount: 1,
        returned: 1,
        limit: 5,
      },
    });
    expect(textResult.stdout).toContain("Runtime Memory readonly inspection: loaded");
    expect(textResult.stdout).toContain("phase19_episode");

    for (const output of [jsonResult.stdout, textResult.stdout]) {
      expect(output).not.toContain("record_json");
      expect(output).not.toContain("raw task text");
      expect(output).not.toContain("jsonl");
      expect(output).not.toContain("prompt payload");
      expect(output).not.toContain("checkpoint");
      expect(output).not.toContain("toolOutput");
      expect(output).not.toContain("secret bearer token");
      expect(output).not.toContain("trace marker");
      expect(output).not.toContain("provider");
      expect(output).not.toContain("runtime authority");
      expect(output).not.toContain("facts");
      expect(output).not.toContain("candidates");
    }
  });
});

function buildEpisode(
  episodeId: string,
  referenceTime: number,
): RuntimeMemoryEpisodeRecord {
  return buildRuntimeMemoryEpisodeFixture({
    episodeId,
    taskId: "task_memory",
    kind: "verifier_summary",
    reference_time: referenceTime,
    idempotencyKey: `task_memory:${episodeId}`,
    boundedSummary: `Sanitized bounded memory evidence for ${episodeId}.`,
    sourceRefs: [
      {
        type: "file",
        ref: "src/runtime-core/memory-operator-inspection.ts",
        file: "src/runtime-core/memory-operator-inspection.ts",
      },
    ],
    evidenceRefs: [
      {
        type: "test",
        ref: "tests/unit/runtime-memory-operator-inspection.test.ts",
      },
    ],
  });
}

function createTempDbPath(): string {
  return path.join(createTempDir(), "openclaw.sqlite");
}

function createTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runtime-memory-operator-"));
  tempDirs.push(dir);
  return dir;
}

function repoRoot(): string {
  return process.cwd();
}

function createRuntimeSandbox(): string {
  const sandboxRoot = mkdtempSync(
    path.join(os.tmpdir(), "runtime-memory-operator-build-"),
  );
  const sandboxRuntimeRoot = path.join(sandboxRoot, "openclaw_runtime");

  try {
    mkdirSync(path.join(sandboxRoot, "scripts"), { recursive: true });
    mkdirSync(path.join(sandboxRuntimeRoot, "scripts"), { recursive: true });

    for (const directory of ["src", "packages", "node_modules"]) {
      symlinkSync(
        path.join(repoRoot(), "openclaw_runtime", directory),
        path.join(sandboxRuntimeRoot, directory),
        process.platform === "win32" ? "junction" : "dir",
      );
    }

    copyFileSync(
      path.join(repoRoot(), "openclaw_runtime", "tsconfig.json"),
      path.join(sandboxRuntimeRoot, "tsconfig.json"),
    );
    copyFileSync(
      path.join(repoRoot(), "scripts", "build-openclaw-runtime.mjs"),
      path.join(sandboxRoot, "scripts", "build-openclaw-runtime.mjs"),
    );
    copyFileSync(
      path.join(
        repoRoot(),
        "openclaw_runtime",
        "scripts",
        "inspect-runtime-memory-episodes.mjs",
      ),
      path.join(
        sandboxRuntimeRoot,
        "scripts",
        "inspect-runtime-memory-episodes.mjs",
      ),
    );
    writeFileSync(
      path.join(sandboxRoot, "package.json"),
      JSON.stringify(
        {
          private: true,
          scripts: {
            "runtime:memory:inspect": packageScript("runtime:memory:inspect"),
          },
        },
        null,
        2,
      ),
    );

    return sandboxRoot;
  } catch (error) {
    rmSync(sandboxRoot, { recursive: true, force: true });
    throw error;
  }
}

function sandboxRoot(): string {
  if (!runtimeSandboxRoot) {
    throw new Error("Runtime Memory operator inspection sandbox is not ready");
  }
  return runtimeSandboxRoot;
}

function runInspectionUtility(args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(
    process.execPath,
    [
      path.join(
        sandboxRoot(),
        "openclaw_runtime",
        "scripts",
        "inspect-runtime-memory-episodes.mjs",
      ),
      ...args,
    ],
    {
      cwd: sandboxRoot(),
      encoding: "utf8",
    },
  );
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function runPackageInspectionUtility(args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "--silent",
      "run",
      "runtime:memory:inspect",
      "--",
      ...args,
    ],
    {
      cwd: sandboxRoot(),
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
