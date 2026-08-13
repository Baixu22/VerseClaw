// Unit-fast test discovery and classification helpers for fast local routing.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  commandsLightSourceFiles,
  commandsLightTestFiles,
} from "./vitest.commands-light-paths.mjs";
import { pluginSdkLightSourceFiles, pluginSdkLightTestFiles } from "./vitest.plugin-sdk-paths.mjs";
import { boundaryTestFiles } from "./vitest.unit-paths.mjs";

const normalizeRepoPath = (value) => value.replaceAll("\\", "/");

const unitFastCandidateGlobs = [
  "packages/memory-host-sdk/**/*.test.ts",
  "packages/plugin-package-contract/**/*.test.ts",
  "src/acp/**/*.test.ts",
  "src/agents/**/*.test.ts",
  "src/skills/**/*.test.ts",
  "src/auto-reply/**/*.test.ts",
  "src/bootstrap/**/*.test.ts",
  "src/channels/**/*.test.ts",
  "src/cli/**/*.test.ts",
  "src/commands/**/*.test.ts",
  "src/compat/**/*.test.ts",
  "src/config/**/*.test.ts",
  "src/daemon/**/*.test.ts",
  "src/i18n/**/*.test.ts",
  "src/hooks/**/*.test.ts",
  "src/image-generation/**/*.test.ts",
  "src/infra/**/*.test.ts",
  "src/interactive/**/*.test.ts",
  "src/link-understanding/**/*.test.ts",
  "src/logging/**/*.test.ts",
  "packages/markdown-core/src/**/*.test.ts",
  "packages/media-core/src/**/*.test.ts",
  "packages/terminal-core/src/**/*.test.ts",
  "src/media/**/*.test.ts",
  "src/media-generation/**/*.test.ts",
  "src/media-understanding/**/*.test.ts",
  "src/memory-host-sdk/**/*.test.ts",
  "src/model-catalog/**/*.test.ts",
  "src/music-generation/**/*.test.ts",
  "src/node-host/**/*.test.ts",
  "src/plugin-sdk/**/*.test.ts",
  "src/plugins/**/*.test.ts",  "src/process/**/*.test.ts",
  "src/proxy-capture/**/*.test.ts",
  "src/routing/**/*.test.ts",
  "src/sessions/**/*.test.ts",
  "src/shared/**/*.test.ts",
  "src/test-utils/**/*.test.ts",
  "src/tasks/**/*.test.ts",
  "src/tts/**/*.test.ts",
  "src/utils/**/*.test.ts",
  "src/video-generation/**/*.test.ts",
  "src/web/**/*.test.ts",
  "src/wizard/**/*.test.ts",
  "test/**/*.test.ts",
];
export const forcedUnitFastTestFiles = [];
const forcedUnitFastTestFileSet = new Set(forcedUnitFastTestFiles);
const unitFastCandidateExactFiles = [...pluginSdkLightTestFiles, ...commandsLightTestFiles];
const unitFastCandidateExactFileSet = new Set(unitFastCandidateExactFiles);
const unitFastSourceExactFileSet = new Set([
  ...pluginSdkLightSourceFiles,
  ...commandsLightSourceFiles,
]);
const broadUnitFastCandidateGlobs = [
  "src/**/*.test.ts",
  "packages/**/*.test.ts",
  "test/**/*.test.ts",
];
const broadUnitFastCandidateSkipGlobs = [
  "**/*.e2e.test.ts",
  "**/*.live.test.ts",
  "test/fixtures/**/*.test.ts",  "src/channels/plugins/contracts/**/*.test.ts",
  "src/config/**/*.test.ts",
  "src/gateway/**/*.test.ts",
  "src/media-generation/**/*.contract.test.ts",  "src/plugins/contracts/**/*.test.ts",  "src/security/**/*.test.ts",
  "src/secrets/**/*.test.ts",  "test/vitest-extensions-config.test.ts",
  "test/vitest-unit-paths.test.ts",
  ...boundaryTestFiles,
];

