#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  pluginSdkEntrypoints,
  publicPluginSdkEntrypoints,
} from "./lib/plugin-sdk-entries.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRuntimeRoot = path.resolve(scriptDir, "..");
const defaultEmittedRoot = path.join(
  defaultRuntimeRoot,
  ".artifacts",
  "plugin-sdk-source-dts",
);

export function buildPluginSdkDtsRootFiles({ includePrivateQa }) {
  const entries = includePrivateQa ? pluginSdkEntrypoints : publicPluginSdkEntrypoints;
  return [...new Set(entries.map((entry) => `../src/plugin-sdk/${entry}.ts`))].sort();
}

export function resolveDeclarationCompiler({runtimeRoot,platform=process.platform,compiler=process.env.OPENCLAW_PLUGIN_SDK_DTS_COMPILER}={}){
  const selected=compiler??(platform==='win32'?'typescript':'tsgo');
  if(selected!=='typescript'&&selected!=='tsgo')throw new Error('Unknown plugin SDK declaration compiler');
  return selected==='typescript'?path.join(runtimeRoot,'node_modules','typescript','bin','tsc'):path.join(runtimeRoot,'scripts','run-tsgo.mjs');
}

function writeGeneratedTsconfig({ includePrivateQa, runtimeRoot }) {
  const configPath = path.join(runtimeRoot, ".artifacts", "plugin-sdk-source-dts.tsconfig.json");
  const files = buildPluginSdkDtsRootFiles({ includePrivateQa });
  const missing = files.filter(
    (relativePath) => !fs.existsSync(path.resolve(path.dirname(configPath), relativePath)),
  );
  if (missing.length > 0) {
    throw new Error(`Plugin SDK declaration roots are missing:\n${missing.join("\n")}`);
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        extends: "../tsconfig.plugin-sdk.dts.json",
        files,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return configPath;
}

function normalizeRelativePath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    path.posix.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`Declaration path is outside the declaration staging roots: ${relativePath}`);
  }
  return normalized.replace(/^\.\//u, "");
}

export function resolveStagedDeclarationPath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const runtimePrefix = "openclaw_runtime/";
  if (normalized.startsWith(runtimePrefix)) {
    return `dist/plugin-sdk/${normalized.slice(runtimePrefix.length)}`;
  }
  if (normalized.startsWith("shared/")) {
    return `dist/${normalized}`;
  }
  throw new Error(`Declaration path is outside the declaration staging roots: ${relativePath}`);
}

export function resolvePackageDeclarationPath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const prefix = "dist/plugin-sdk/";
  return normalized.startsWith(prefix)
    ? `packages/plugin-sdk/dist/${normalized.slice(prefix.length)}`
    : null;
}

function listFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const files = [];
  const pending = [rootDir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }
  return files.sort();
}

function resolvePathInsideRoot(rootDir, relativePath) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Declaration destination escaped the Runtime root: ${relativePath}`);
  }
  return resolvedPath;
}

export function stagePluginSdkDeclarations({ emittedRoot, runtimeRoot }) {
  const staged = [];
  for (const sourcePath of listFiles(emittedRoot)) {
    if (!sourcePath.endsWith(".d.ts") && !sourcePath.endsWith(".d.ts.map")) {
      continue;
    }
    const emittedRelativePath = path.relative(emittedRoot, sourcePath);
    const stagedRelativePath = resolveStagedDeclarationPath(emittedRelativePath);
    const destinationPath = resolvePathInsideRoot(runtimeRoot, stagedRelativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
    staged.push(stagedRelativePath.replaceAll("\\", "/"));
  }
  return staged.sort();
}

export function stagePluginSdkPackageDeclarations({ runtimeRoot }) {
  const sourceRoot = path.join(runtimeRoot, "dist", "plugin-sdk");
  const staged = [];
  for (const sourcePath of listFiles(sourceRoot)) {
    if (!sourcePath.endsWith(".d.ts") && !sourcePath.endsWith(".d.ts.map")) {
      continue;
    }
    const relativePath = path.relative(runtimeRoot, sourcePath);
    const stagedRelativePath = resolvePackageDeclarationPath(relativePath);
    if (!stagedRelativePath) {
      continue;
    }
    const destinationPath = resolvePathInsideRoot(runtimeRoot, stagedRelativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
    staged.push(stagedRelativePath.replaceAll("\\", "/"));
  }
  return staged.sort();
}

export function buildPluginSdkSourceDeclarations({
  emittedRoot = defaultEmittedRoot,
  runtimeRoot = defaultRuntimeRoot,
} = {}) {
  fs.rmSync(emittedRoot, { recursive: true, force: true });
  // Pre-create the shared output root before parallel declaration writers start.
  fs.mkdirSync(emittedRoot, { recursive: true });
  const configPath = writeGeneratedTsconfig({
    includePrivateQa: process.env.OPENCLAW_BUILD_PRIVATE_QA === "1",
    runtimeRoot,
  });

  const result = spawnSync(
    process.execPath,
    [
      resolveDeclarationCompiler({runtimeRoot}),
      "-p",
      configPath,
      "--declaration",
      "true",
    ],
    {
      cwd: runtimeRoot,
      env: process.env,
      stdio: "inherit",
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    return result.status ?? 1;
  }

  const staged = stagePluginSdkDeclarations({ emittedRoot, runtimeRoot });
  const packageStaged = stagePluginSdkPackageDeclarations({ runtimeRoot });
  process.stdout.write(`[plugin-sdk-source-dts] staged ${staged.length} declaration files\n`);
  process.stdout.write(
    `[plugin-sdk-source-dts] staged ${packageStaged.length} package declaration files\n`,
  );
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--stage-package-only")) {
    const staged = stagePluginSdkPackageDeclarations({ runtimeRoot: defaultRuntimeRoot });
    process.stdout.write(
      `[plugin-sdk-source-dts] staged ${staged.length} package declaration files\n`,
    );
  } else {
    process.exitCode = buildPluginSdkSourceDeclarations();
  }
}
