import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

const HYDRATION_COMMAND_OR_HELPER =
  /runtime:memory:hydrate-shadow|inspect-runtime-memory-hydration-shadow\.mjs|(?<![\\w-])memory-read-hydration-shadow(?![\\w-])|readRuntimeMemoryHydrationShadow|hydrateRuntimeMemoryShadowContext/iu;
const HYDRATION_BUILD_FLAG = /--memory-read-hydration-shadow-only/iu;
const IMPLICIT_SQLITE_FLAGS = /--persist|--read-shadow|--database\b|--db\b/iu;

describe("runtime memory read hydration shadow packaged artifact boundary", () => {
  it("keeps the package command direct while release/package scripts do not invoke it", () => {
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

  it("allows packaged openclaw-runtime artifacts without electron-builder hydration invocation", () => {
    const builderSource = readRepoFile("electron-builder.yml");
    const builderConfig = parseYaml(builderSource) as {
      afterPack?: unknown;
      extraResources?: Array<Record<string, unknown>>;
    };

    expect(builderConfig.afterPack).toBe("./scripts/after-pack.cjs");
    expect(builderConfig.extraResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "build/openclaw-runtime/",
          to: "openclaw-runtime/",
        }),
      ]),
    );
    expect(builderSource).not.toMatch(HYDRATION_COMMAND_OR_HELPER);
    expect(builderSource).not.toMatch(HYDRATION_BUILD_FLAG);
    expect(builderSource).not.toMatch(IMPLICIT_SQLITE_FLAGS);
  });

  it("keeps release-boundary scripts from executing the hydration helper", () => {
    const releaseBoundaryFiles = [
      "scripts/after-pack.cjs",
      "scripts/run-electron-builder.mjs",
      "scripts/bundle-openclaw-runtime.mjs",
    ];

    expect(readRepoFile("scripts/after-pack.cjs")).toContain(
      "'build', 'openclaw-runtime', 'node_modules'",
    );
    expect(readRepoFile("scripts/bundle-openclaw-runtime.mjs")).toContain(
      "Copying runtime source files",
    );

    for (const file of releaseBoundaryFiles) {
      const source = readRepoFile(file);
      expect(source, file).not.toMatch(HYDRATION_COMMAND_OR_HELPER);
      expect(source, file).not.toMatch(HYDRATION_BUILD_FLAG);
      expect(source, file).not.toMatch(IMPLICIT_SQLITE_FLAGS);
    }
  });

  it("keeps the default runtime build entry set separate from the explicit helper build", () => {
    const buildScript = readRepoFile("scripts/build-openclaw-runtime.mjs");
    const defaultEntryPointSection = sectionBetween(
      buildScript,
      "const runtimeEntryPoints = {",
      "const memoryReadHydrationShadowEntry",
    );

    expect(defaultEntryPointSection).not.toContain(
      "memory-read-hydration-shadow",
    );
    expect(buildScript).toContain("--memory-read-hydration-shadow-only");
    expect(buildScript).toContain("memory-read-hydration-shadow.ts");
    expect(buildScript).not.toContain(
      "inspect-runtime-memory-hydration-shadow.mjs",
    );
    expect(buildScript).not.toMatch(IMPLICIT_SQLITE_FLAGS);
  });

  it("keeps product runtime paths free of hydration imports and cutover hooks", () => {
    const matches = scanProductRuntimeForHydrationTerms();

    expect(matches).toEqual([]);
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

function sectionBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  expect(startIndex, `missing section start ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing section end ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function scanProductRuntimeForHydrationTerms(): string[] {
  const targets = [
    "electron",
    "shared",
    "src/lib",
    "src/pages",
    "src/components",
    "openclaw_runtime/src/gateway",
    "openclaw_runtime/src/agents/task-loop-controller.ts",
    "openclaw_runtime/src/context-engine/provider-registry.ts",
  ];
  const matches: string[] = [];

  for (const target of targets) {
    const absoluteTarget = path.join(repoRoot(), target);
    for (const file of listSourceFiles(absoluteTarget)) {
      const source = readFileSync(file, "utf8");
      if (
        HYDRATION_COMMAND_OR_HELPER.test(source) ||
        HYDRATION_BUILD_FLAG.test(source)
      ) {
        matches.push(path.relative(repoRoot(), file).replace(/\\/g, "/"));
      }
    }
  }

  return matches.sort();
}

function listSourceFiles(target: string): string[] {
  if (statSync(target).isFile()) {
    return shouldScanSourceFile(target) ? [target] : [];
  }

  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const current = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") {
          continue;
        }
        visit(current);
      } else if (entry.isFile() && shouldScanSourceFile(current)) {
        files.push(current);
      }
    }
  };
  visit(target);
  return files;
}

function shouldScanSourceFile(file: string): boolean {
  return /\.(?:cjs|mjs|js|jsx|ts|tsx|json)$/u.test(file);
}
