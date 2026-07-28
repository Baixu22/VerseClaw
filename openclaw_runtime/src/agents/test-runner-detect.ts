/**
 * Project test-runner detection for the coding verify segment.
 *
 * Detection is side-effect free. Execution belongs to the canonical exec tool
 * so approvals, sandboxing, tool policy, and timeout behavior stay single-owned.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Why no bounded test command could be produced. */
export type TestRunnerSkipReason =
  | "no-workspace"
  | "no-manifest"
  | "no-test-script"
  | "placeholder-test-script"
  | "unsupported-ecosystem"
  | "outside-workspace"
  | "cross-project-changes";

export type TestRunnerDetection =
  | {
      detected: true;
      /** Ecosystem id, e.g. `node`, `python`, `rust`, `go`, or `custom`. */
      ecosystem: string;
      /** Package manager / driver, e.g. `pnpm`, `npm`, `pytest`, `cargo`. */
      runner: string;
      /** Shell command that must be run through the exec tool. */
      command: string;
      /** File or config leaf that proves the runner exists. */
      evidence: string;
      /** Working directory relative to the workspace root. */
      workdir: string;
    }
  | {
      detected: false;
      skipReason: TestRunnerSkipReason;
      /** Human-readable reason surfaced to the model and the user. */
      message: string;
    };

export type TestRunnerDetectionOptions = {
  /** Paths changed by the successful write, absolute or workspace-relative. */
  changedPaths?: readonly string[];
  /** Explicit workspace-level command for projects detection cannot bound. */
  customCommand?: string;
};

const PROJECT_MARKERS = [
  "package.json",
  "pytest.ini",
  "tox.ini",
  "setup.cfg",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
] as const;

/** npm init's default test script is not a real runner. */
const PLACEHOLDER_TEST_SCRIPT = /no test specified/i;

