import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HYDRATION_COMMAND_OR_HELPER =
  /runtime:memory:hydrate-shadow|inspect-runtime-memory-hydration-shadow\.mjs|memory-read-hydration-shadow|readRuntimeMemoryHydrationShadow|hydrateRuntimeMemoryShadowContext/iu;
const HYDRATION_BUILD_FLAG = /--memory-read-hydration-shadow-only/iu;
const IMPLICIT_SQLITE_FLAGS = /--persist|--read-shadow|--database\b|--db\b/iu;
const MUTATION_CALL_TERMS =
  /migrate\(|appendEpisode\(|appendFact\(|invalidateFact\(|ensureRuntimeMemoryPersistenceSchema\(|withWriteTransaction\(|trimRows\(|insertInto\(|updateTable\(|deleteFrom\(/iu;
const RAW_OR_AUTHORITY_LEAK_TERMS =
  /raw chat|raw transcript|record_json|traceparent|tracestate|baggage|tool args|tool output|process\.env|secret/iu;
const SERVICE_OR_LISTENER_TERMS =
  /createServer|listen\(|WebSocketServer|OTLP|Temporal|daemon|database-service|exporter|listener/iu;

describe("runtime memory read hydration shadow packaged output inspection proof", () => {
  it("allows packaged output helper artifacts only as inert resource files", () => {
    const fixture = createPackagedOutputFixture();
    try {
      const hydrationMatches = scanFiles(fixture.root, HYDRATION_COMMAND_OR_HELPER)
        .map((match) => match.relativePath)
        .sort();

      expect(hydrationMatches).toEqual([
        "resources/openclaw-runtime/dist/runtime-core/memory-read-hydration-shadow.js",
        "resources/openclaw-runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs",
        "resources/openclaw-runtime/src/runtime-core/memory-read-hydration-shadow.ts",
      ]);

      for (const entrypoint of fixture.entrypoints) {
        const source = readFileSync(entrypoint.absolutePath, "utf8");
        expect(source, entrypoint.relativePath).not.toMatch(
          HYDRATION_COMMAND_OR_HELPER,
        );
        expect(source, entrypoint.relativePath).not.toMatch(HYDRATION_BUILD_FLAG);
        expect(source, entrypoint.relativePath).not.toMatch(IMPLICIT_SQLITE_FLAGS);
        expect(source, entrypoint.relativePath).not.toMatch(
          SERVICE_OR_LISTENER_TERMS,
        );
      }
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("keeps package, build, and release scripts from implicit packaged-output hydration", () => {
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
      expect(script).not.toMatch(SERVICE_OR_LISTENER_TERMS);
    }
  });

  it("keeps packaged release hooks and runtime bundlers as copy-only boundaries", () => {
    const releaseBoundaryFiles = [
      "electron-builder.yml",
      "scripts/after-pack.cjs",
      "scripts/run-electron-builder.mjs",
      "scripts/bundle-openclaw-runtime.mjs",
    ];

    expect(readRepoFile("electron-builder.yml")).toContain(
      "from: build/openclaw-runtime/",
    );
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

  it("keeps packaged app and runtime entrypoints free of hydration invocation", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      main?: unknown;
    };

    expect(packageJson.main).toBe("dist-electron/main/index.js");

    for (const file of packagedEntrypointSources()) {
      const source = readRepoFile(file);
      expect(source, file).not.toMatch(HYDRATION_COMMAND_OR_HELPER);
      expect(source, file).not.toMatch(HYDRATION_BUILD_FLAG);
      expect(source, file).not.toMatch(IMPLICIT_SQLITE_FLAGS);
    }
  });

  it("keeps product runtime boundaries free of hydration imports or cutover hooks", () => {
    expect(scanProductRuntimeForHydrationTerms()).toEqual([]);
  });

  it("keeps the helper and command readonly, no-default-db, and sanitized-only", () => {
    const commandSource = readRepoFile(
      "openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs",
    );
    const helperSource = readRepoFile(
      "openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts",
    );

    expect(commandSource).toContain("--persist --read-shadow --database <path>");
    expect(commandSource).toContain("All three are required before it can open SQLite");
    expect(commandSource).toContain("do not open, create, migrate, or write");
    expect(commandSource).not.toMatch(/openclaw-agent\.sqlite|openclaw\.sqlite/iu);
    expect(commandSource).not.toMatch(MUTATION_CALL_TERMS);

    expect(helperSource).toContain("readOnly: true");
    expect(helperSource).toContain("AUTHORITY_BOUNDARY");
    expect(helperSource).toContain("noPromptInjection: true");
    expect(helperSource).toContain("noRuntimeAuthority: true");
    expect(helperSource).toContain("noDurableFactAuthority: true");
    expect(helperSource).not.toMatch(MUTATION_CALL_TERMS);
    expect(helperSource).not.toMatch(RAW_OR_AUTHORITY_LEAK_TERMS);
  });
});

type FixtureEntrypoint = {
  absolutePath: string;
  relativePath: string;
};

type PackagedOutputFixture = {
  root: string;
  entrypoints: FixtureEntrypoint[];
};

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

function createPackagedOutputFixture(): PackagedOutputFixture {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "runtime-memory-packaged-output-"),
  );
  const files: Record<string, string> = {
    "resources/openclaw-runtime/src/runtime-core/memory-read-hydration-shadow.ts":
      readRepoFile("openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts"),
    "resources/openclaw-runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs":
      readRepoFile(
        "openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs",
      ),
    "resources/openclaw-runtime/dist/runtime-core/memory-read-hydration-shadow.js":
      [
        "export const readRuntimeMemoryHydrationShadow = () => ({",
        "  status: 'skipped',",
        "  authority: { diagnosticsOnly: true, readonly: true },",
        "});",
      ].join("\n"),
    "resources/app.asar/dist-electron/main/index.js":
      "import './chunk-app-start.js';\nstartVerseClawMain();\n",
    "resources/app.asar/dist-electron/preload/index.js":
      "globalThis.verseClawPreloadReady = true;\n",
    "resources/app.asar/dist/index.js":
      "import './assets/App.js';\n",
    "resources/openclaw-runtime/src/entry.ts":
      "import { startGateway } from './gateway/server-methods';\nstartGateway();\n",
    "resources/openclaw-runtime/dist/entry.js":
      "import './chunk-runtime-entry.js';\n",
  };

  for (const [relativePath, source] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, source, "utf8");
  }

  const entrypoints = [
    "resources/app.asar/dist-electron/main/index.js",
    "resources/app.asar/dist-electron/preload/index.js",
    "resources/app.asar/dist/index.js",
    "resources/openclaw-runtime/src/entry.ts",
    "resources/openclaw-runtime/dist/entry.js",
  ].map((relativePath) => ({
    relativePath,
    absolutePath: path.join(root, relativePath),
  }));

  return { root, entrypoints };
}

function scanProductRuntimeForHydrationTerms(): string[] {
  const targets = [
    "electron/main",
    "electron/preload",
    "electron/services",
    "shared",
    "src/lib",
    "src/pages",
    "src/components",
    "openclaw_runtime/src/gateway",
    "openclaw_runtime/src/agents",
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

function scanFiles(
  target: string,
  pattern: RegExp,
): Array<{ relativePath: string }> {
  return listSourceFiles(target, { skipDist: false })
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => ({
      relativePath: path.relative(target, file).replace(/\\/g, "/"),
    }));
}

function listSourceFiles(
  target: string,
  options: { skipDist: boolean } = { skipDist: true },
): string[] {
  if (statSync(target).isFile()) {
    return shouldScanSourceFile(target) ? [target] : [];
  }

  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const current = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          (options.skipDist && entry.name === "dist")
        ) {
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
  return /\.(?:cjs|mjs|js|jsx|ts|tsx|json|yml|yaml)$/u.test(file);
}
