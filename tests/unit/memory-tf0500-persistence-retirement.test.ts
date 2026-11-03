// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  createRuntimeMemoryPersistenceStore,
  inspectRuntimeMemorySanitizedEpisodes,
} from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { createRuntimeMemoryRuntimeIntegration } from "../../openclaw_runtime/src/runtime-core/memory-runtime-integration";
import {
  buildRuntimeMemoryEpisodeFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  resolveRuntimeMemoryFeatureFlags,
} from "../../openclaw_runtime/src/runtime-core";

/**
 * TF-0500 retired shadow / provider / proposeFacts / persist; TF-0574 aligned the
 * surrounding tests with that production semantics. This file is the executable
 * lock for the half of the contract that must never drift silently: a caller that
 * only sets the retired config flags stays disabled and produces no side effects.
 *
 * No production source change is involved. If any assertion here starts failing,
 * someone changed retirement behaviour without a new decision.
 */
const RETIRED_CONFIG = {
  runtime: { memory: { persist: true, shadow: true, proposeFacts: true, provider: true } },
} as const;

const tempDir = () => mkdtempSync(path.join(os.tmpdir(), "tf0500-memory-"));

describe("retired runtime-memory flags can never resolve to true", () => {
  it.each([
    ["explicit true", { runtime: { memory: { persist: true, shadow: true, proposeFacts: true, provider: true } } }],
    ["string true", { runtime: { memory: { persist: "true", shadow: "true", proposeFacts: "true", provider: "true" } } }],
    ["omitted", {}],
    ["explicit false", { runtime: { memory: { persist: false, shadow: false, proposeFacts: false, provider: false } } }],
  ])("resolves every retired flag to false for %s", (_label, config) => {
    const flags = resolveRuntimeMemoryFeatureFlags(config);
    expect(flags.persist).toBe(false);
    expect(flags.shadow).toBe(false);
    expect(flags.proposeFacts).toBe(false);
    expect(flags.provider).toBe(false);
  });

  it("keeps candidateGeneration independently configurable", () => {
    expect(resolveRuntimeMemoryFeatureFlags({ runtime: { memory: { candidateGeneration: true } } }).candidateGeneration).toBe(true);
    expect(resolveRuntimeMemoryFeatureFlags({ runtime: { memory: { candidateGeneration: "true" } } }).candidateGeneration).toBe(false);
  });
});

describe("retired persistence produces no writes and no database file", () => {
  it("skips migrate without creating the database file", () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "retired.sqlite");
    const store = createRuntimeMemoryPersistenceStore({ config: RETIRED_CONFIG, database: { path: dbPath } });
    expect(store.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("skips episode and fact writes and never opens sqlite", () => {
    const openDatabase = vi.fn(() => {
      throw new Error("retired persistence must not open sqlite");
    });
    const store = createRuntimeMemoryPersistenceStore({ config: RETIRED_CONFIG, openDatabase: openDatabase as never });
    expect(store.appendEpisode(buildRuntimeMemoryEpisodeFixture())).toMatchObject({ status: "skipped", reason: "flag_disabled" });
    expect(store.appendFact(buildRuntimeMemoryTemporalFactCandidateFixture())).toMatchObject({ status: "skipped", reason: "flag_disabled" });
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it("exposes an empty store when loading retired persistence", () => {
    const store = createRuntimeMemoryPersistenceStore({ config: RETIRED_CONFIG });
    const loaded = store.loadStore();
    expect(loaded.status).toBe("skipped");
    expect(loaded.store.stats()).toMatchObject({ episodes: 0, facts: 0, invalidations: 0 });
  });

  it("skips the readonly inspector without opening sqlite", () => {
    const openReadOnlyDatabase = vi.fn(() => {
      throw new Error("retired inspection must not open sqlite");
    });
    const result = inspectRuntimeMemorySanitizedEpisodes({
      config: RETIRED_CONFIG,
      database: { path: path.join(tempDir(), "missing.sqlite") },
      openReadOnlyDatabase: openReadOnlyDatabase as never,
    });
    expect(result).toMatchObject({ status: "skipped", reason: "flag_disabled" });
    expect(openReadOnlyDatabase).not.toHaveBeenCalled();
  });
});

describe("retired integration stays inert and never invokes injected writers", () => {
  it("skips migration and writes through the integration facade", () => {
    const appendEpisode = vi.fn();
    const appendFact = vi.fn();
    const integration = createRuntimeMemoryRuntimeIntegration({
      config: RETIRED_CONFIG,
      persistence: {
        migrate: () => ({ status: "migrated" }) as never,
        appendEpisode,
        appendFact,
        invalidateFact: vi.fn(),
        loadStore: () => ({ status: "loaded", store: { stats: () => ({ episodes: 0, facts: 0, invalidations: 0 }) } }) as never,
        persistRelation: vi.fn(),
        inspectEpisodes: vi.fn(),
      } as never,
    });
    expect(integration.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });
    expect(integration.appendEpisode(buildRuntimeMemoryEpisodeFixture())).toMatchObject({ status: "skipped", reason: "flag_disabled" });
    expect(appendEpisode).not.toHaveBeenCalled();
    expect(appendFact).not.toHaveBeenCalled();
  });
});