const disqualifyingPatterns = [
  {
    code: "jsdom-environment",
    pattern: /@vitest-environment\s+jsdom/u,
  },
  {
    code: "module-mocking",
    pattern: /\bvi\.(?:mock|doMock|unmock|doUnmock|importActual|resetModules)\s*\(/u,
  },
  {
    code: "module-mocking-helper",
    pattern: /(?:runtime-module-mocks|plugins-cli-test-helpers|manager\.test-helpers)/u,
  },
  {
    code: "vitest-mock-api",
    pattern: /\bvi\b/u,
  },
  {
    code: "dynamic-import",
    pattern: /\b(?:await\s+)?import\s*\(/u,
  },
  {
    code: "fake-timers",
    pattern:
      /\bvi\.(?:useFakeTimers|setSystemTime|advanceTimers|runAllTimers|runOnlyPendingTimers)\s*\(/u,
  },
  {
    code: "env-or-global-stub",
    pattern: /\bvi\.(?:stubEnv|stubGlobal|unstubAllEnvs|unstubAllGlobals)\s*\(/u,
  },
  {
    code: "process-env-mutation",
    pattern: /(?:process\.env(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])?\s*=|delete\s+process\.env)/u,
  },
  {
    code: "global-mutation",
    pattern: /(?:globalThis|global)\s*\[[^\]]+\]\s*=/u,
  },
  {
    code: "filesystem-state",
    pattern:
      /\b(?:mkdtemp|rmSync|writeFileSync|appendFileSync|mkdirSync|createTemp|makeTempDir|tempDir|tmpdir|node:fs|node:os)\b/u,
  },
  {
    code: "runtime-singleton-state",
    pattern: /\b(?:setActivePluginRegistry|resetPluginRuntimeStateForTest|reset.*ForTest)\s*\(/u,
  },
];

function matchesAnyGlob(file, patterns) {
  return patterns.some((pattern) => path.matchesGlob(file, pattern));
}

function isUnitFastCandidateFile(file) {
  return (
    forcedUnitFastTestFileSet.has(file) ||
    unitFastCandidateExactFileSet.has(file) ||
    (matchesAnyGlob(file, unitFastCandidateGlobs) &&
      !matchesAnyGlob(file, broadUnitFastCandidateSkipGlobs))
  );
}

function walkFiles(directory, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "vendor") {
        continue;
      }
      walkFiles(entryPath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(normalizeRepoPath(entryPath));
    }
  }
  return files;
}

const walkedTestFilesByCwd = new Map();

function collectRepoTestFilesFromGit(cwd) {
  const result = spawnSync("git", ["ls-files", "--", "src", "packages", "test"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout
    .split("\n")
    .map((file) => normalizeRepoPath(file.trim()))
    .filter((file) => file.endsWith(".test.ts"));
}

function collectRepoTestFiles(cwd) {
  const normalizedCwd = normalizeRepoPath(cwd);
  const cached = walkedTestFilesByCwd.get(normalizedCwd);
  if (cached) {
    return cached;
  }
  const files =
    collectRepoTestFilesFromGit(cwd) ??
    ["src", "packages", "test"]
      .flatMap((directory) => walkFiles(path.join(cwd, directory)))
      .map((file) => normalizeRepoPath(path.relative(cwd, file)));
  walkedTestFilesByCwd.set(normalizedCwd, files);
  return files;
}

export function classifyUnitFastTestFileContent(source) {
  const reasons = [];
  for (const { code, pattern } of disqualifyingPatterns) {
    if (pattern.test(source)) {
      reasons.push(code);
    }
  }
  return reasons;
}

export function collectUnitFastTestCandidates(cwd = process.cwd()) {
  const discovered = collectRepoTestFiles(cwd).filter(
    (file) =>
      matchesAnyGlob(file, unitFastCandidateGlobs) &&
      !matchesAnyGlob(file, broadUnitFastCandidateSkipGlobs),
  );
  return [
    ...new Set([...discovered, ...unitFastCandidateExactFiles, ...forcedUnitFastTestFiles]),
  ].toSorted((a, b) => a.localeCompare(b));
}

export function collectBroadUnitFastTestCandidates(cwd = process.cwd()) {
  const discovered = collectRepoTestFiles(cwd).filter(
    (file) =>
      matchesAnyGlob(file, broadUnitFastCandidateGlobs) &&
      !matchesAnyGlob(file, broadUnitFastCandidateSkipGlobs),
  );
  return [
    ...new Set([...discovered, ...unitFastCandidateExactFiles, ...forcedUnitFastTestFiles]),
  ].toSorted((a, b) => a.localeCompare(b));
}

const unitFastAnalysisByKey = new Map();

export function collectUnitFastTestFileAnalysis(cwd = process.cwd(), options = {}) {
  const cacheKey = `${normalizeRepoPath(cwd)}\0${options.scope ?? "default"}`;
  const cached = unitFastAnalysisByKey.get(cacheKey);
  if (cached) {
    return cached;
  }
  const candidates =
    options.scope === "broad"
      ? collectBroadUnitFastTestCandidates(cwd)
      : collectUnitFastTestCandidates(cwd);
  const analysis = candidates.map((file) => {
    const absolutePath = path.join(cwd, file);
    let source;
    try {
      source = fs.readFileSync(absolutePath, "utf8");
    } catch {
      return {
        file,
        unitFast: false,
        reasons: ["missing-file"],
      };
    }
    const reasons = classifyUnitFastTestFileContent(source);
    const forced = forcedUnitFastTestFileSet.has(file);
    return {
      file,
      unitFast: forced || reasons.length === 0,
      forced,
      reasons,
    };
  });
  unitFastAnalysisByKey.set(cacheKey, analysis);
  return analysis;
}

let cachedUnitFastTestFiles = null;
let cachedUnitFastTestFileSet = null;
let cachedUnitFastTimerTestFiles = null;
let cachedUnitFastTimerTestFileSet = null;
const cachedSingleUnitFastTestFileResults = new Map();

export function getUnitFastTestFiles() {
  if (cachedUnitFastTestFiles !== null) {
    return cachedUnitFastTestFiles;
  }
  cachedUnitFastTestFiles = collectUnitFastTestFileAnalysis()
    .filter((entry) => entry.unitFast)
    .map((entry) => entry.file);
  return cachedUnitFastTestFiles;
}

export function getUnitFastTimerTestFiles() {
  if (cachedUnitFastTimerTestFiles !== null) {
    return cachedUnitFastTimerTestFiles;
  }
  cachedUnitFastTimerTestFiles = collectUnitFastTestFileAnalysis()
    .filter((entry) => entry.unitFast && entry.reasons.includes("fake-timers"))
    .map((entry) => entry.file);
  return cachedUnitFastTimerTestFiles;
}

function getUnitFastTestFileSet() {
  if (cachedUnitFastTestFileSet !== null) {
    return cachedUnitFastTestFileSet;
  }
  cachedUnitFastTestFileSet = new Set(getUnitFastTestFiles());
  return cachedUnitFastTestFileSet;
}

function getUnitFastTimerTestFileSet() {
  if (cachedUnitFastTimerTestFileSet !== null) {
    return cachedUnitFastTimerTestFileSet;
  }
  cachedUnitFastTimerTestFileSet = new Set(getUnitFastTimerTestFiles());
  return cachedUnitFastTimerTestFileSet;
}

function isUnitFastTestFileOnDemand(file, cwd = process.cwd()) {
  const normalized = normalizeRepoPath(file);
  const cacheKey = `${normalizeRepoPath(cwd)}\0${normalized}`;
  if (cachedSingleUnitFastTestFileResults.has(cacheKey)) {
    return cachedSingleUnitFastTestFileResults.get(cacheKey);
  }

  if (!isUnitFastCandidateFile(normalized)) {
    cachedSingleUnitFastTestFileResults.set(cacheKey, false);
    return false;
  }

  let source;
  try {
    source = fs.readFileSync(path.join(cwd, normalized), "utf8");
  } catch {
    cachedSingleUnitFastTestFileResults.set(cacheKey, false);
    return false;
  }

  const result =
    forcedUnitFastTestFileSet.has(normalized) ||
    classifyUnitFastTestFileContent(source).length === 0;
  cachedSingleUnitFastTestFileResults.set(cacheKey, result);
  return result;
}

export function isUnitFastTestFile(file) {
  return getUnitFastTestFileSet().has(normalizeRepoPath(file));
}

export function isUnitFastTimerTestFile(file) {
  return getUnitFastTimerTestFileSet().has(normalizeRepoPath(file));
}

export function resolveUnitFastTestIncludePattern(file) {
  const normalized = normalizeRepoPath(file);
  if (isUnitFastTimerTestFile(normalized)) {
    return null;
  }
  if (isUnitFastTestFileOnDemand(normalized)) {
    return normalized;
  }
  const siblingTestFile = normalized.replace(/\.ts$/u, ".test.ts");
  if (isUnitFastTimerTestFile(siblingTestFile)) {
    return null;
  }
  if (isUnitFastTestFileOnDemand(siblingTestFile)) {
    return siblingTestFile;
  }
  if (unitFastSourceExactFileSet.has(normalized)) {
    const exactTestFile = normalized.replace(/\.ts$/u, ".test.ts");
    return isUnitFastTestFileOnDemand(exactTestFile) ? exactTestFile : null;
  }
  return null;
}

export function resolveUnitFastTimerTestIncludePattern(file) {
  const normalized = normalizeRepoPath(file);
  if (isUnitFastTimerTestFile(normalized)) {
    return normalized;
  }
  const siblingTestFile = normalized.replace(/\.ts$/u, ".test.ts");
  return isUnitFastTimerTestFile(siblingTestFile) ? siblingTestFile : null;
}
