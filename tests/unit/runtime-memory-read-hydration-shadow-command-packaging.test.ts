import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("runtime memory read hydration shadow command packaging proof", () => {
  it("keeps the package command as a direct diagnostic pass-through", () => {
    const script = packageScript("runtime:memory:hydrate-shadow");

    expect(script).toBe(
      "node openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs",
    );
    expect(script).not.toMatch(
      /--persist|--read-shadow|--database|--db|gateway|server|listener|daemon|createServer|listen\(/iu,
    );
  });

  it("keeps lifecycle scripts from invoking hydration or implicit flags", () => {
    const scripts = packageScripts();
    for (const name of ["predev", "dev", "build", "package", "release"]) {
      const script = scripts[name];
      expect(script, `missing package script ${name}`).toEqual(expect.any(String));
      expect(script).not.toContain("runtime:memory:hydrate-shadow");
      expect(script).not.toContain("inspect-runtime-memory-hydration-shadow.mjs");
      expect(script).not.toContain("memory-read-hydration-shadow");
      expect(script).not.toContain("readRuntimeMemoryHydrationShadow");
      expect(script).not.toContain("hydrateRuntimeMemoryShadowContext");
      expect(script).not.toContain("--memory-read-hydration-shadow-only");
      expect(script).not.toMatch(
        /--persist|--read-shadow|--database|--db|createServer|listen\(|WebSocketServer|daemon/iu,
      );
    }
  });

  it("keeps the build script from executing hydration or selecting sqlite", () => {
    const buildScript = readRepoFile("scripts/build-openclaw-runtime.mjs");

    expect(buildScript).toContain("--memory-read-hydration-shadow-only");
    expect(buildScript).toContain("memory-read-hydration-shadow.ts");
    expect(buildScript).not.toContain("inspect-runtime-memory-hydration-shadow.mjs");
    expect(buildScript).not.toContain("runtime:memory:hydrate-shadow");
    expect(buildScript).not.toContain("readRuntimeMemoryHydrationShadow(");
    expect(buildScript).not.toContain("hydrateRuntimeMemoryShadowContext(");
    expect(buildScript).not.toMatch(
      /--persist|--read-shadow|--database|--db|openclaw\.sqlite|createServer|listen\(|WebSocketServer|daemon/iu,
    );
  });

  it("keeps the command script free of default database and write behavior", () => {
    const commandScript = readRepoFile(
      "openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs",
    );

    expect(commandScript).toContain("inspect-runtime-memory-hydration-shadow.mjs");
    expect(commandScript).toContain("--persist");
    expect(commandScript).toContain("--read-shadow");
    expect(commandScript).toContain("--database <path>");
    expect(commandScript).toContain("readRuntimeMemoryHydrationShadow");
    expect(commandScript).not.toContain("DatabaseSync");
    expect(commandScript).not.toContain("createRuntimeMemoryPersistenceStore");
    expect(commandScript).not.toContain("openclaw.sqlite");
    expect(commandScript).not.toContain("state/openclaw");
    expect(commandScript).not.toContain("agents/");
    expect(commandScript).not.toMatch(
      /appendEpisode\(|appendFact\(|invalidateFact\(|ensureRuntimeMemoryPersistenceSchema\(|withWriteTransaction\(|trimRows\(|insertInto\(|updateTable\(|deleteFrom\(|migrate\(/u,
    );
  });

  it("keeps the helper readonly and free of mutation calls", () => {
    const helperSource = readRepoFile(
      "openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts",
    );

    expect(helperSource).toContain("readOnly: true");
    expect(helperSource).toContain("readRuntimeMemoryHydrationShadow");
    expect(helperSource).toContain("hydrateRuntimeMemoryShadowContext");
    expect(helperSource).not.toMatch(
      /appendEpisode\(|appendFact\(|invalidateFact\(|ensureRuntimeMemoryPersistenceSchema\(|withWriteTransaction\(|trimRows\(|insertInto\(|updateTable\(|deleteFrom\(|migrate\(/u,
    );
  });
});

function repoRoot(): string {
  return process.cwd();
}

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot(), relativePath), "utf8");
}

function packageScript(name: string): string {
  const script = packageScripts()[name];
  if (!script) {
    throw new Error(`Missing package script: ${name}`);
  }
  return script;
}

function packageScripts(): Record<string, string> {
  const packageJson = JSON.parse(readRepoFile("package.json")) as {
    scripts?: Record<string, string>;
  };
  return packageJson.scripts ?? {};
}