function readJsonFile(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function relativeToWorkspace(workspaceRoot: string, target: string): string {
  const relative = path.relative(workspaceRoot, target);
  return relative ? relative.split(path.sep).join("/") : ".";
}

function hasProjectMarker(dir: string): boolean {
  return PROJECT_MARKERS.some((marker) => existsSync(path.join(dir, marker)));
}

function findNearestProjectRoot(workspaceRoot: string, changedPath: string): string | null {
  const absolute = path.isAbsolute(changedPath)
    ? path.resolve(changedPath)
    : path.resolve(workspaceRoot, changedPath);
  if (!isWithinRoot(workspaceRoot, absolute)) {
    return null;
  }
  let current = path.dirname(absolute);
  while (isWithinRoot(workspaceRoot, current)) {
    if (hasProjectMarker(current)) {
      return current;
    }
    if (current === workspaceRoot) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

/** Pick the closest lockfile while staying inside the workspace. */
function nodePackageManager(
  workspaceRoot: string,
  projectRoot: string,
): { runner: string; evidence: string } {
  let current = projectRoot;
  while (isWithinRoot(workspaceRoot, current)) {
    for (const [marker, runner] of [
      ["pnpm-lock.yaml", "pnpm"],
      ["yarn.lock", "yarn"],
      ["bun.lockb", "bun"],
      ["bun.lock", "bun"],
      ["package-lock.json", "npm"],
    ] as const) {
      const markerPath = path.join(current, marker);
      if (existsSync(markerPath)) {
        return { runner, evidence: relativeToWorkspace(workspaceRoot, markerPath) };
      }
    }
    if (current === workspaceRoot) {
      break;
    }
    current = path.dirname(current);
  }
  return {
    runner: "npm",
    evidence: relativeToWorkspace(workspaceRoot, path.join(projectRoot, "package.json")),
  };
}

function detectNode(workspaceRoot: string, projectRoot: string): TestRunnerDetection | null {
  const manifestPath = path.join(projectRoot, "package.json");
  if (!existsSync(manifestPath)) {
    return null;
  }
  const manifest = readJsonFile(manifestPath);
  const scripts =
    manifest?.scripts && typeof manifest.scripts === "object" && !Array.isArray(manifest.scripts)
      ? (manifest.scripts as Record<string, unknown>)
      : null;
  const testScript = typeof scripts?.test === "string" ? scripts.test : null;
  const manifestEvidence = relativeToWorkspace(workspaceRoot, manifestPath);
  if (!testScript || testScript.trim().length === 0) {
    return {
      detected: false,
      skipReason: "no-test-script",
      message: `${manifestEvidence} has no \`scripts.test\`; no project test suite was run. Add a test script or configure runtime.coding.autoVerify.command.`,
    };
  }
  if (PLACEHOLDER_TEST_SCRIPT.test(testScript)) {
    return {
      detected: false,
      skipReason: "placeholder-test-script",
      message: `${manifestEvidence} uses the npm placeholder test script; no project test suite was run.`,
    };
  }
  const { runner, evidence } = nodePackageManager(workspaceRoot, projectRoot);
  return {
    detected: true,
    ecosystem: "node",
    runner,
    command: runner === "npm" ? "npm test" : `${runner} test`,
    evidence,
    workdir: relativeToWorkspace(workspaceRoot, projectRoot),
  };
}

function detectPython(workspaceRoot: string, projectRoot: string): TestRunnerDetection | null {
  for (const marker of ["pytest.ini", "tox.ini", "setup.cfg", "pyproject.toml"]) {
    const file = path.join(projectRoot, marker);
    if (!existsSync(file)) {
      continue;
    }
    if (marker !== "pytest.ini") {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (!/pytest/i.test(text)) {
        continue;
      }
    }
    return {
      detected: true,
      ecosystem: "python",
      runner: "pytest",
      command: "pytest -q",
      evidence: relativeToWorkspace(workspaceRoot, file),
      workdir: relativeToWorkspace(workspaceRoot, projectRoot),
    };
  }
  return null;
}

function detectRust(workspaceRoot: string, projectRoot: string): TestRunnerDetection | null {
  const manifest = path.join(projectRoot, "Cargo.toml");
  return existsSync(manifest)
    ? {
        detected: true,
        ecosystem: "rust",
        runner: "cargo",
        command: "cargo test",
        evidence: relativeToWorkspace(workspaceRoot, manifest),
        workdir: relativeToWorkspace(workspaceRoot, projectRoot),
      }
    : null;
}

function detectGo(workspaceRoot: string, projectRoot: string): TestRunnerDetection | null {
  const manifest = path.join(projectRoot, "go.mod");
  return existsSync(manifest)
    ? {
        detected: true,
        ecosystem: "go",
        runner: "go",
        command: "go test ./...",
        evidence: relativeToWorkspace(workspaceRoot, manifest),
        workdir: relativeToWorkspace(workspaceRoot, projectRoot),
      }
    : null;
}

function detectAtProjectRoot(workspaceRoot: string, projectRoot: string): TestRunnerDetection {
  // A Node manifest's negative verdict wins over sibling ecosystems. Otherwise
  // a package without scripts.test could accidentally run an unrelated suite.
  const node = detectNode(workspaceRoot, projectRoot);
  if (node) {
    return node;
  }
  for (const detect of [detectPython, detectRust, detectGo]) {
    const hit = detect(workspaceRoot, projectRoot);
    if (hit) {
      return hit;
    }
  }
  return hasProjectMarker(projectRoot)
    ? {
        detected: false,
        skipReason: "unsupported-ecosystem",
        message:
          "A project manifest exists but no supported test runner (node/pytest/cargo/go) was recognized; configure runtime.coding.autoVerify.command for this workspace.",
      }
    : {
        detected: false,
        skipReason: "no-manifest",
        message:
          "No project manifest (package.json / pyproject.toml / Cargo.toml / go.mod) was found; no test suite was run.",
      };
}

/**
 * Detect one bounded test command for the changed files. Never throws. Multiple
 * package roots require an explicit workspace-level custom command.
 */
export function detectTestRunner(
  workspaceRoot: string | undefined,
  options: TestRunnerDetectionOptions = {},
): TestRunnerDetection {
  if (!workspaceRoot || workspaceRoot.trim().length === 0) {
    return {
      detected: false,
      skipReason: "no-workspace",
      message: "No workspace root is bound to this session; test detection was skipped.",
    };
  }
  const root = path.resolve(workspaceRoot);
  const changedPaths = (options.changedPaths ?? []).filter((entry) => entry.trim().length > 0);
  const outside = changedPaths.some((entry) => {
    const absolute = path.isAbsolute(entry) ? path.resolve(entry) : path.resolve(root, entry);
    return !isWithinRoot(root, absolute);
  });
  if (outside) {
    return {
      detected: false,
      skipReason: "outside-workspace",
      message: "At least one changed path is outside the bound workspace; automatic tests were not run.",
    };
  }

  const customCommand = options.customCommand?.trim();
  if (customCommand) {
    return {
      detected: true,
      ecosystem: "custom",
      runner: "custom",
      command: customCommand,
      evidence: "runtime.coding.autoVerify.command",
      workdir: ".",
    };
  }

  if (changedPaths.length === 0) {
    return detectAtProjectRoot(root, root);
  }
  const projectRoots = changedPaths.map((entry) => findNearestProjectRoot(root, entry));
  const resolvedRoots = new Set(projectRoots.filter((entry): entry is string => entry !== null));
  if (resolvedRoots.size > 1 || (resolvedRoots.size > 0 && projectRoots.some((entry) => !entry))) {
    const labels = [...resolvedRoots].map((entry) => relativeToWorkspace(root, entry));
    return {
      detected: false,
      skipReason: "cross-project-changes",
      message: `Changed files span multiple project roots (${labels.join(", ") || "unresolved"}); no single bounded test command applies. Configure runtime.coding.autoVerify.command for a workspace-level runner.`,
    };
  }
  const [projectRoot] = resolvedRoots;
  return detectAtProjectRoot(root, projectRoot ?? root);
}

/** One-line rendering used in tool result details and session-visible output. */
export function formatTestRunnerDetection(detection: TestRunnerDetection): string {
  return detection.detected
    ? `detected(${detection.ecosystem}/${detection.runner}): ${detection.command} [cwd=${detection.workdir}; via ${detection.evidence}]`
    : `skipped(${detection.skipReason}): ${detection.message}`;
}
