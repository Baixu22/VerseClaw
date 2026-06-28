import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

describe("runtime memory read hydration shadow build proof", () => {
  it("builds only the explicit hydration shadow helper output", () => {
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

    const distRoot = path.join(repoRoot(), "openclaw_runtime", "dist");
    const helperOutput = path.join(
      distRoot,
      "runtime-core",
      "memory-read-hydration-shadow.js",
    );
    expect(existsSync(helperOutput)).toBe(true);

    const outputFiles = listDistFiles(distRoot);
    expect(outputFiles).toEqual([
      "runtime-core/memory-read-hydration-shadow.js",
    ]);

    const buildOutput = readFileSync(helperOutput, "utf8");
    expect(buildOutput).toContain("hydrateRuntimeMemoryShadowContext");
    expect(buildOutput).toContain("readRuntimeMemoryHydrationShadow");
    expect(buildOutput).toContain("readOnly: true");
    expect(buildOutput).not.toMatch(
      /appendEpisode|appendFact|invalidateFact|withWriteTransaction|insertInto|updateTable|deleteFrom|trimRows/iu,
    );
  }, 120_000);

  it("keeps the build flag out of default package lifecycle scripts", () => {
    const scripts = packageScripts();
    for (const name of ["predev", "dev", "build", "package", "release"]) {
      const script = scripts[name];
      expect(script, `missing package script ${name}`).toEqual(expect.any(String));
      expect(script).not.toContain("--memory-read-hydration-shadow-only");
      expect(script).not.toContain("memory-read-hydration-shadow");
      expect(script).not.toContain("readRuntimeMemoryHydrationShadow");
      expect(script).not.toContain("hydrateRuntimeMemoryShadowContext");
      expect(script).not.toMatch(/--database|--read-shadow|--persist/iu);
    }
  });

  it("keeps the build script as build-only and free of implicit database flags", () => {
    const buildScript = readFileSync(
      path.join(repoRoot(), "scripts", "build-openclaw-runtime.mjs"),
      "utf8",
    );

    expect(buildScript).toContain("--memory-read-hydration-shadow-only");
    expect(buildScript).toContain("memory-read-hydration-shadow.ts");
    expect(buildScript).not.toContain("readRuntimeMemoryHydrationShadow(");
    expect(buildScript).not.toContain("hydrateRuntimeMemoryShadowContext(");
    expect(buildScript).not.toMatch(
      /--database|--read-shadow|--persist|createServer|listen\(|WebSocketServer|daemon/iu,
    );
  });
});

function repoRoot(): string {
  return process.cwd();
}

function listDistFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const current = path.join(dir, name);
      if (statSync(current).isDirectory()) {
        visit(current);
      } else {
        files.push(path.relative(root, current).replace(/\\/g, "/"));
      }
    }
  };
  visit(root);
  return files.sort();
}

function packageScripts(): Record<string, string> {
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot(), "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  return packageJson.scripts ?? {};
}
