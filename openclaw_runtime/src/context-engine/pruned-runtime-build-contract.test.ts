import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const runtimeRoot = fileURLToPath(new URL("../..", import.meta.url));
const generatedPaths = [
  path.join(runtimeRoot, "dist", "cli-startup-metadata.json"),
  path.join(runtimeRoot, "dist", "cli", "daemon-cli.js"),
  path.join(runtimeRoot, "extensions", "diffs", "assets", "viewer-runtime.js"),
];
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-pruned-build-"));
  tempRoots.push(root);
  return root;
}

function runTypeScriptScript(scriptName: string) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(runtimeRoot, "scripts", scriptName)],
    {
      cwd: runtimeRoot,
      encoding: "utf8",
    },
  );
}

function loadTsdownEntryMaps(): Record<string, string>[] {
  const configUrl = pathToFileURL(path.join(runtimeRoot, "tsdown.config.ts")).href;
  const source = [
    `const imported = await import(${JSON.stringify(configUrl)});`,
    "const configs = Array.isArray(imported.default) ? imported.default : [imported.default];",
    "console.log(JSON.stringify(configs.map((config) => config.entry ?? {})));",
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", source],
    { cwd: runtimeRoot, encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, string>[];
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
  for (const generatedPath of generatedPaths) {
    fs.rmSync(generatedPath, { force: true });
  }
});

describe("pruned runtime build contract", () => {
  it("keeps retained Feishu setup on the Gateway wizard contract without a pruned CLI prompter", () => {
    const apiSource = fs.readFileSync(
      path.join(runtimeRoot, "extensions", "feishu", "api.ts"),
      "utf8",
    );
    const channelSource = fs.readFileSync(
      path.join(runtimeRoot, "extensions", "feishu", "src", "channel.ts"),
      "utf8",
    );

    expect(apiSource).toContain('export { feishuSetupWizard, runFeishuLogin } from "./src/setup-surface.js";');
    expect(channelSource).toContain("setupWizard: feishuSetupWizard");
    expect(apiSource).not.toContain("createClackPrompter");
    expect(channelSource).not.toContain("createClackPrompter");
  });

  it("declares only source entries that exist in the pruned runtime", () => {
    const missingEntries = loadTsdownEntryMaps().flatMap((entries) =>
      Object.entries(entries)
        .filter(([, sourcePath]) => {
          const resolvedPath = path.isAbsolute(sourcePath)
            ? sourcePath
            : path.join(runtimeRoot, sourcePath);
          return !fs.existsSync(resolvedPath);
        })
        .map(([entryName, sourcePath]) => `${entryName} -> ${sourcePath}`),
    );

    expect(missingEntries).toEqual([]);
  });

  it("resolves retained diffs dependencies from the pnpm workspace layout", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(runtimeRoot, "scripts", "build-diffs-viewer-runtime.mjs"), "curated"],
      { cwd: runtimeRoot, encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it("checks the retained gateway entry without requiring a removed CLI entry or chunk", () => {
    const rootDir = makeTempRoot();
    const distDir = path.join(rootDir, "dist");
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, "entry.js"), "export const retained = true;\n");
    const moduleUrl = pathToFileURL(
      path.join(runtimeRoot, "scripts", "check-cli-bootstrap-imports.mjs"),
    ).href;
    const source = [
      `import { collectCliBootstrapExternalImportErrors, collectGatewayRunChunkBudgetErrors } from ${JSON.stringify(moduleUrl)};`,
      `const rootDir = ${JSON.stringify(rootDir)};`,
      "console.log(JSON.stringify([",
      "  collectCliBootstrapExternalImportErrors({ rootDir }),",
      "  collectGatewayRunChunkBudgetErrors({ rootDir }),",
      "]));",
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
      cwd: runtimeRoot,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([[], []]);
  });

  it("skips startup metadata and removes stale output when the CLI owner is pruned", () => {
    const outputPath = generatedPaths[0];
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, '{"stale":true}\n');

    const result = runTypeScriptScript("write-cli-startup-metadata.ts");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("CLI startup sources are unavailable");
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it("skips the legacy CLI shim and removes stale output when its owner is pruned", () => {
    const outputPath = generatedPaths[1];
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, "export const stale = true;\n");

    const result = runTypeScriptScript("write-cli-compat.ts");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("legacy daemon CLI sources are unavailable");
    expect(fs.existsSync(outputPath)).toBe(false);
  });
});
