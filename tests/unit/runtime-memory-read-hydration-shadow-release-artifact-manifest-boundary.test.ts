import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

const HYDRATION_COMMAND_OR_HELPER =
  /runtime:memory:hydrate-shadow|inspect-runtime-memory-hydration-shadow\.mjs|memory-read-hydration-shadow|readRuntimeMemoryHydrationShadow|hydrateRuntimeMemoryShadowContext/iu;
const HYDRATION_BUILD_FLAG = /--memory-read-hydration-shadow-only/iu;
const IMPLICIT_SQLITE_FLAGS = /--persist|--read-shadow|--database\b|--db\b/iu;
const MUTATION_TERMS =
  /migrate|appendEpisode|appendFact|invalidateFact|ensureRuntimeMemoryPersistenceSchema|withWriteTransaction|trimRows|insertInto|updateTable|deleteFrom/iu;

describe("runtime memory read hydration shadow release artifact manifest boundary", () => {
  it("keeps release artifact manifests as resource declarations, not hydration invocations", () => {
    const builderSource = readRepoFile("electron-builder.yml");
    const builderConfig = parseYaml(builderSource) as {
      asar?: unknown;
      asarUnpack?: unknown[];
      extraResources?: Array<Record<string, unknown>>;
      files?: unknown[];
    };

    expect(builderConfig.files).toEqual(
      expect.arrayContaining(["dist", "dist-electron", "package.json"]),
    );
    expect(builderConfig.asar).toBe(true);
    expect(builderConfig.extraResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "build/openclaw-runtime/",
          to: "openclaw-runtime/",
        }),
      ]),
    );
    expect(JSON.stringify(builderConfig.asarUnpack ?? [])).not.toMatch(
      HYDRATION_COMMAND_OR_HELPER,
    );
    expect(builderSource).not.toMatch(HYDRATION_COMMAND_OR_HELPER);
    expect(builderSource).not.toMatch(HYDRATION_BUILD_FLAG);
    expect(builderSource).not.toMatch(IMPLICIT_SQLITE_FLAGS);
  });

  it("keeps package and release scripts from passing hydration or SQLite opt-ins", () => {
    const scripts = packageScripts();

    expect(scripts["runtime:memory:hydrate-shadow"]).toBe(
      "node openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs",
    );
    expect(scripts["runtime:memory:hydrate-shadow"]).not.toMatch(
      IMPLICIT_SQLITE_FLAGS,
    );

    for (const name of releaseScriptNames()) {
      const script = scripts[name];
      expect(script, `missing package script ${name}`).toEqual(expect.any(String));
      expect(script).not.toMatch(HYDRATION_COMMAND_OR_HELPER);
      expect(script).not.toMatch(HYDRATION_BUILD_FLAG);
      expect(script).not.toMatch(IMPLICIT_SQLITE_FLAGS);
    }
  });

  it("keeps release hooks and resource bundlers from invoking hydration", () => {
    const releaseBoundaryFiles = [
      "scripts/after-pack.cjs",
      "scripts/run-electron-builder.mjs",
      "scripts/bundle-openclaw-runtime.mjs",
    ];

    expect(readRepoFile("scripts/after-pack.cjs")).toContain(
      "'build', 'openclaw-runtime', 'node_modules'",
    );
    expect(readRepoFile("scripts/bundle-openclaw-runtime.mjs")).toContain(
      "build/openclaw-runtime/",
    );

    for (const file of releaseBoundaryFiles) {
      const source = readRepoFile(file);
      expect(source, file).not.toMatch(HYDRATION_COMMAND_OR_HELPER);
      expect(source, file).not.toMatch(HYDRATION_BUILD_FLAG);
      expect(source, file).not.toMatch(IMPLICIT_SQLITE_FLAGS);
    }
  });

  it("keeps packaged app and runtime entrypoints free of hydration imports", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      main?: unknown;
    };

    expect(packageJson.main).toBe("dist-electron/main/index.js");

    for (const file of packagedEntrypointSources()) {
      const source = readRepoFile(file);
      expect(source, file).not.toMatch(HYDRATION_COMMAND_OR_HELPER);
      expect(source, file).not.toMatch(HYDRATION_BUILD_FLAG);
    }
  });

  it("keeps the helper explicit, readonly, and without default database selection", () => {
    const commandSource = readRepoFile(
      "openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs",
    );
    const helperSource = readRepoFile(
      "openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts",
    );

    expect(commandSource).toContain("--persist --read-shadow --database <path>");
    expect(commandSource).toContain("All three are required before it can open SQLite");
    expect(commandSource).not.toMatch(/openclaw-agent\.sqlite|openclaw\.sqlite/iu);
    expect(helperSource).toContain("readOnly: true");
    expect(helperSource).not.toMatch(MUTATION_TERMS);
  });
});

function repoRoot(): string {
  return process.cwd();
}

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot(), relativePath), "utf8");
}

function packageScripts(): Record<string, string> {
  const packageJson = JSON.parse(readRepoFile("package.json")) as {
    scripts?: Record<string, string>;
  };
  return packageJson.scripts ?? {};
}

function releaseScriptNames(): string[] {
  return [
    "predev",
    "dev",
    "build",
    "build:runtime",
    "package",
    "package:mac",
    "package:mac:local",
    "package:win",
    "package:linux",
    "release",
  ];
}

function packagedEntrypointSources(): string[] {
  return [
    "electron/main/index.ts",
    "electron/preload/index.ts",
    "src/App.tsx",
    "openclaw_runtime/src/entry.ts",
  ];
}
