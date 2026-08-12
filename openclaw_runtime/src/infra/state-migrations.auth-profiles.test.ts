import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  loadPersistedAuthProfileStore,
  loadAuthProfileJsonStoreForMigration,
} from "../agents/auth-profiles/persisted.js";
import { saveAuthProfileStore } from "../agents/auth-profiles/store.js";
import { closeOpenClawAgentDatabasesForTest } from "../state/openclaw-agent-db.js";
import { closeOpenClawStateDatabaseForTest } from "../state/openclaw-state-db.js";
import { detectLegacyStateMigrations, runLegacyStateMigrations } from "./state-migrations.js";

vi.mock("../channels/plugins/bundled.js", () => ({
  listBundledChannelLegacySessionSurfaces: () => [],
  listBundledChannelLegacyStateMigrationDetectors: () => [],
}));
vi.mock("../plugins/doctor-contract-registry.js", () => ({
  listPluginDoctorStateMigrationEntries: () => [],
}));

const roots: string[] = [];
const originalStateDir = process.env.OPENCLAW_STATE_DIR;

function createFixture(): {
  stateDir: string;
  agentDir: string;
  cfg: OpenClawConfig;
  env: NodeJS.ProcessEnv;
} {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-migration-"));
  roots.push(stateDir);
  process.env.OPENCLAW_STATE_DIR = stateDir;
  const agentDir = path.join(stateDir, "agents", "main", "agent");
  mkdirSync(agentDir, { recursive: true });
  return {
    stateDir,
    agentDir,
    cfg: { agents: { list: [{ id: "main" }] } } as OpenClawConfig,
    env: { ...process.env, OPENCLAW_STATE_DIR: stateDir },
  };
}

function writeJsonStore(agentDir: string, key: string): void {
  writeFileSync(
    path.join(agentDir, "auth-profiles.json"),
    JSON.stringify({
      version: 1,
      profiles: {
        "deepseek:default": { type: "api_key", provider: "deepseek", key },
      },
    }),
  );
}

afterEach(() => {
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabaseForTest();
  if (originalStateDir === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = originalStateDir;
  }
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("provider auth JSON state migration", () => {
  it("detects and migrates a valid JSON store through SQLite", async () => {
    const fixture = createFixture();
    writeJsonStore(fixture.agentDir, "fake-json-key");

    const detected = await detectLegacyStateMigrations({
      cfg: fixture.cfg,
      env: fixture.env,
      homedir: () => fixture.stateDir,
    });

    expect(detected.authProfiles.plans).toHaveLength(1);
    expect(detected.preview.some((line) => line.includes("Auth profiles:"))).toBe(true);
    const result = await runLegacyStateMigrations({ detected, config: fixture.cfg });

    expect(result.changes.some((line) => line.includes("Migrated auth profiles:"))).toBe(true);
    expect(loadPersistedAuthProfileStore(fixture.agentDir)?.profiles["deepseek:default"]).toEqual({
      type: "api_key",
      provider: "deepseek",
      key: "fake-json-key",
    });
    expect(
      loadAuthProfileJsonStoreForMigration(fixture.agentDir)?.profiles["deepseek:default"],
    ).toEqual(expect.objectContaining({ key: "fake-json-key" }));
  });

  it("does not overwrite SQLite when it is populated after detection", async () => {
    const fixture = createFixture();
    writeJsonStore(fixture.agentDir, "stale-json-key");
    const detected = await detectLegacyStateMigrations({
      cfg: fixture.cfg,
      env: fixture.env,
      homedir: () => fixture.stateDir,
    });

    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          "deepseek:default": { type: "api_key", provider: "deepseek", key: "sqlite-key" },
        },
      },
      fixture.agentDir,
    );
    await runLegacyStateMigrations({ detected, config: fixture.cfg });

    const persisted = loadPersistedAuthProfileStore(fixture.agentDir);
    expect(persisted?.profiles["deepseek:default"]).toEqual({
      type: "api_key",
      provider: "deepseek",
      key: "sqlite-key",
    });
    expect(readFileSync(path.join(fixture.agentDir, "auth-profiles.json"), "utf8")).toContain(
      "stale-json-key",
    );
  });
});
